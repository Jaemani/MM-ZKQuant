import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';
import { AlphaService } from '../src/server/service.js';
import { decryptEnvelope, encryptEnvelope, hash, signObject, signingPublicKey, verifyReceipt } from '../src/server/crypto.js';
import { UNIVERSE } from '../src/shared/protocol.js';

const prices = (BTC = 100, ETH = 100, MON = 100, SOL = 100) => ({ BTC, ETH, MON, SOL });
const near = (actual, expected, tolerance = 0.000001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
const rejection = (action, status) => assert.throws(action, (error) => error.status === status);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mm-alpha-service-'));
  let now = Date.parse('2026-09-18T00:00:00.000Z');
  let store = new Store(directory);
  let service = new AlphaService(store, { clock: () => now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const context = {
    directory,
    get service() { return service; },
    get store() { return store; },
    advance(ms) { now += ms; },
    restart() { store.close(); store = new Store(directory); service = new AlphaService(store, { clock: () => now }); },
    register(name = 'Test Provider', workspace = 'forward') {
      const keyPair = generateKeyPairSync('ed25519');
      const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
      const publicKey = signingPublicKey(privateKey);
      const { provider } = service.register(workspace, { name, kind: 'QUANT', publicKey });
      return { ...provider, privateKey, publicKey };
    },
    cohort(count = 3) { return Array.from({ length: count }, (_, index) => context.register(`Provider ${index}`)); },
    create(workspace = 'forward') { return service.createEpoch(workspace, { durationSeconds: 10, evaluationSeconds: 10 }).epoch; },
    payload(provider, epoch, vectorBps = [10000, 0, 0, 0]) {
      return { version: 1, providerId: provider.id, epochId: epoch.id, policyHash: epoch.policyHash,
        universe: UNIVERSE, vectorBps, nonce: randomBytes(32).toString('hex') };
    },
    envelope(provider, payload) { return encryptEnvelope({ payload, signature: signObject(payload, provider.privateKey) }, service.publicKey); },
    submit(provider, epoch, vectorBps = [10000, 0, 0, 0]) {
      const payload = context.payload(provider, epoch, vectorBps);
      return { payload, ...service.submit('forward', context.envelope(provider, payload)) };
    },
    complete(cohort, start = prices(), end = prices(110)) {
      const epoch = context.create();
      cohort.forEach((provider) => context.submit(provider, epoch));
      context.advance(10000);
      service.seal('forward', epoch.id, { beginPrices: start });
      context.advance(10000);
      return service.evaluate('forward', epoch.id, { endPrices: end }).epoch;
    },
  };
  return context;
}

test('fresh workspaces are independent and demo seeds only on its explicit run', (t) => {
  const f = fixture(t);
  assert.equal(f.service.state('demo').providers.length, 0);
  assert.equal(f.service.state('forward').providers.length, 0);
  const result = f.service.demoRun();
  assert.equal(result.epoch.status, 'EVALUATED');
  assert.equal(f.service.state('demo').providers.length, 10);
  assert.equal(f.service.state('forward').providers.length, 0);
  assert.equal(f.service.state('forward').epochs.length, 0);
});

test('cutoff is strict and premature sealing, evaluation, and active cash flows roll back', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  const before = f.store.get('forward');
  rejection(() => f.service.seal('forward', epoch.id, { beginPrices: prices() }), 409);
  rejection(() => f.service.evaluate('forward', epoch.id, { endPrices: prices() }), 409);
  rejection(() => f.service.flow('forward', 'DEPOSIT', { amount: 100, requestId: 'active-deposit' }), 409);
  assert.deepEqual(f.store.get('forward'), before);
  f.advance(9999);
  f.submit(cohort[0], epoch);
  f.advance(1);
  rejection(() => f.submit(cohort[1], epoch), 409);
  f.service.seal('forward', epoch.id, { beginPrices: prices() });
  const sealed = f.store.get('forward');
  rejection(() => f.service.evaluate('forward', epoch.id, { endPrices: prices(110) }), 409);
  assert.deepEqual(f.store.get('forward'), sealed);
});

test('frozen roster excludes registrations made after epoch opening', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  const late = f.register('Late registration');
  rejection(() => f.submit(late, epoch), 400);
  cohort.forEach((provider) => f.submit(provider, epoch));
  f.advance(10000);
  f.service.seal('forward', epoch.id, { beginPrices: prices() });
  f.advance(10000);
  f.service.evaluate('forward', epoch.id, { endPrices: prices() });
  const state = f.service.state('forward');
  assert.equal(state.epochs[0].rosterCount, 3);
  assert.equal(state.providers.find((provider) => provider.id === late.id).required, 0);
  assert.equal(state.providers.find((provider) => provider.id === late.id).metrics.samples, 0);
  const next = f.create();
  assert.equal(next.rosterCount, 4);
});

test('authenticated identical retries are idempotent even after cutoff; replacements conflict', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  const first = f.submit(cohort[0], epoch);
  const snapshot = f.store.get('forward');
  f.advance(10000);
  const retry = f.service.submit('forward', f.envelope(cohort[0], first.payload));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.receipt.leafHash, first.receipt.leafHash);
  assert.equal(retry.receipt.receiptToken, first.receipt.receiptToken);
  assert.deepEqual(f.store.get('forward'), snapshot);
  const changed = { ...first.payload, vectorBps: [-10000, 0, 0, 0] };
  rejection(() => f.service.submit('forward', f.envelope(cohort[0], changed)), 409);
  assert.deepEqual(f.store.get('forward'), snapshot);
});

test('invalid signatures, ciphertext tampering, policy, universe and vector inputs never persist', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  const payload = f.payload(cohort[0], epoch);
  const baseline = f.store.get('forward');
  const impostor = f.envelope(cohort[1], payload);
  rejection(() => f.service.submit('forward', impostor), 401);
  const envelope = f.envelope(cohort[0], payload);
  const encrypted = Buffer.from(envelope.ciphertext, 'base64');
  encrypted[0] ^= 1;
  rejection(() => f.service.submit('forward', { ...envelope, ciphertext: encrypted.toString('base64') }), 400);
  const variants = [
    { ...payload, policyHash: '0x' + '0'.repeat(64) },
    { ...payload, universe: [...UNIVERSE].reverse() },
    { ...payload, vectorBps: [10001, 0, 0, 0] },
    { ...payload, vectorBps: [1.5, 0, 0, 0] },
    { ...payload, extra: 'not in protocol' },
  ];
  for (const invalid of variants) rejection(() => f.service.submit('forward', f.envelope(cohort[0], invalid)), 400);
  assert.deepEqual(f.store.get('forward'), baseline);
});

test('receipts survive restart, verify an odd-size Merkle roster and deny unrelated tokens', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  const submission = f.submit(cohort[0], epoch);
  f.advance(10000);
  f.service.seal('forward', epoch.id, { beginPrices: prices() });
  const before = f.service.manifest('forward', epoch.id);
  const trustedKey = f.service.serverSigningKey;
  f.restart();
  assert.deepEqual(f.service.manifest('forward', epoch.id), before);
  const { receipt } = f.service.getReceipt('forward', epoch.id, cohort[0].id, submission.receipt.receiptToken);
  assert.deepEqual(verifyReceipt(receipt, trustedKey), { valid: true, signatureValid: true, inclusionValid: true,
    manifestValid: true, contextValid: true, independentlyTimestamped: false });
  const { serverSignature, ...inconsistentBody } = { ...receipt, epochId: 'another-epoch' };
  const inconsistentReceipt = { ...inconsistentBody, serverSignature: signObject(inconsistentBody, f.store.keys.signingPrivateKey) };
  assert.equal(verifyReceipt(inconsistentReceipt, trustedKey).signatureValid, true);
  assert.equal(verifyReceipt(inconsistentReceipt, trustedKey).contextValid, false);
  assert.equal(verifyReceipt(inconsistentReceipt, trustedKey).valid, false);
  const forged = structuredClone(receipt);
  forged.leaf.status = 'MISSED';
  assert.equal(verifyReceipt(forged, trustedKey).valid, false);
  rejection(() => f.service.getReceipt('forward', epoch.id, cohort[0].id, '0'.repeat(64)), 403);
  rejection(() => f.service.getReceipt('forward', epoch.id, cohort[1].id, submission.receipt.receiptToken), 403);
});

test('Unicode receipt tokens are rejected as access denied without a buffer-length exception', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  f.submit(cohort[0], epoch);
  rejection(() => f.service.getReceipt('forward', epoch.id, cohort[0].id, 'é'.repeat(64)), 403);
});

test('the same signing identity cannot register twice through alternate base64 text', (t) => {
  const f = fixture(t), provider = f.register();
  const input = { name: 'Duplicate identity', kind: 'AI', publicKey: provider.publicKey.slice(0, 20) + '\n' + provider.publicKey.slice(20) };
  assert.throws(() => f.service.register('forward', input));
  assert.equal(f.service.state('forward').providers.length, 1);
});

test('one-member skipped cohorts do not publish reconstructable private raw alpha', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  f.submit(cohort[0], epoch, [9137, -6821, 7773, -4521]);
  f.advance(10000);
  const { epoch: sealed } = f.service.seal('forward', epoch.id, { beginPrices: prices() });
  assert.equal(sealed.aggregate.status, 'SKIPPED');
  assert.equal(sealed.aggregate.rawBps == null, true);
  assert.equal(f.service.state('forward').epochs[0].aggregate.rawBps == null, true);
  assert.equal(f.store.get('forward').epochs[0].aggregate.rawBps == null, true);
});

test('settlement and retries conserve capital, fees, shares and single history writes', (t) => {
  const f = fixture(t), cohort = f.cohort();
  const epoch = f.complete(cohort);
  const state = f.service.state('forward');
  assert.equal(epoch.execution.cost, 37.5);
  near(state.book.nav, 102462.5);
  assert.equal(state.book.shares, 100000);
  near(state.book.sharePrice, 1.024625);
  const snapshot = f.store.get('forward');
  assert.equal(f.service.evaluate('forward', epoch.id, { endPrices: prices(110) }).duplicate, true);
  assert.deepEqual(f.store.get('forward'), snapshot);
  rejection(() => f.service.evaluate('forward', epoch.id, { endPrices: prices(111) }), 409);
  assert.deepEqual(f.store.get('forward'), snapshot);
  assert.ok(state.providers.every((provider) => provider.metrics.samples === 1));
  const deposited = f.service.flow('forward', 'DEPOSIT', { amount: 10246.25, requestId: 'settlement-deposit' });
  near(deposited.flow.shares, 10000);
  near(deposited.book.nav, 112708.75);
  assert.equal(deposited.book.shares, 110000);
  near(deposited.book.sharePrice, state.book.sharePrice);
  const withdrawn = f.service.flow('forward', 'WITHDRAW', { shares: 10000, requestId: 'settlement-withdraw' });
  near(withdrawn.flow.amount, 10246.25);
  near(withdrawn.book.nav, 102462.5);
  assert.equal(withdrawn.book.shares, 100000);
  near(withdrawn.book.totalDeposited - withdrawn.book.totalWithdrawn + 2462.5, withdrawn.book.nav);
});

test('failed withdrawals and invalid money inputs leave all balances unchanged', (t) => {
  const f = fixture(t), before = f.store.get('forward');
  for (const shares of [-1, 0, 100001, Infinity, NaN]) {
    assert.throws(() => f.service.flow('forward', 'WITHDRAW', { shares, requestId: 'invalid-withdraw' }));
    assert.deepEqual(f.store.get('forward'), before);
  }
  for (const amount of [-1, 0, 100000001, Infinity, NaN]) {
    assert.throws(() => f.service.flow('forward', 'DEPOSIT', { amount, requestId: 'invalid-deposit' }));
    assert.deepEqual(f.store.get('forward'), before);
  }
});

test('capital transfer request IDs prevent double issuance across retries and restart', (t) => {
  const f = fixture(t), input = { amount: 1234.5, requestId: 'deposit-unique-001' };
  const first = f.service.flow('forward', 'DEPOSIT', input);
  assert.equal(first.book.nav, 101234.5);
  assert.equal(first.book.shares, 101234.5);
  f.restart();
  const snapshot = f.store.get('forward');
  const retry = f.service.flow('forward', 'DEPOSIT', input);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(f.store.get('forward'), snapshot);
  rejection(() => f.service.flow('forward', 'DEPOSIT', { ...input, amount: 100 }), 409);
  rejection(() => f.service.flow('forward', 'WITHDRAW', { shares: 100, requestId: input.requestId }), 409);
  assert.deepEqual(f.store.get('forward'), snapshot);
  for (const amount of [Number.MIN_VALUE, 0.000000001]) {
    rejection(() => f.service.flow('forward', 'DEPOSIT', { amount, requestId: 'tiny-deposit' }), 400);
  }
  rejection(() => f.service.flow('forward', 'WITHDRAW', { shares: 0.000000001, requestId: 'tiny-withdraw' }), 400);
  assert.deepEqual(f.store.get('forward'), snapshot);
});

test('all-missing epochs preserve fund carry PnL and flatten only private shadow books', (t) => {
  const f = fixture(t), cohort = f.cohort();
  f.complete(cohort, prices(), prices(110));
  const second = f.create();
  f.advance(10000);
  const sealed = f.service.seal('forward', second.id, { beginPrices: prices(121) }).epoch;
  assert.equal(sealed.aggregate.status, 'SKIPPED');
  assert.equal(sealed.aggregate.reason, 'ALL_MISSING');
  assert.equal(sealed.execution.cost, 0);
  near(f.service.state('forward').book.nav, 105212.5);
  f.advance(10000);
  f.service.evaluate('forward', second.id, { endPrices: prices(133.1) });
  const state = f.service.state('forward');
  near(state.book.nav, 108237.5);
  assert.equal(state.book.history.filter((row) => row.type === 'GAP_MARK').length, 1);
  assert.ok(state.providers.every((provider) => provider.required === 2 && provider.submitted === 1 && provider.missed === 1));
  for (const provider of state.providers) near(provider.metrics.shadowNav, 105167.125);
  assert.equal(state.epochs[0].evaluation.rewardPreview.allocatedUnits, 0);
});

test('encrypted persistence and public DTOs exclude raw vectors, envelopes and secret keys', (t) => {
  const f = fixture(t), cohort = f.cohort();
  const epoch = f.create();
  cohort.forEach((provider, index) => f.submit(provider, epoch, [9137 - index, -6821, 7773, -4521]));
  f.advance(10000);
  f.service.seal('forward', epoch.id, { beginPrices: prices() });
  f.advance(10000);
  f.service.evaluate('forward', epoch.id, { endPrices: prices(110) });
  const persisted = f.store.get('forward');
  const text = JSON.stringify(persisted);
  assert.equal(text.includes('"vectorBps"'), false);
  assert.equal(text.includes('"privateKey"'), false);
  assert.equal(typeof persisted.shadows.ciphertext, 'string');
  const shadows = decryptEnvelope(persisted.shadows, f.store.keys.encryptionPrivateKey);
  assert.equal(Object.keys(shadows).length, 3);
  assert.ok(shadows[cohort[0].id].weightsBps);
  const state = f.service.state('forward');
  const visible = JSON.stringify(state);
  for (const secret of ['"vectorBps"', '"submissions"', '"ciphertext"', '"privateKey"', '"demoKey"', '"weightsBps"']) {
    assert.equal(visible.includes(secret), false, `Public DTO contains ${secret}`);
  }
  assert.ok(state.providers.every((provider) => !('history' in provider) && !('publicKey' in provider)));
  assert.equal(statSync(join(f.directory, 'operator-keys.json')).mode & 0o777, 0o600);
  assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  assert.ok(readFileSync(join(f.directory, 'operator-keys.json'), 'utf8').includes('PRIVATE KEY'));
});

test('unsealed expired epochs are permanently marked, include missing members, and cannot backdate execution', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  f.submit(cohort[0], epoch);
  f.advance(20000);
  const state = f.service.state('forward');
  assert.equal(state.epochs[0].status, 'EXPIRED');
  assert.equal(state.epochs[0].execution, null);
  assert.equal(state.epochs[0].missedCount, 2);
  assert.equal(state.activeEpochId, null);
  const root = state.epochs[0].root;
  assert.equal(f.service.seal('forward', epoch.id, { beginPrices: prices() }).epoch.status, 'EXPIRED');
  assert.equal(f.service.manifest('forward', epoch.id).root, root);
  rejection(() => f.service.evaluate('forward', epoch.id, { endPrices: prices() }), 409);
});

test('invalid extreme price marks cannot partially freeze roots or mutate the book', (t) => {
  const f = fixture(t), cohort = f.cohort(), epoch = f.create();
  cohort.forEach((provider) => f.submit(provider, epoch));
  f.advance(10000);
  const snapshot = f.store.get('forward');
  for (const price of [0, -1, Infinity, NaN, 1e12]) {
    rejection(() => f.service.seal('forward', epoch.id, { beginPrices: prices(price) }), 400);
    assert.deepEqual(f.store.get('forward'), snapshot);
  }
  assert.throws(() => f.service.seal('forward', epoch.id, { beginPrices: prices(Number.MIN_VALUE) }));
  assert.deepEqual(f.store.get('forward'), snapshot);
});

test('subsequent manifests link the prior sealed manifest and preserve frozen policy hashes', (t) => {
  const f = fixture(t), cohort = f.cohort();
  const first = f.complete(cohort), firstManifest = f.service.manifest('forward', first.id);
  const second = f.complete(cohort, prices(110), prices(111));
  const manifest = f.service.manifest('forward', second.id);
  assert.equal(manifest.manifest.previousManifestHash, firstManifest.manifestHash);
  assert.equal(hash(manifest.manifest), manifest.manifestHash);
  assert.equal(manifest.manifest.policyHash, first.policyHash);
  const frozen = f.store.get('forward').epochs[1];
  assert.ok(Object.values(frozen.weightsBps).every((weight) => weight <= 1000));
  assert.equal(hash(frozen.weightsBps), manifest.manifest.weightsHash);
});

test('reported maximum fund drawdown survives a later recovery above the peak', (t) => {
  const f = fixture(t), cohort = f.cohort();
  f.complete(cohort, prices(100), prices(90));
  const trough = f.service.state('forward');
  near(trough.book.nav, 97462.5);
  near(trough.book.maxDrawdown, -0.025375);
  f.complete(cohort, prices(90), prices(100));
  const recovered = f.service.state('forward');
  assert.ok(recovered.book.nav > 100000);
  near(recovered.book.maxDrawdown, -0.025375);
});
