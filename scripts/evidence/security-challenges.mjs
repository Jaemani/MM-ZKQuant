import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/server/store.js';
import { AlphaService } from '../../src/server/service.js';
import { makeHttpServer } from '../../src/server/http.js';
import { encryptEnvelope, hash, signObject, signingPublicKey, verifyObject, verifyReceipt } from '../../src/server/crypto.js';
import { UNIVERSE } from '../../src/shared/protocol.js';
import { compileRegistry, normalizeManifest } from '../chain-demo.mjs';
import { createLocalRegistry } from '../../contracts/local-evm.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const price = (BTC = 100) => ({ BTC, ETH: 100, MON: 100, SOL: 100 });
const trackedSources = ['src/server/crypto.js', 'src/server/store.js', 'src/server/service.js', 'src/server/http.js', 'src/core/engine.js', 'src/shared/protocol.js', 'contracts/EpochCommitmentRegistry.sol', 'contracts/local-evm.mjs', 'scripts/chain-demo.mjs', 'scripts/evidence/security-challenges.mjs'];
const checkpoint = () => Object.fromEntries(trackedSources.map(path => [path, createHash('sha256').update(readFileSync(join(projectRoot, path))).digest('hex')]));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mm-alpha-security-'));
  const store = new Store(directory);
  let now = Date.parse('2026-09-18T00:00:00.000Z');
  const service = new AlphaService(store, { clock: () => now });
  const register = (index) => {
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKey = signingPublicKey(privateKey);
    return { ...service.register('forward', { name: `Security Provider ${index}`, kind: 'QUANT', publicKey }).provider, publicKey, privateKey };
  };
  const cohort = [0, 1, 2].map(register);
  const epoch = service.createEpoch('forward', { durationSeconds: 10, evaluationSeconds: 10 }).epoch;
  const payload = (provider, vectorBps = [10000, 0, 0, 0]) => ({ version: 1, providerId: provider.id, epochId: epoch.id, policyHash: epoch.policyHash, universe: UNIVERSE, vectorBps, nonce: randomBytes(32).toString('hex') });
  const submit = (provider) => {
    const value = payload(provider);
    return { payload: value, ...service.submit('forward', encryptEnvelope({ payload: value, signature: signObject(value, provider.privateKey) }, service.publicKey)) };
  };
  return { store, service, cohort, epoch, payload, submit,
    at(ms) { now = Date.parse(epoch.createdAt) + ms; },
    close() { store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

const operatorSigned = (receipt, keys, change) => {
  const { serverSignature, receiptToken, ...body } = structuredClone(receipt);
  change(body);
  return { ...body, serverSignature: signObject(body, keys.signingPrivateKey) };
};

/** Isolated evidence: no live .data reads/writes, remote RPC, or import-time work. */
export async function runSecurityChallenges({ phase = 'after' } = {}) {
  assert.ok(['before', 'after'].includes(phase));
  const sources = checkpoint(), cases = [];
  const record = (id, type, claim, observation) => cases.push({ id, type, claim, ...observation });
  const f = fixture();
  try {
    const submissions = f.cohort.map(f.submit), trustedKey = f.service.serverSigningKey;
    const accepted = verifyReceipt(submissions[0].receipt, trustedKey);
    assert.equal(accepted.valid, true); assert.equal(accepted.inclusionValid, null);
    record('receipt-before-seal', 'guarantee-boundary', '봉인 전 receipt는 서버 접수 서명이고 Merkle 포함 증명이 아니다.', { verification: accepted, rootPresent: Boolean(submissions[0].receipt.root) });
    f.at(10000);
    f.service.seal('forward', f.epoch.id, { beginPrices: price() });
    const getReceipt = () => f.service.getReceipt('forward', f.epoch.id, f.cohort[0].id, submissions[0].receipt.receiptToken).receipt;
    const receipt = getReceipt();
    assert.equal(verifyReceipt(receipt, trustedKey).valid, true);
    record('receipt-finalized-control', 'enforced', '정상 봉인 receipt의 signature·inclusion·manifest·context가 함께 통과한다.', { verification: verifyReceipt(receipt, trustedKey) });

    const changedLeaf = structuredClone(receipt); changedLeaf.leaf.payloadHash = hash('different payload');
    const changedProof = structuredClone(receipt); changedProof.proof[0].hash = hash('different sibling');
    const changedManifest = structuredClone(receipt); changedManifest.manifest.weightsHash = hash('different weights');
    for (const [id, forged] of [['unsigned-leaf-tamper', changedLeaf], ['unsigned-proof-tamper', changedProof], ['unsigned-manifest-tamper', changedManifest]]) {
      const verification = verifyReceipt(forged, trustedKey);
      assert.equal(verification.valid, false);
      record(id, 'enforced', '서버 서명 없이 receipt의 commitment 내용을 바꾸면 거부한다.', { verification });
    }
    const otherKey = signingPublicKey(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    assert.equal(verifyReceipt(receipt, otherKey).valid, false);
    record('separately-trusted-key', 'enforced', 'receipt 안의 키 대신 별도 신뢰한 서버 키와 비교한다.', { verification: verifyReceipt(receipt, otherKey) });

    const late = operatorSigned(receipt, f.store.keys, body => {
      body.acceptedAt = '2099-01-01T00:00:00.000Z';
      body.cutoffAt = '2020-01-01T00:00:00.000Z';
      body.manifest.sealedAt = '2099-01-01T00:00:00.000Z';
      body.manifestHash = hash(body.manifest);
    });
    const lateVerification = verifyReceipt(late, trustedKey);
    assert.equal(lateVerification.valid, true);
    record('operator-signed-impossible-timestamps', 'trusted-server-boundary', '유효한 receipt는 acceptedAt < cutoffAt, receipt/manifest cutoff 일치, sealedAt < outcome 시작을 검증하지 않는다.', {
      acceptedAt: late.acceptedAt, receiptCutoffAt: late.cutoffAt, manifestCutoffAt: late.manifest.cutoffAt, sealedAt: late.manifest.sealedAt, verification: lateVerification,
    });
    const arbitraryClaims = operatorSigned(receipt, f.store.keys, body => {
      body.policyHash = hash('unknown policy'); body.manifest.policyHash = body.policyHash;
      body.manifest.rosterHash = hash('unpublished replacement roster');
      body.manifest.weightsHash = hash('unpublished replacement weights');
      body.manifest.previousManifestHash = hash('unknown predecessor');
      body.manifestHash = hash(body.manifest);
    });
    const claimsVerification = verifyReceipt(arbitraryClaims, trustedKey);
    assert.equal(claimsVerification.valid, true);
    record('operator-signed-unpublished-policy-roster-weights', 'trusted-server-boundary', 'verifier는 사전에 고정된 정책·roster·weights 원문이나 이전 manifest 이력을 받지 않으므로 그 진실을 검증하지 않는다.', {
      rootUnchanged: arbitraryClaims.root === receipt.root, verification: claimsVerification,
    });

    const sealed = f.store.get('forward');
    f.at(20000);
    const honest = f.service.evaluate('forward', f.epoch.id, { endPrices: price(110) }).epoch;
    f.store.put('forward', structuredClone(sealed));
    const substituted = f.store.get('forward');
    for (const provider of f.cohort) {
      const payload = { ...submissions.find(s => s.payload.providerId === provider.id).payload, vectorBps: [-10000, 0, 0, 0] };
      substituted.epochs[0].submissions[provider.id].envelope = encryptEnvelope({ payload, signature: 'invalid-provider-signature' }, f.service.publicKey);
    }
    f.store.put('forward', substituted);
    const beforeAttempt = f.store.get('forward');
    let changedOutcome, rejection;
    try { changedOutcome = f.service.evaluate('forward', f.epoch.id, { endPrices: price(110) }).epoch; }
    catch (error) { rejection = { status: error.status ?? null, message: error.message }; }
    const stillValid = verifyReceipt(getReceipt(), trustedKey);
    const rollback = JSON.stringify(f.store.get('forward')) === JSON.stringify(beforeAttempt);
    if (phase === 'before') {
      assert.equal(rejection, undefined); assert.notEqual(changedOutcome.evaluation.nav, honest.evaluation.nav);
      assert.equal(changedOutcome.aggregate.targetBps.BTC, honest.aggregate.targetBps.BTC);
    } else {
      assert.equal(rejection?.status, 409); assert.equal(rollback, true);
    }
    assert.equal(stillValid.valid, true);
    record('sealed-envelope-substitution', phase === 'before' ? 'confirmed-defect-before-fix' : 'enforced-after-fix', 'DB 쓰기 권한으로 unsigned 반대 vector 암호문을 넣어도 이미 봉인한 submission을 대신 평가할 수 없어야 한다.', {
      attackerCapability: 'Temporary SQLite write plus public encryption key; no provider/server signing private key used by the attack.',
      honestNav: honest.evaluation.nav, substitutedNav: changedOutcome?.evaluation.nav ?? null,
      unchangedDeclaredExecutionTarget: honest.aggregate.targetBps, rejected: Boolean(rejection), rejection: rejection ?? null,
      stateUnchangedOnRejection: rollback, originalReceiptStillValid: stillValid.valid,
      originalRootUnchanged: getReceipt().root === receipt.root,
    });
  } finally { f.close(); }

  const rollbackFixture = fixture();
  try {
    const a = rollbackFixture.submit(rollbackFixture.cohort[0]);
    rollbackFixture.submit(rollbackFixture.cohort[1]);
    const oldDatabaseSnapshot = rollbackFixture.store.get('forward');
    rollbackFixture.submit(rollbackFixture.cohort[2]);
    rollbackFixture.at(10000);
    rollbackFixture.service.seal('forward', rollbackFixture.epoch.id, { beginPrices: price() });
    const get = () => rollbackFixture.service.getReceipt('forward', rollbackFixture.epoch.id, rollbackFixture.cohort[0].id, a.receipt.receiptToken).receipt;
    const original = get(), key = rollbackFixture.service.serverSigningKey;
    rollbackFixture.at(20000);
    rollbackFixture.service.evaluate('forward', rollbackFixture.epoch.id, { endPrices: price(110) });
    rollbackFixture.store.put('forward', oldDatabaseSnapshot);
    const state = rollbackFixture.service.state('forward');
    const rewritten = get();
    assert.equal(state.epochs[0].status, 'EXPIRED');
    assert.notEqual(original.root, rewritten.root);
    assert.equal(verifyReceipt(original, key).valid, true);
    assert.equal(verifyReceipt(rewritten, key).valid, true);
    record('database-rollback-forks-valid-local-history', 'trusted-server-boundary', '오래된 DB 복원 뒤 다른 local root가 만들어져도 각 receipt는 통과한다. 별도 보관한 과거 root와 비교하면 fork를 검출한다.', {
      oldRoot: original.root, newRoot: rewritten.root, savedRootComparisonMatches: original.root === rewritten.root,
      oldVerification: verifyReceipt(original, key), newVerification: verifyReceipt(rewritten, key),
      previousStatus: 'EVALUATED', rewrittenStatus: state.epochs[0].status,
      sealedAt: rewritten.manifest.sealedAt, outcomeEndAt: rewritten.manifest.endAt,
    });
  } finally { rollbackFixture.close(); }

  const httpFixture = fixture();
  const server = makeHttpServer(httpFixture.service);
  try {
    const submissions = httpFixture.cohort.map(httpFixture.submit);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const send = (path, body) => new Promise((accept, reject) => {
      const request = httpRequest(`http://127.0.0.1:${server.address().port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Host: '127.0.0.1:8790', 'Content-Type': 'application/json', 'X-Local-Client': 'mm-alpha-sdk' },
      }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => accept({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) })); });
      request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify({ workspace: 'forward', ...body }));
    });
    const route = `/api/epochs/${httpFixture.epoch.id}`;
    const earlySeal = await send(route + '/seal', { beginPrices: price() });
    const earlyOutcome = await send(route + '/evaluate', { endPrices: price(110) });
    assert.equal(earlySeal.status, 409); assert.equal(earlyOutcome.status, 409);
    httpFixture.at(10000);
    const atCutoff = await send('/api/state?workspace=forward');
    assert.equal(atCutoff.body.epochs[0].status, 'OPEN');
    const invalidBegin = await send(route + '/seal', { beginPrices: price(0) });
    assert.equal(invalidBegin.status, 400);
    const sealed = await send(route + '/seal', { beginPrices: price() });
    assert.equal(sealed.status, 200); assert.equal(sealed.body.epoch.status, 'AWAITING_OUTCOME');
    const awaiting = await send(route + '/evaluate', { endPrices: price(200) });
    assert.equal(awaiting.status, 409);
    httpFixture.at(20000);
    const beforeInvalid = httpFixture.store.get('forward');
    const invalidEnd = await send(route + '/evaluate', { endPrices: price(-1) });
    assert.equal(invalidEnd.status, 400);
    assert.deepEqual(httpFixture.store.get('forward'), beforeInvalid);
    const assertedOutcome = await send(route + '/evaluate', { endPrices: price(200) });
    assert.equal(assertedOutcome.status, 200); assert.equal(assertedOutcome.body.epoch.evaluation.source, 'USER_ASSERTED');
    const differentRetry = await send(route + '/evaluate', { endPrices: price(300) });
    assert.equal(differentRetry.status, 409);
    const sealAfterOutcome = await send(route + '/seal', { beginPrices: price(999) });
    assert.equal(sealAfterOutcome.status, 200); assert.equal(sealAfterOutcome.body.duplicate, true);
    const receipt = httpFixture.service.getReceipt('forward', httpFixture.epoch.id, httpFixture.cohort[0].id, submissions[0].receipt.receiptToken).receipt;
    record('http-phase-and-outcome-boundaries', 'enforced-and-trusted-boundary', '실제 HTTP route는 조기 실행·평가와 비양수 가격을 거부하지만 양수인 허위 가격을 판별하지 못한다.', {
      clock: 'Injected deterministic server clock; HTTP is real, this is not elapsed wall-clock evidence.',
      earlySeal: earlySeal.status, evaluateBeforeSeal: earlyOutcome.status, statusAtCutoffBeforeSeal: atCutoff.body.epochs[0].status,
      invalidBegin: invalidBegin.status, sealedStatus: sealed.body.epoch.status, evaluateBeforeEnd: awaiting.status,
      invalidEnd: invalidEnd.status, invalidEndLeavesWorkspaceUnchanged: true,
      arbitraryPositiveEndPriceAccepted: assertedOutcome.status, priceSource: assertedOutcome.body.epoch.evaluation.source,
      sameEpochDifferentOutcomeRetry: differentRetry.status, sealAfterEvaluation: { status: sealAfterOutcome.status, duplicate: sealAfterOutcome.body.duplicate },
      verification: verifyReceipt(receipt, httpFixture.service.serverSigningKey),
    });
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    httpFixture.close();
  }

  const artifact = await compileRegistry(), registry = await createLocalRegistry(artifact);
  await registry.deploy();
  const synthetic = normalizeManifest({ epochId: 'security-publisher-assertion', root: hash('root without a real roster'), manifestHash: hash('manifest not supplied or checked') });
  await assert.rejects(registry.transact('anchor', [synthetic.epochKey, synthetic.root, synthetic.manifestHash], 1), /Unauthorized/);
  await registry.transact('anchor', [synthetic.epochKey, synthetic.root, synthetic.manifestHash]);
  const [stored] = await registry.read('getCommitment', [synthetic.epochKey]);
  await assert.rejects(registry.transact('anchor', [synthetic.epochKey, hash('replacement root'), synthetic.manifestHash]), /AlreadyAnchored/);
  assert.equal(stored.root, synthetic.root);
  record('contract-immutable-bytes-not-fact-check', 'enforced-and-trusted-boundary', '실제 로컬 EVM은 publisher 권한·동일 epoch 불변성을 강제한다. nonzero digest만으로 제출·정책·가격의 진실은 증명하지 않는다.', {
    environment: 'LOCAL_EVM', remoteChainUsed: false, publisherArbitraryNonzeroDigestsAccepted: true,
    unauthorizedPublisherRejected: true, overwriteRejected: true, blockTimestampIsSynthetic: true,
    compilerVersion: artifact.compilerVersion, sourceSha256: artifact.sourceSha256,
  });
  assert.deepEqual(checkpoint(), sources, 'Source files changed during evidence execution; rerun for a coherent checkpoint.');
  return {
    evidenceVersion: 'security-challenges-v1', phase, generatedAt: new Date().toISOString(), runtime: process.version,
    sourceCheckpoint: { algorithm: 'SHA256', files: sources, vcsCommit: null, note: 'Workspace has no .git metadata; file hashes identify the executed source snapshot.' },
    isolation: { temporaryDatabasesOnly: true, liveDataTouched: false, externalNetworkUsed: false, artificialClockExplicit: true },
    observedExpectationsSatisfied: true,
    verdictScope: 'These are separate guarantees and counterexamples, not an MVP sufficiency score or pass percentage.',
    cases,
    remainingBoundaries: [
      'Server signing identity, clock, user-asserted prices, roster completeness and calculation still rely on the local operator.',
      'Receipt verification does not accept an independent prior root/policy/roster/weights or verify outcome calculations.',
      'Saved old receipts/roots allow comparison that detects changed commitments; a standalone new receipt cannot prove absence of rollback.',
      'No TEE, independent timestamp, authenticated market feed, external chain finality, investor custody or real execution is established here.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phaseIndex = process.argv.indexOf('--phase');
  const phase = phaseIndex < 0 ? 'after' : process.argv[phaseIndex + 1];
  runSecurityChallenges({ phase }).then(report => {
    const path = join(projectRoot, 'docs/evidence', phase === 'before' ? 'security-challenges-before.json' : 'security-challenges.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ phase, observedExpectationsSatisfied: report.observedExpectationsSatisfied, cases: report.cases.map(({ id, type }) => ({ id, type })), output: path }, null, 2));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
