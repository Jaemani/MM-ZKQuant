import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAttestedTeeChannel } from '../src/web/attestedTee.js';
import { PlatformError, PlatformService } from '../src/platform/service.js';
import { makePlatformServer } from '../src/platform/http.js';
import { verifyPlatformTee } from '../src/platform/tee-attestation.js';
import { teeAttestationPolicy } from '../src/platform/tee-attestation-policy.js';

const config = { teeEndpoint: 'https://tee.example', teeEncryptionPublicKey: 'pinned-key' };
const verified = () => ({ status: 'VERIFIED_PINNED_TDX_VIA_PHALA', teeEndpoint: config.teeEndpoint, encryptionPublicKey: config.teeEncryptionPublicKey, expiresAt: Date.now() + 60_000 });

// Stub the vendor signature verdict while exercising the real byte parser,
// event replay, report-data binding and migration/OS policy checks.
function migrationQuoteFixture({actualImage='22'.repeat(32),omitMigration=false}={}) {
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const composeHash='11'.repeat(32),osImageHash='22'.repeat(32);
  const events=[{imr:3,event_type:1,event:'compose-hash',event_payload:composeHash},{imr:3,event_type:1,event:'os-image-hash',event_payload:actualImage}];
  let rtmr3=Buffer.alloc(48);
  for(const event of events){const type=Buffer.alloc(4);type.writeUInt32LE(event.event_type);const digest=createHash('sha384').update(Buffer.concat([type,Buffer.from(':'+event.event+':'),Buffer.from(event.event_payload,'hex')])).digest();rtmr3=createHash('sha384').update(Buffer.concat([rtmr3,digest])).digest();}
  const measurements={mrtd:'00'.repeat(48),rtmr0:'00'.repeat(48),rtmr1:'00'.repeat(48),rtmr2:'00'.repeat(48),rtmr3:rtmr3.toString('hex')};
  const identityMigration={sourceAppId:'a'.repeat(40),targetAppId:'b'.repeat(40),operator:'0x1234',encryptionPublicKey:'pinned-key'};
  const policy={mode:'COHORT_TESTNET_OPERATOR',chainId:10143,operator:'0x1234',encryptionPublicKey:'pinned-key',vault:'0x5678',lockSha256:'lock',wasmSha256:'wasm',zkeySha256:'zkey',sourceHashes:{},ledgerGenesis:{genesisRoot:'123'},composeHash,osImageHash,measurements,identityMigration};
  let vendor;
  const fetchImpl=async url=>{
    if(url.startsWith('https://tee.example/')){
      const challenge=new URL(url).searchParams.get('challenge');
      const identity={mode:policy.mode,chainId:policy.chainId,operator:policy.operator,encryptionPublicKey:policy.encryptionPublicKey,omnibusVault:policy.vault,lockSha256:policy.lockSha256,wasmSha256:policy.wasmSha256,zkeySha256:policy.zkeySha256,sourceHashes:{},ledgerGenesis:policy.ledgerGenesis,...(omitMigration?{}:{identityMigration})};
      const binding=sha(JSON.stringify({domain:'MM_COHORT_OPERATOR_V1',identity,challenge}));
      const fields=[['tee_tcb_svn',16],['mrseam',48],['mrsignerseam',48],['seamattributes',8],['tdattributes',8],['xfam',8],['mrtd',48],['mrconfig',48],['mrowner',48],['mrownerconfig',48],['rtmr0',48],['rtmr1',48],['rtmr2',48],['rtmr3',48],['reportdata',64]];
      const body=Object.fromEntries(fields.map(([name,size])=>[name,'00'.repeat(size)]));Object.assign(body,measurements,{mrconfig:'01'+composeHash+'00'.repeat(15),reportdata:binding.padEnd(128,'0')});
      const raw=Buffer.alloc(637);raw.writeUInt16LE(4,0);raw.writeUInt16LE(2,2);raw.writeUInt32LE(129,4);let offset=48;
      for(const[name,size]of fields){Buffer.from(body[name],'hex').copy(raw,offset);offset+=size;}raw.writeUInt32LE(1,632);raw[636]=1;
      vendor={success:true,quote:{verified:true,header:{version:4,ak_type:2,tee_type:129,qe_vendor:'00'.repeat(16),user_data:'00'.repeat(20)},body}};
      return {ok:true,json:async()=>({identity,challenge,binding,quote:{quote:raw.toString('hex'),event_log:events}})};
    }
    return {ok:true,json:async()=>vendor};
  };
  return {endpoint:'https://tee.example',publicKey:policy.encryptionPublicKey,vault:policy.vault,policy,fetchImpl};
}

test('migration attestation binds the production OS image and original operator provenance',async()=>{
  assert.equal((await verifyPlatformTee(migrationQuoteFixture())).status,'VERIFIED_PINNED_TDX_VIA_PHALA');
  await assert.rejects(verifyPlatformTee(migrationQuoteFixture({actualImage:'33'.repeat(32)})),/TEE_ATTESTATION_OS_IMAGE/);
  await assert.rejects(verifyPlatformTee(migrationQuoteFixture({omitMigration:true})),/TEE_ATTESTATION_MIGRATION_IDENTITY/);
});

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
