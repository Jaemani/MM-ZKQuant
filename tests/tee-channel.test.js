import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
import { encryptionIdentity } from '../src/integration/sealed.js';
import { encryptedTeeRequest } from '../src/web/teeChannel.js';

test('browser channel encrypts directly to the TEE public key', async () => {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const identity = encryptionIdentity(randomBytes(32));
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://tee.invalid/platform/encrypted-investments');
    const opened = identity.open(JSON.parse(options.body));
    assert.deepEqual(opened.message, { strategyId: 'private-strategy', amount: '1000000' });
    return { ok: true, json: async () => ({ reply: opened.reply({ accepted: true }) }) };
  };
  try {
    assert.deepEqual(await encryptedTeeRequest('https://tee.invalid', identity.publicKey, '/platform/encrypted-investments', { strategyId: 'private-strategy', amount: '1000000' }), { accepted: true });
  } finally { globalThis.fetch = priorFetch; }
});
