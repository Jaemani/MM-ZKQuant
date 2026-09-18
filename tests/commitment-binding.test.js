import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';
import { AlphaService } from '../src/server/service.js';
import { encryptEnvelope, hash, leafHash, signObject, signingPublicKey, verifyReceipt } from '../src/server/crypto.js';
import { UNIVERSE } from '../src/shared/protocol.js';

const prices = BTC => ({ BTC, ETH: 100, MON: 100, SOL: 100 });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mm-alpha-binding-'));
  const store = new Store(directory);
  let now = Date.parse('2026-09-18T00:00:00.000Z');
  const service = new AlphaService(store, { clock: () => now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const cohort = Array.from({ length: 4 }, (_, index) => {
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKey = signingPublicKey(privateKey);
    return { ...service.register('forward', { name: `Binding Provider ${index}`, kind: 'QUANT', publicKey }).provider, privateKey, publicKey };
  });
  const epoch = service.createEpoch('forward', { durationSeconds: 10, evaluationSeconds: 10 }).epoch;
  const payloads = cohort.map(provider => ({ version: 1, providerId: provider.id, epochId: epoch.id, policyHash: epoch.policyHash, universe: UNIVERSE, vectorBps: [10000, 0, 0, 0], nonce: randomBytes(32).toString('hex') }));
  const envelope = (payload, signer = cohort[0]) => encryptEnvelope({ payload, signature: signObject(payload, signer.privateKey) }, service.publicKey);
  const submissions = cohort.slice(0, 3).map((provider, index) => service.submit('forward', envelope(payloads[index], provider)));
  return { store, service, cohort, epoch, payloads, submissions, envelope,
    advance(ms) { now += ms; },
    seal() { now += 10000; return service.seal('forward', epoch.id, { beginPrices: prices(100) }); },
  };
}

test('evaluation rejects every stored-input divergence from a frozen commitment atomically', async t => {
  const f = fixture(t);
  f.seal(); f.advance(10000);
  const sealed = f.store.get('forward'), firstId = f.cohort[0].id;
  const mutations = [
    ['unsigned opposite vector', epoch => {
      epoch.submissions[firstId].envelope = encryptEnvelope({ payload: { ...f.payloads[0], vectorBps: [-10000, 0, 0, 0] }, signature: 'invalid' }, f.service.publicKey);
    }],
    ['provider-signed replacement with unchanged payload hash', epoch => {
      epoch.submissions[firstId].envelope = f.envelope({ ...f.payloads[0], vectorBps: [-10000, 0, 0, 0] });
    }],
    ['provider-signed replacement plus new submission metadata but old frozen leaf', epoch => {
      const payload = { ...f.payloads[0], vectorBps: [-10000, 0, 0, 0] };
      const submission = epoch.submissions[firstId];
      submission.envelope = f.envelope(payload); submission.payloadHash = hash(payload);
      submission.leaf.payloadHash = submission.payloadHash; submission.leafHash = leafHash(submission.leaf);
    }],
    ...[
      ['wrong provider', { providerId: f.cohort[1].id }], ['wrong epoch', { epochId: 'different-epoch' }],
      ['wrong policy', { policyHash: hash('different-policy') }], ['wrong universe', { universe: [...UNIVERSE].reverse() }],
      ['wrong version', { version: 2 }], ['wrong nonce', { nonce: 'short' }],
      ['extra field', { claimedTimestamp: '2000-01-01' }], ['wrong vector length', { vectorBps: [1000] }],
      ['fractional vector', { vectorBps: [1.5, 0, 0, 0] }], ['out-of-range vector', { vectorBps: [10001, 0, 0, 0] }],
    ].map(([name, change]) => [name, epoch => { epoch.submissions[firstId].envelope = f.envelope({ ...f.payloads[0], ...change }); }]),
    ['ciphertext authentication failure', epoch => { epoch.submissions[firstId].envelope.ciphertext = 'invalid'; }],
    ['deleted submitted record', epoch => { delete epoch.submissions[firstId]; }],
    ['late insert for previously missed provider', epoch => { epoch.submissions[f.cohort[3].id] = structuredClone(epoch.submissions[firstId]); }],
    ['submission outside frozen roster', epoch => { epoch.submissions['outside-roster'] = structuredClone(epoch.submissions[firstId]); }],
    ['submitted leaf metadata changed', epoch => { epoch.submissions[firstId].leaf.domain = 'WRONG_DOMAIN'; }],
    ['stored leafHash changed', epoch => { epoch.submissions[firstId].leafHash = hash('different-leaf'); }],
    ['frozen leaves swapped', epoch => { [epoch.leaves[0], epoch.leaves[1]] = [epoch.leaves[1], epoch.leaves[0]]; }],
    ['frozen leaf removed', epoch => { epoch.leaves.pop(); }],
    ['root changed without manifest', epoch => { epoch.root = hash('different-root'); }],
    ['policy mutated without hash', epoch => { epoch.policy.feeBps = 999; }],
    ['weight mutated without manifest', epoch => { epoch.weightsBps[firstId] = 999; }],
    ['roster key changed without manifest', epoch => { epoch.roster.find(p => p.id === firstId).publicKey = f.cohort[1].publicKey; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const state = structuredClone(sealed); mutate(state.epochs[0]); f.store.put('forward', state);
    const before = f.store.get('forward');
    assert.throws(() => f.service.evaluate('forward', f.epoch.id, { endPrices: prices(110) }), error => error.status === 409 && /commitment|submission/i.test(error.message));
    assert.deepEqual(f.store.get('forward'), before, 'failed evaluation must not alter NAV, history, credits, status or shadow books');
  });
  f.store.put('forward', sealed);
  const result = f.service.evaluate('forward', f.epoch.id, { endPrices: prices(110) });
  assert.equal(result.epoch.status, 'EVALUATED');
  assert.equal(result.epoch.evaluation.nav, 102462.5);
  const receipt = f.service.getReceipt('forward', f.epoch.id, firstId, f.submissions[0].receipt.receiptToken).receipt;
  assert.equal(verifyReceipt(receipt, f.service.serverSigningKey).valid, true);
});

test('sealing rejects unsigned stored vectors before a root, execution or accounting can persist', t => {
  const f = fixture(t);
  const state = f.store.get('forward');
  state.epochs[0].submissions[f.cohort[0].id].envelope = encryptEnvelope({ payload: { ...f.payloads[0], vectorBps: [-10000, 0, 0, 0] }, signature: 'invalid' }, f.service.publicKey);
  f.store.put('forward', state); f.advance(10000);
  const before = f.store.get('forward');
  assert.throws(() => f.service.seal('forward', f.epoch.id, { beginPrices: prices(100) }), error => error.status === 409);
  assert.deepEqual(f.store.get('forward'), before);
  assert.equal(f.store.get('forward').epochs[0].root, null);
});

test('submitted payload verification uses the frozen roster key rather than current provider metadata', t => {
  const f = fixture(t);
  f.seal(); f.advance(10000);
  const state = f.store.get('forward');
  state.providers[0].publicKey = f.cohort[1].publicKey;
  f.store.put('forward', state);
  assert.equal(f.service.evaluate('forward', f.epoch.id, { endPrices: prices(110) }).epoch.evaluation.nav, 102462.5);
});
