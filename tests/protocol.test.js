import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { canonicalJson } from '../src/shared/protocol.js';
import { decryptEnvelope, encryptEnvelope, hash, makeKeys, merkleTree, signObject, signingPublicKey, verifyInclusion, verifyObject } from '../src/server/crypto.js';

test('Canonical encoding is key-order independent and rejects non-finite values', () => {
  assert.equal(canonicalJson({ b: [3, 2], a: '한글' }), '{"a":"한글","b":[3,2]}');
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ a: Infinity }));
});
test('Every odd/even Merkle leaf verifies; bit changes and wrong directions fail', () => {
  for (const count of [1, 2, 3, 10]) {
    const leaves = Array.from({ length: count }, (_, n) => ({ providerId: n, payloadHash: hash(`nonce-${n}`) }));
    const { root, proofs } = merkleTree(leaves);
    leaves.forEach((leaf, i) => { assert.ok(verifyInclusion(leaf, proofs[i], root)); assert.equal(verifyInclusion({ ...leaf, providerId: -1 }, proofs[i], root), false); });
    assert.equal(verifyInclusion(leaves[0], [{ side: 'up', hash: root }], root), false);
  }
});
test('Signatures bind the entire payload to the registered key', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const payload = { epoch: 'a', vectorBps: [1, 2, 3, 4], nonce: 'canary' };
  const signature = signObject(payload, pem);
  assert.ok(verifyObject(payload, signature, signingPublicKey(pem)));
  assert.equal(verifyObject({ ...payload, epoch: 'b' }, signature, signingPublicKey(pem)), false);
});
test('AES-GCM hybrid envelope authenticates ciphertext and fresh encryption differs', () => {
  const keys = makeKeys(), publicKey = createPublicKey(keys.encryptionPrivateKey);
  const payload = { vectorBps: [1234, -9876, 2345, 0], nonce: 'PRIVATE-CANARY' };
  const envelope = encryptEnvelope(payload, publicKey);
  assert.deepEqual(decryptEnvelope(envelope, keys.encryptionPrivateKey), payload);
  assert.notEqual(envelope.ciphertext, encryptEnvelope(payload, publicKey).ciphertext);
  const changed = Buffer.from(envelope.ciphertext, 'base64'); changed[0] ^= 1;
  assert.throws(() => decryptEnvelope({ ...envelope, ciphertext: changed.toString('base64') }, keys.encryptionPrivateKey));
  assert.equal(JSON.stringify(envelope).includes('PRIVATE-CANARY'), false);
});
