import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttestedTeeChannel } from '../src/web/attestedTee.js';
import { PlatformError, PlatformService } from '../src/platform/service.js';
import { makePlatformServer } from '../src/platform/http.js';
import { verifyPlatformTee } from '../src/platform/tee-attestation.js';
import { teeAttestationPolicy } from '../src/platform/tee-attestation-policy.js';

const config = { teeEndpoint: 'https://tee.example', teeEncryptionPublicKey: 'pinned-key' };
const verified = () => ({ status: 'VERIFIED_PINNED_TDX_VIA_PHALA', teeEndpoint: config.teeEndpoint, encryptionPublicKey: config.teeEncryptionPublicKey, expiresAt: Date.now() + 60_000 });

test('pinned key and Vault are checked before contacting a TEE or vendor', async () => {
  const fetchImpl = () => { throw Error('network must not be contacted'); };
  await assert.rejects(verifyPlatformTee({ endpoint: 'https://tee.example', publicKey: 'attacker-key', vault: teeAttestationPolicy.vault, fetchImpl }), /TEE_ATTESTATION_CONFIG_KEY/);
  await assert.rejects(verifyPlatformTee({ endpoint: 'https://tee.example', publicKey: teeAttestationPolicy.encryptionPublicKey, vault: '0x1234', fetchImpl }), /TEE_ATTESTATION_CONFIG_VAULT/);
});

test('browser blocks encryption until a matching attestation succeeds and refreshes it after expiry', async () => {
  let checks = 0, sends = 0, now = 1000;
  const gate = createAttestedTeeChannel({
    now: () => now,
    loadAttestation: async () => { checks++; return { ...verified(), expiresAt: now + 60_000 }; },
    sendEncrypted: async (endpoint, key, path, message) => {
      sends++;
      assert.deepEqual([endpoint, key, path, message], [config.teeEndpoint, config.teeEncryptionPublicKey, '/platform/encrypted-strategy', { secret: 'alpha' }]);
      return { accepted: true };
    }
  });
  await gate.send(config, '/platform/encrypted-strategy', { secret: 'alpha' });
  await gate.send(config, '/platform/encrypted-strategy', { secret: 'alpha' });
  assert.deepEqual([checks, sends], [1, 2]);
  now += 56_000;
  await gate.send(config, '/platform/encrypted-strategy', { secret: 'alpha' });
  assert.deepEqual([checks, sends], [2, 3]);
});

test('browser sends no private request for failed, mismatched or canceled attestation', async () => {
  let sends = 0;
  const sendEncrypted = () => { sends++; };
  for (const result of [
    { ...verified(), encryptionPublicKey: 'attacker-key' },
    { ...verified(), teeEndpoint: 'https://attacker.example' },
    { ...verified(), status: 'UNVERIFIED' },
    { ...verified(), expiresAt: 0 }
  ]) {
    const gate = createAttestedTeeChannel({ loadAttestation: async () => result, sendEncrypted });
    await assert.rejects(gate.send(config, '/platform/encrypted-investments', { secret: 'alpha' }), /TEE_ATTESTATION_FAILED/);
  }
  let release;
  const gate = createAttestedTeeChannel({ loadAttestation: () => new Promise(resolve => { release = resolve; }), sendEncrypted });
  const attempt = gate.send(config, '/platform/encrypted-investments', { secret: 'alpha' });
  gate.clear();
  release(verified());
  await assert.rejects(attempt, /TEE_ATTESTATION_FAILED/);
  assert.equal(sends, 0);
});

test('authenticated platform API exposes only a successfully verified TEE identity', async () => {
  const database = { query: async () => ({ rows: [
    { key: 'omnibus_vault_address', value: '0x1234' },
    { key: 'cash_token_address', value: '0x5678' }
  ] }) };
  let verificationCalls = 0;
  const service = new PlatformService(database, { ...config, verifyTee: async input => {
    verificationCalls++;
    assert.deepEqual(input, { endpoint: config.teeEndpoint, publicKey: config.teeEncryptionPublicKey, vault: '0x1234' });
    return verified();
  } });
  service.session = async authorization => {
    if (authorization !== 'Bearer test-session') throw new PlatformError('SESSION_REQUIRED', 401);
    return '0x1234';
  };
  const server = makePlatformServer(service, { prefix: '/api' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/v1/tee-attestation`;
    const unauthorized = await fetch(url);
    assert.equal(unauthorized.status, 401);
    assert.equal(verificationCalls, 0);
    const response = await fetch(url, { headers: { Authorization: 'Bearer test-session' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'VERIFIED_PINNED_TDX_VIA_PHALA');
    assert.equal(verificationCalls, 1);
    service.verifyTee = async () => { throw Error('untrusted quote'); };
    const rejected = await fetch(url, { headers: { Authorization: 'Bearer test-session' } });
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), { error: 'TEE_ATTESTATION_FAILED' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
