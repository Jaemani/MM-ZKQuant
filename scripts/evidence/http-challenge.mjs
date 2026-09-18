// Independent client: no imports from the application's service, engine or crypto.
// It talks to a fresh real HTTP process, uses the real wall clock, and compares
// results against constants derived before the run. Prices are controlled inputs.
import { createCipheriv, createHash, createPublicKey, generateKeyPairSync, publicEncrypt, randomBytes, sign, verify, constants } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const encode = value => Array.isArray(value) ? '[' + value.map(encode).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + encode(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => '0x' + createHash('sha256').update(typeof value === 'string' ? value : encode(value)).digest('hex');
const UNIVERSE = ['BTC', 'ETH', 'MON', 'SOL'];

function envelope(payload, privateKey, serverKey) {
  const signature = sign(null, Buffer.from(encode(payload)), privateKey).toString('base64');
  const aes = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', aes, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ payload, signature })), cipher.final(), cipher.getAuthTag()]);
  return { wrappedKey: publicEncrypt({ key: createPublicKey({ key: serverKey, format: 'jwk' }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes).toString('base64'), iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') };
}

// The verifier checks the original provider opening as well as inclusion. It
// intentionally makes no claim about an independently authenticated timestamp.
export function independentReceiptCheck(receipt, trustedKey, originalPayload) {
  const { serverSignature, receiptToken, ...body } = receipt;
  const key = createPublicKey({ key: Buffer.from(trustedKey, 'base64'), format: 'der', type: 'spki' });
  const signature = verify(null, Buffer.from(encode(body)), key, Buffer.from(serverSignature, 'base64'));
  let current = digest('00' + encode(receipt.leaf));
  const leafMatches = current === receipt.leafHash;
  for (const sibling of receipt.proof) {
    const hashes = sibling.side === 'left' ? [sibling.hash, current] : [current, sibling.hash];
    current = '0x' + createHash('sha256').update(Buffer.from([1])).update(Buffer.from(hashes[0].slice(2), 'hex')).update(Buffer.from(hashes[1].slice(2), 'hex')).digest('hex');
  }
  const included = leafMatches && current === receipt.root;
  const opening = digest(originalPayload) === receipt.leaf.payloadHash;
  const manifest = digest(receipt.manifest) === receipt.manifestHash && receipt.manifest.submissionRoot === receipt.root && receipt.manifest.epochId === receipt.epochId;
  const context = originalPayload.epochId === receipt.epochId && originalPayload.providerId === receipt.providerId && originalPayload.policyHash === receipt.policyHash;
  return { valid: signature && included && opening && manifest && context, signature, included, opening, manifest, context, independentTimeProof: false };
}

async function availablePort() {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}

export async function runHttpChallenge({ progress = () => {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'alpha-blackbox-evidence-'));
  const port = await availablePort(), base = `http://127.0.0.1:${port}`;
  const transcript = [], checks = [], startedAt = new Date().toISOString();
  let child, lastError = '';
  const check = (id, claim, expected, actual) => {
    const pass = typeof expected === 'number' ? Math.abs(expected - actual) < 0.000001 : encode(expected) === encode(actual);
    checks.push({ id, claim, expected, actual, pass });
    if (!pass) throw new Error(`${id}: expected ${encode(expected)}, got ${encode(actual)}`);
  };
  const request = async (path, body, headers = {}) => {
    const before = new Date().toISOString();
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Client': 'mm-alpha-sdk', ...headers }, body: body === undefined ? undefined : JSON.stringify({ ...body, workspace: 'forward' }), signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    // No bearer tokens, keys or encrypted bodies in the public transcript.
    transcript.push({ at: before, method: body === undefined ? 'GET' : 'POST', path, status: response.status, error: value.error ?? null });
    return { status: response.status, value };
  };
  const must = async (path, body, headers) => { const response = await request(path, body, headers); if (response.status >= 400) throw new Error(`${path}: ${response.value.error}`); return response.value; };
  async function start() {
    child = spawn(process.execPath, ['src/server/http.js'], { cwd: project, env: { ...process.env, PORT: String(port), ALPHA_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.on('data', chunk => { lastError = String(chunk).slice(-2000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Isolated API failed to start: ' + lastError);
      try { const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) }); if (response.ok) return; } catch { /* wait for this child to bind */ }
      await delay(100);
    }
    throw new Error('Isolated API did not become ready');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  try {
    await start(); progress('독립 HTTP 서버와 새 장부를 시작했습니다.');
    const initial = await must('/api/state?workspace=forward');
    const pinnedKey = (await must('/api/verification-key')).publicKey;
    const providers = [];
    for (const name of ['Bull', 'Bear', 'Neutral', 'Missing']) {
      const keys = generateKeyPairSync('ed25519');
      const { provider } = await must('/api/providers', { name, kind: 'HUMAN', publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') });
      providers.push({ ...provider, keys });
    }
    const { epoch } = await must('/api/epochs', { durationSeconds: 10, evaluationSeconds: 10 });
    const vectors = [[10000, 0, 0, 0], [-9000, 0, 0, 0], [0, 0, 0, 0], [10000, 0, 0, 0]];
    const payloads = providers.map((p, i) => ({ version: 1, providerId: p.id, epochId: epoch.id, policyHash: epoch.policyHash, universe: UNIVERSE, vectorBps: vectors[i], nonce: randomBytes(32).toString('hex') }));
    const foreign = await request('/api/submissions', envelope(payloads[0], providers[1].keys.privateKey, initial.serverPublicKey));
    check('H01', '다른 키로 provider를 사칭하면 거부한다', 401, foreign.status);
    const accepted = [];
    for (let index = 0; index < 3; index++) accepted.push((await must('/api/submissions', envelope(payloads[index], providers[index].keys.privateKey, initial.serverPublicKey))).receipt);
    const retry = await must('/api/submissions', envelope(payloads[0], providers[0].keys.privateKey, initial.serverPublicKey));
    check('H02', '같은 서명 판단의 재전송은 한 건으로 처리한다', true, retry.duplicate && retry.receipt.leafHash === accepted[0].leafHash);
    const replacement = await request('/api/submissions', envelope({ ...payloads[0], vectorBps: [-10000, 0, 0, 0] }, providers[0].keys.privateKey, initial.serverPublicKey));
    check('H03', '본인 키여도 승인된 alpha를 교체할 수 없다', 409, replacement.status);
    const beginPrices = { BTC: 100, ETH: 100, MON: 100, SOL: 100 };
    check('H04', '실제 마감 전 봉인은 거부한다', 409, (await request(`/api/epochs/${epoch.id}/seal`, { beginPrices })).status);
    progress('마감까지 실제 10초를 기다립니다. 시계 가속 경로는 사용하지 않습니다.');
    await delay(Math.max(0, Date.parse(epoch.cutoffAt) - Date.now() + 50));
    check('H05', '마감 뒤 새 판단은 거부한다', 409, (await request('/api/submissions', envelope(payloads[3], providers[3].keys.privateKey, initial.serverPublicKey))).status);
    const sealed = (await must(`/api/epochs/${epoch.id}/seal`, { beginPrices })).epoch;
    check('H06', '누락된 provider도 roster에 남는다', 1, sealed.missedCount);
    check('H07', '상반된 BTC 의견은 순 1%만 거래한다', 100, sealed.aggregate.targetBps.BTC);
    check('H08', '외부로 보낼 모의 주문은 $1,000 한 건이다', 1000, sealed.execution.turnoverNotional);
    check('H09', '모의 fee와 slippage 합은 $1.50이다', 1.5, sealed.execution.cost);
    const receipt = (await must(`/api/receipts/${epoch.id}/${providers[0].id}?workspace=forward`, undefined, { Authorization: 'Bearer ' + accepted[0].receiptToken })).receipt;
    const independent = independentReceiptCheck(receipt, pinnedKey, payloads[0]);
    check('H10', '서버의 검증 코드를 쓰지 않고 원 제출의 포함을 확인한다', true, independent.valid);
    const changedOpening = independentReceiptCheck(receipt, pinnedKey, { ...payloads[0], vectorBps: [-10000, 0, 0, 0] });
    check('H11', '영수증을 유지하고 제출 vector만 바꾸면 독립 검증이 실패한다', false, changedOpening.valid);
    const changedReceipt = structuredClone(receipt); changedReceipt.leaf.payloadHash = '0x' + 'ab'.repeat(32);
    check('H12', '공개 receipt를 고쳐도 독립 검증이 실패한다', false, independentReceiptCheck(changedReceipt, pinnedKey, payloads[0]).valid);
    const endPrices = { BTC: 110, ETH: 100, MON: 100, SOL: 100 };
    check('H13', '평가 구간이 끝나기 전에는 결과 입력을 거부한다', 409, (await request(`/api/epochs/${epoch.id}/evaluate`, { endPrices })).status);
    progress('평가 종료까지 실제 시간을 기다립니다. 가격은 명시적으로 통제한 손계산 fixture입니다.');
    await delay(Math.max(0, Date.parse(epoch.endAt) - Date.now() + 50));
    const evaluated = (await must(`/api/epochs/${epoch.id}/evaluate`, { endPrices })).epoch;
    const state = await must('/api/state?workspace=forward');
    const bull = state.providers.find(p => p.id === providers[0].id), bear = state.providers.find(p => p.id === providers[1].id);
    check('H14', '$100,000의 순 1% 노출, BTC +10%, 비용 $1.50 → NAV $100,098.50', 100098.5, state.book.nav);
    check('H15', 'Bull standalone: +25% 노출 수익에서 $37.50 비용 차감', 102462.5, bull.metrics.shadowNav);
    check('H16', 'Bear standalone: −25% 노출 손실과 $37.50 비용 차감', 97462.5, bear.metrics.shadowNav);
    check('H17', 'Bull의 같은 초기 장부 기준 LOO 기여도는 +101.20 bps', 101.2, bull.metrics.contribution * 10000);
    check('H18', 'Bear의 같은 초기 장부 기준 LOO 기여도는 −88.65 bps', -88.65, bear.metrics.contribution * 10000);
    check('H19', '누락자는 submitted=0, missed=1이다', [0, 1], [state.providers[3].submitted, state.providers[3].missed]);
    const publicState = JSON.stringify(state);
    check('H20', '공개 응답에 개인 vector·nonce·암호문·키를 내보내지 않는다', false, ['"vectorBps"', '"nonce"', '"ciphertext"', '"privateKey"'].some(field => publicState.includes(field)));
    check('H21', '한번 정산한 결과를 다른 가격으로 덮어쓸 수 없다', 409, (await request(`/api/epochs/${epoch.id}/evaluate`, { endPrices: { ...endPrices, BTC: 120 } })).status);
    await stop(); await start();
    const restarted = await must('/api/state?workspace=forward');
    check('H22', '실제 프로세스 재시작 뒤 NAV·root를 보존한다', [state.book.nav, sealed.root], [restarted.book.nav, restarted.epochs[0].root]);
    const repeated = await must(`/api/epochs/${epoch.id}/evaluate`, { endPrices });
    const repeatedState = await must('/api/state?workspace=forward');
    check('H23', '재시작 후 정산 재전송도 NAV·이력·credit을 중복 반영하지 않는다', true, repeated.duplicate && repeatedState.book.nav === state.book.nav && repeatedState.providers[0].metrics.samples === 1 && repeatedState.providers[0].metrics.rewardCredits === bull.metrics.rewardCredits);
    const report = {
      schema: 'mvp-blackbox-evidence-v1', startedAt, finishedAt: new Date().toISOString(),
      mode: 'REAL_HTTP_REAL_PROCESS_REAL_CLOCK_CONTROLLED_PRICES', existingUserDataTouched: false,
      seedCapital: 100000, providerFixture: providers.map((p, index) => ({ id: p.id, name: p.name, vectorBps: vectors[index], submitted: index < 3, expectedFrozenWeightBps: 1000 })),
      beginPrices, endPrices, epochId: epoch.id, cutoffAt: epoch.cutoffAt, endAt: epoch.endAt,
      oracle: { targetBps: 100, orderNotional: 1000, feesAndSlippage: 1.5, pnl: 98.5, nav: 100098.5, bullShadowNav: 102462.5, bearShadowNav: 97462.5, bullContributionBps: 101.2, bearContributionBps: -88.65 },
      observed: { execution: sealed.execution, evaluation: evaluated.evaluation, bull: bull.metrics, bear: bear.metrics, missing: state.providers[3] },
      checks, transcript, receiptEvidence: { pinnedServerKey: pinnedKey, originalPayload: payloads[0], receipt, verification: independent },
      boundaries: { keyTrustedFromLocalServer: true, independentTimeProof: false, marketPriceProvenance: evaluated.evaluation.source, actualVenueFill: false, onchainCapital: false, actualPayout: false, tee: false },
    };
    progress('HTTP 제출·거부·손계산 대조·독립 영수증 검증·재시작 검증을 마쳤습니다.');
    return report;
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHttpChallenge({ progress: message => process.stderr.write(message + '\n') }).then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
