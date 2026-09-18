import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { canonicalJson, UNIVERSE } from '../shared/protocol.js';
import { aggregate, chooseWeights, DEFAULT_RISK, ENGINE_VERSION, evaluateOutcome, planExecution, validateVector, markBook } from '../core/engine.js';
import { decryptEnvelope, encryptEnvelope, hash, leafHash, merkleTree, parsePublicKey, secureEqual, signObject, signingPublicKey, tokenFor, verifyObject } from './crypto.js';

export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const insist = (condition, message, status = 400) => { if (!condition) throw new AppError(message, status); };
const round = value => Number(value.toFixed(8));
const zeros = () => Object.fromEntries(UNIVERSE.map(asset => [asset, 0]));
const BASE_PRICES = { BTC: 60000, ETH: 2500, MON: 0.035, SOL: 150 };
export const POLICY = Object.freeze({ version: 'alpha-policy-v1', engineVersion: ENGINE_VERSION, universe: UNIVERSE, ...DEFAULT_RISK, maxOrderNotional: 2500, rewardPoolUnits: 10000, valuation: 'SYNTHETIC_LINEAR_EXPOSURE', contribution: 'ONE_EPOCH_LEAVE_ONE_OUT', missing: 'ZERO_SIGNAL_NO_REWEIGHT', receiptHash: 'SHA256_POSITIONAL_V1' });
const policyHash = hash(POLICY);
const demoNames = ['Atlas Momentum', '김 트레이더', 'Orion Macro', 'Delta Neutral', 'Seoul Signal', 'Wave Research', 'Vector AI', 'North Star', '한강 Quant', 'Arbor Value'];
function validPrices(prices) { return prices && typeof prices === 'object' && Object.keys(prices).length === UNIVERSE.length && UNIVERSE.every(a => Number.isFinite(prices[a]) && prices[a] > 0 && prices[a] < 1e12); }

export class AlphaService {
  constructor(store, { clock = () => Date.now() } = {}) {
    this.store = store;
    this.clock = clock;
    this.keys = store.keys;
    this.publicKey = createPublicKey(this.keys.encryptionPrivateKey);
    this.serverPublicKey = this.publicKey.export({ format: 'jwk' });
    this.serverSigningKey = signingPublicKey(this.keys.signingPrivateKey);
    for (const workspace of ['demo', 'forward']) if (!store.get(workspace)) store.put(workspace, this.initial(workspace));
  }
  initial(workspace) {
    return { workspace, virtualNow: this.clock(), providers: [], epochs: [], shadows: encryptEnvelope({}, this.publicKey),
      book: { nav: 100000, peakNav: 100000, maxDrawdownBps: 0, weightsBps: zeros(), shares: 100000, totalDeposited: 100000, totalWithdrawn: 0, marks: BASE_PRICES, history: [], flows: [{ type: 'SEED_PAPER_CAPITAL', amount: 100000, shares: 100000 }] } };
  }
  workspace(value = 'demo') { insist(['demo', 'forward'].includes(value), 'Unknown workspace'); return value; }
  now(state) { return state.workspace === 'demo' ? state.virtualNow : this.clock(); }
  run(workspace, callback) {
    workspace = this.workspace(workspace);
    return this.store.transaction(workspace, state => callback(state));
  }
  epoch(state, id) { const epoch = state.epochs.find(e => e.id === id); insist(epoch, 'Epoch not found', 404); return epoch; }
  active(state) { return state.epochs.find(e => ['OPEN', 'AWAITING_OUTCOME'].includes(e.status)); }
  payloadProviders(epoch) {
    const message = 'Stored epoch commitment or submission is invalid; operation rejected';
    const check = condition => insist(condition, message, 409);
    try {
      // Encryption authenticates a ciphertext, not its relationship to the
      // accepted submission. Bind every input again before using it in a book.
      check(hash(epoch.policy) === epoch.policyHash);
      check(epoch.manifest?.domain === 'MM_ALPHA_EPOCH_V1' && hash(epoch.manifest) === epoch.manifestHash);
      check(epoch.manifest.epochId === epoch.id && epoch.manifest.workspace === epoch.workspace
        && epoch.manifest.policyHash === epoch.policyHash && epoch.manifest.submissionRoot === epoch.root);
      check(hash(epoch.roster) === epoch.manifest.rosterHash && hash(epoch.weightsBps) === epoch.manifest.weightsHash);
      check(epoch.leaves.length === epoch.roster.length && merkleTree(epoch.leaves).root === epoch.root);
      const rosterIds = new Set(epoch.roster.map(provider => provider.id));
      check(rosterIds.size === epoch.roster.length && Object.keys(epoch.submissions).every(id => rosterIds.has(id)));
      return epoch.roster.map((provider, index) => {
        const leaf = epoch.leaves[index], submission = epoch.submissions[provider.id];
        check(leaf.domain === 'MM_ALPHA_SUBMISSION_V1' && leaf.epochId === epoch.id && leaf.providerId === provider.id);
        if (!submission) {
          check(leaf.status === 'MISSED' && typeof leaf.salt === 'string' && /^[0-9a-f]{64}$/.test(leaf.salt));
          return { id: provider.id, vectorBps: null };
        }
        const { payload, signature } = decryptEnvelope(submission.envelope, this.keys.encryptionPrivateKey) ?? {};
        check(payload && typeof payload === 'object' && !Array.isArray(payload));
        check(Object.keys(payload).sort().join(',') === ['version', 'providerId', 'epochId', 'policyHash', 'universe', 'vectorBps', 'nonce'].sort().join(','));
        check(payload.version === 1 && typeof payload.nonce === 'string' && /^[0-9a-f]{64}$/.test(payload.nonce));
        check(payload.providerId === provider.id && payload.epochId === epoch.id && payload.policyHash === epoch.policyHash
          && canonicalJson(payload.universe) === canonicalJson(UNIVERSE));
        check(Array.isArray(payload.vectorBps) && payload.vectorBps.length === UNIVERSE.length);
        const vectorBps = Object.fromEntries(UNIVERSE.map((asset, i) => [asset, payload.vectorBps[i]]));
        validateVector(vectorBps);
        check(verifyObject(payload, signature, provider.publicKey));
        const payloadHash = hash(payload);
        const expectedLeaf = { domain: 'MM_ALPHA_SUBMISSION_V1', epochId: epoch.id, providerId: provider.id, status: 'SUBMITTED', payloadHash };
        check(submission.payloadHash === payloadHash && canonicalJson(submission.leaf) === canonicalJson(expectedLeaf)
          && submission.leafHash === leafHash(expectedLeaf) && canonicalJson(leaf) === canonicalJson(expectedLeaf));
        return { id: provider.id, vectorBps };
      });
    } catch { throw new AppError(message, 409); }
  }
  register(workspace, input) {
    return this.run(workspace, state => this.registerInternal(state, input));
  }
  registerInternal(state, input) {
    insist(typeof input.name === 'string' && input.name.trim().length >= 2 && input.name.trim().length <= 50, 'Provider name must contain 2–50 characters');
    insist(['HUMAN', 'QUANT', 'AI'].includes(input.kind), 'Provider kind must be HUMAN, QUANT or AI');
    try { parsePublicKey(input.publicKey); } catch { throw new AppError('Valid Ed25519 public key required'); }
    insist(!state.providers.some(p => p.publicKey === input.publicKey), 'This signing key is already registered', 409);
    insist(state.providers.length < 100, 'Local MVP supports up to 100 providers');
    const provider = { id: randomUUID(), name: input.name.trim(), kind: input.kind, publicKey: input.publicKey, registeredAt: new Date(this.now(state)).toISOString(), history: [] };
    state.providers.push(provider);
    return { provider: this.providerView(state, provider) };
  }
  createEpoch(workspace, input = {}) {
    return this.run(workspace, state => this.createInternal(state, input));
  }
  createInternal(state, input) {
    this.expireOpen(state);
    insist(!this.active(state), 'Finish the active epoch before opening another one', 409);
    insist(state.providers.length > 0, 'Register a provider before opening an epoch');
    insist(state.book.nav > 0, 'Paper book has no capital; deposit before opening an epoch');
    const duration = input.durationSeconds ?? 60, evaluation = input.evaluationSeconds ?? 3600;
    insist(Number.isInteger(duration) && duration >= 10 && duration <= 86400, 'Submission window must be 10–86400 seconds');
    insist(Number.isInteger(evaluation) && evaluation >= 10 && evaluation <= 86400, 'Evaluation window must be 10–86400 seconds');
    const now = this.now(state), cutoff = now + duration * 1000;
    const roster = state.providers.map(({ id, publicKey }) => ({ id, publicKey })).sort((a, b) => a.id.localeCompare(b.id));
    const weightedProviders = state.providers.map(provider => ({ ...provider, history: state.epochs.filter(e => ['EVALUATED', 'EXPIRED'].includes(e.status) && e.roster.some(p => p.id === provider.id)).map(e => provider.history.find(row => row.epochId === e.id) ?? { status: e.submissions[provider.id] ? 'SUBMITTED_UNEVALUATED' : 'MISSED' }) }));
    const weightResult = chooseWeights(weightedProviders, { providerCapBps: POLICY.providerCapBps });
    const epoch = { id: randomUUID(), sequence: state.epochs.length + 1, workspace: state.workspace, status: 'OPEN', createdAt: new Date(now).toISOString(), cutoffAt: new Date(cutoff).toISOString(), startAt: new Date(cutoff).toISOString(), endAt: new Date(cutoff + evaluation * 1000).toISOString(),
      policy: structuredClone(POLICY), policyHash, roster, weightsBps: weightResult.weightsBps, unallocatedBps: weightResult.unallocatedBps,
      submissions: {}, leaves: [], proofs: [], root: null, manifestHash: null, anchor: { status: 'LOCAL_ONLY', chain: null }, mode: state.workspace === 'demo' ? 'SYNTHETIC_DEMO' : 'WALL_CLOCK_USER_ASSERTED_MARKS' };
    state.epochs.push(epoch);
    return { epoch: this.epochView(epoch) };
  }
  receipt(state, epoch, providerId, includeToken = false) {
    const submission = epoch.submissions[providerId];
    insist(submission, 'Submission not found', 404);
    const body = { version: 1, workspace: state.workspace, epochId: epoch.id, providerId, acceptedAt: submission.acceptedAt, cutoffAt: epoch.cutoffAt,
      policyHash: epoch.policyHash, leafHash: submission.leafHash, leaf: submission.leaf, clock: state.workspace === 'demo' ? 'SIMULATED' : 'WALL',
      trust: 'TRUSTED_SERVER_NO_TEE', serverPublicKey: this.serverSigningKey };
    if (epoch.root) {
      Object.assign(body, { root: epoch.root, proof: epoch.proofs[epoch.roster.findIndex(p => p.id === providerId)], manifest: epoch.manifest, manifestHash: epoch.manifestHash, anchor: epoch.anchor });
    }
    const result = { ...body, serverSignature: signObject(body, this.keys.signingPrivateKey) };
    if (includeToken) result.receiptToken = tokenFor(this.keys, epoch.id, providerId, submission.leafHash);
    return result;
  }
  submit(workspace, envelope) {
    return this.run(workspace, state => this.submitInternal(state, envelope));
  }
  submitInternal(state, envelope) {
    let decoded;
    try { decoded = decryptEnvelope(envelope, this.keys.encryptionPrivateKey); } catch { throw new AppError('Encrypted submission could not be verified'); }
    const { payload, signature } = decoded ?? {};
    insist(payload && typeof payload === 'object' && !Array.isArray(payload), 'Invalid submission payload');
    insist(Object.keys(payload).sort().join(',') === ['version','providerId','epochId','policyHash','universe','vectorBps','nonce'].sort().join(','), 'Submission fields do not match protocol v1');
    insist(payload.version === 1 && typeof payload.nonce === 'string' && /^[0-9a-f]{64}$/.test(payload.nonce), 'Protocol version or 256-bit nonce is invalid');
    const epoch = this.epoch(state, payload.epochId), provider = epoch.roster.find(p => p.id === payload.providerId);
    insist(provider, 'Provider is not in this epoch roster');
    insist(payload.policyHash === epoch.policyHash && canonicalJson(payload.universe) === canonicalJson(UNIVERSE), 'Policy or universe does not match this epoch');
    insist(Array.isArray(payload.vectorBps) && payload.vectorBps.length === UNIVERSE.length, 'Vector must contain exactly four integer basis-point values');
    try { validateVector(Object.fromEntries(UNIVERSE.map((asset, i) => [asset, payload.vectorBps[i]]))); } catch { throw new AppError('Vector values must be integers from -10000 to 10000'); }
    insist(verifyObject(payload, signature, provider.publicKey), 'Provider signature is invalid', 401);
    const payloadHash = hash(payload), existing = epoch.submissions[provider.id];
    if (existing) {
      insist(existing.payloadHash === payloadHash, 'A different submission is already accepted for this epoch', 409);
      return { receipt: this.receipt(state, epoch, provider.id, true), duplicate: true };
    }
    insist(epoch.status === 'OPEN' && this.now(state) < Date.parse(epoch.cutoffAt), 'Submission cutoff has passed', 409);
    const leaf = { domain: 'MM_ALPHA_SUBMISSION_V1', epochId: epoch.id, providerId: provider.id, status: 'SUBMITTED', payloadHash };
    const cleanEnvelope = { wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
    epoch.submissions[provider.id] = { envelope: cleanEnvelope, acceptedAt: new Date(this.now(state)).toISOString(), payloadHash, leaf, leafHash: leafHash(leaf) };
    return { receipt: this.receipt(state, epoch, provider.id, true), duplicate: false };
  }
  getReceipt(workspace, epochId, providerId, token) {
    const state = this.store.get(this.workspace(workspace)), epoch = this.epoch(state, epochId), submission = epoch.submissions[providerId];
    insist(submission && secureEqual(token, tokenFor(this.keys, epochId, providerId, submission.leafHash)), 'Receipt access denied', 403);
    return { receipt: this.receipt(state, epoch, providerId) };
  }
  freezeRoot(state, epoch) {
    epoch.leaves = epoch.roster.map(provider => epoch.submissions[provider.id]?.leaf ?? { domain: 'MM_ALPHA_SUBMISSION_V1', epochId: epoch.id, providerId: provider.id, status: 'MISSED', salt: randomBytes(32).toString('hex') });
    const tree = merkleTree(epoch.leaves);
    epoch.root = tree.root; epoch.proofs = tree.proofs;
    const previous = state.epochs.filter(e => e.sequence < epoch.sequence && e.manifestHash).at(-1);
    epoch.manifest = { domain: 'MM_ALPHA_EPOCH_V1', epochId: epoch.id, workspace: state.workspace, policyHash: epoch.policyHash, rosterHash: hash(epoch.roster), weightsHash: hash(epoch.weightsBps), submissionRoot: tree.root, cutoffAt: epoch.cutoffAt, startAt: epoch.startAt, endAt: epoch.endAt, sealedAt: new Date(this.now(state)).toISOString(), previousManifestHash: previous?.manifestHash ?? null, clock: state.workspace === 'demo' ? 'SIMULATED' : 'WALL' };
    epoch.manifestHash = hash(epoch.manifest);
    epoch.sealedAt = epoch.manifest.sealedAt;
  }
  expireOpen(state) {
    const epoch = state.epochs.find(e => e.status === 'OPEN' && this.now(state) >= Date.parse(e.endAt));
    if (!epoch) return;
    this.freezeRoot(state, epoch);
    epoch.status = 'EXPIRED'; epoch.failureReason = 'No execution mark was supplied before the evaluation window ended';
  }
  seal(workspace, epochId, input = {}) {
    return this.run(workspace, state => this.sealInternal(state, this.epoch(state, epochId), input));
  }
  sealInternal(state, epoch, input) {
    if (epoch.status !== 'OPEN') return { epoch: this.epochView(epoch), duplicate: true };
    if (state.workspace === 'demo') state.virtualNow = Math.max(state.virtualNow, Date.parse(epoch.cutoffAt));
    insist(this.now(state) >= Date.parse(epoch.cutoffAt), 'The submission window is still open', 409);
    if (this.now(state) >= Date.parse(epoch.endAt)) { this.expireOpen(state); return { epoch: this.epochView(epoch) }; }
    const prices = state.workspace === 'demo' ? state.book.marks : input.beginPrices;
    insist(validPrices(prices), 'Forward sealing requires positive BTC, ETH, MON and SOL beginPrices');
    // A delayed operator close starts evaluation only after its actual close.
    // Keep the frozen end time: less time remains; never backdate the entry mark.
    epoch.startAt = new Date(this.now(state)).toISOString();
    this.freezeRoot(state, epoch);
    epoch.beginPrices = { ...prices };
    epoch.priceSource = state.workspace === 'demo' ? 'SYNTHETIC_FIXTURE' : 'USER_ASSERTED';
    const priorShadows = decryptEnvelope(state.shadows, this.keys.encryptionPrivateKey);
    const marked = markBook(state.book, state.book.marks, prices);
    if (marked.nav !== state.book.nav) state.book.history.push({ epochId: epoch.id, type: 'GAP_MARK', nav: marked.nav, return: marked.netReturnBps / 10000 });
    Object.assign(state.book, marked, { marks: { ...prices } });
    state.book.maxDrawdownBps = Math.min(state.book.maxDrawdownBps ?? 0, marked.drawdownBps);
    for (const id of Object.keys(priorShadows)) priorShadows[id] = markBook(priorShadows[id], priorShadows[id].marks ?? state.book.marks, prices);
    state.shadows = encryptEnvelope(priorShadows, this.publicKey);
    epoch.previousBook = { nav: state.book.nav, peakNav: state.book.peakNav, maxDrawdownBps: state.book.maxDrawdownBps, weightsBps: { ...state.book.weightsBps } };
    const providers = this.payloadProviders(epoch);
    epoch.aggregate = aggregate({ providers, weightsBps: epoch.weightsBps, previousWeightsBps: state.book.weightsBps, risk: epoch.policy });
    if (epoch.aggregate.status === 'SKIPPED') { epoch.aggregate.rawBps = null; epoch.aggregate.nettingRatio = null; }
    epoch.execution = { ...planExecution({ targetBps: epoch.aggregate.targetBps, currentWeightsBps: state.book.weightsBps, nav: state.book.nav, prices, feeBps: epoch.policy.feeBps, slippageBps: epoch.policy.slippageBps, maxOrderNotional: epoch.policy.maxOrderNotional }), mode: 'PAPER', status: 'SIMULATED', executedAt: epoch.startAt };
    // Costs and positions become final together with the interval valuation.
    // Cash flows stay locked until that atomic settlement.
    epoch.status = 'AWAITING_OUTCOME';
    return { epoch: this.epochView(epoch) };
  }
  evaluate(workspace, epochId, input = {}) {
    return this.run(workspace, state => this.evaluateInternal(state, this.epoch(state, epochId), input));
  }
  evaluateInternal(state, epoch, input) {
    if (epoch.status === 'EVALUATED') {
      if (input.endPrices) insist(hash(input.endPrices) === hash(epoch.endPrices), 'Outcome already finalized with different marks', 409);
      return { epoch: this.epochView(epoch), duplicate: true };
    }
    insist(epoch.status === 'AWAITING_OUTCOME', 'Seal and execute this epoch before evaluation', 409);
    if (state.workspace === 'demo') state.virtualNow = Math.max(state.virtualNow, Date.parse(epoch.endAt));
    insist(this.now(state) >= Date.parse(epoch.endAt), 'Evaluation window has not ended', 409);
    const prices = state.workspace === 'demo' ? this.syntheticPrices(epoch) : input.endPrices;
    insist(validPrices(prices), 'Evaluation requires positive BTC, ETH, MON and SOL endPrices');
    const result = evaluateOutcome({ providers: this.payloadProviders(epoch), weightsBps: epoch.weightsBps, beginPrices: epoch.beginPrices, endPrices: prices, previousBook: epoch.previousBook, previousShadows: decryptEnvelope(state.shadows, this.keys.encryptionPrivateKey), risk: epoch.policy, rewardPoolUnits: epoch.policy.rewardPoolUnits });
    const nextShadows = decryptEnvelope(state.shadows, this.keys.encryptionPrivateKey);
    for (const row of result.providerResults) {
      nextShadows[row.providerId] = { ...row.shadowBook, marks: prices };
      const { targetBps, shadowBook, ...record } = row;
      state.providers.find(p => p.id === row.providerId).history.push({ ...record, epochId: epoch.id, evaluatedAt: new Date(this.now(state)).toISOString(), rewardCredits: result.rewardPreview.credits[row.providerId], shadowNav: shadowBook.nav });
    }
    state.shadows = encryptEnvelope(nextShadows, this.publicKey);
    Object.assign(state.book, result.book, { marks: prices });
    state.book.maxDrawdownBps = Math.min(state.book.maxDrawdownBps ?? 0, result.book.drawdownBps);
    state.book.history.push({ epochId: epoch.id, type: 'EPOCH', nav: result.book.nav, return: result.book.netReturnBps / 10000 });
    epoch.endPrices = prices; epoch.status = 'EVALUATED'; epoch.evaluatedAt = new Date(this.now(state)).toISOString();
    epoch.evaluation = { fundReturn: result.book.netReturnBps / 10000, nav: result.book.nav, pnl: result.book.pnl, returns: Object.fromEntries(UNIVERSE.map(a => [a, result.returnsBps[a] / 10000])),
      contributions: result.providerResults.map(r => ({ providerId: r.providerId, contribution: r.marginalContributionBps / 10000, credits: result.rewardPreview.credits[r.providerId] })), rewardPreview: result.rewardPreview, source: epoch.priceSource, lossBeyondCapital: result.book.lossBeyondCapital, bankrupt: result.book.bankrupt };
    return { epoch: this.epochView(epoch) };
  }
  syntheticPrices(epoch) {
    return Object.fromEntries(UNIVERSE.map((asset, i) => [asset, round(epoch.beginPrices[asset] * (1 + Math.sin(epoch.sequence * 1.41 + i * 2.1) * 0.024 + Math.cos(epoch.sequence * 0.63 + i) * 0.005))]));
  }
  demoRun() {
    return this.run('demo', state => {
      insist(!this.active(state), 'Finish the open epoch before running a complete demo cycle', 409);
      if (!state.providers.some(p => p.demoKey)) for (let i = 0; i < demoNames.length; i++) {
        const keys = generateKeyPairSync('ed25519'), privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
        const { provider } = this.registerInternal(state, { name: demoNames[i], kind: i % 3 === 0 ? 'QUANT' : i % 3 === 1 ? 'HUMAN' : 'AI', publicKey: signingPublicKey(privateKey) });
        state.providers.find(p => p.id === provider.id).demoKey = encryptEnvelope({ privateKey }, this.publicKey);
      }
      const created = this.createInternal(state, { durationSeconds: 60, evaluationSeconds: 3600 }), epoch = this.epoch(state, created.epoch.id);
      state.providers.filter(p => p.demoKey).forEach((provider, index) => {
        if (epoch.sequence % 4 === 0 && index === 2) return;
        const payload = { version: 1, providerId: provider.id, epochId: epoch.id, policyHash: epoch.policyHash, universe: UNIVERSE,
          vectorBps: UNIVERSE.map((_, i) => Math.round(Math.sin(index * 0.71 + i * 1.4 + epoch.sequence * 0.33) * 8000)), nonce: randomBytes(32).toString('hex') };
        const { privateKey } = decryptEnvelope(provider.demoKey, this.keys.encryptionPrivateKey);
        this.submitInternal(state, encryptEnvelope({ payload, signature: signObject(payload, privateKey) }, this.publicKey));
      });
      this.sealInternal(state, epoch, {});
      return this.evaluateInternal(state, epoch, {});
    });
  }
  flow(workspace, type, input) {
    return this.run(workspace, state => {
      insist(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId), 'A unique requestId is required for every paper capital transfer');
      const requestHash = hash({ type, amount: input.amount ?? null, shares: input.shares ?? null });
      const existing = state.book.flows.find(flow => flow.requestId === input.requestId);
      if (existing) { insist(existing.requestHash === requestHash, 'requestId was used for a different capital transfer', 409); return { flow: existing, book: this.bookView(state), duplicate: true }; }
      this.expireOpen(state);
      insist(!this.active(state), 'Paper deposits and withdrawals are locked during an active epoch', 409);
      const price = state.book.shares > 0 ? state.book.nav / state.book.shares : 1;
      insist(price > 0, 'Insolvent paper book cannot issue or redeem shares');
      const amount = type === 'DEPOSIT' ? input.amount : input.shares * price;
      const shares = type === 'DEPOSIT' ? amount / price : input.shares;
      insist(Number.isFinite(amount) && amount > 0 && amount <= 1e8 && Number.isFinite(shares) && shares > 0, 'Amount and shares must be positive and at most 100 million');
      insist(round(amount) >= 0.000001 && round(shares) >= 0.00000001, 'Transfer is below the paper accounting precision');
      insist(type === 'DEPOSIT' || shares <= state.book.shares, 'Cannot withdraw more shares than the review account owns');
      const oldNav = state.book.nav;
      const sign = type === 'DEPOSIT' ? 1 : -1;
      state.book.nav = round(state.book.nav + sign * amount);
      state.book.shares = round(state.book.shares + sign * shares);
      // This sandbox settles flows proportionally across synthetic exposure at the
      // latest mark; it is not a cash-only spot withdrawal or a liquidity promise.
      if (state.book.nav === 0) state.book.weightsBps = zeros();
      state.book.peakNav = oldNav ? round(state.book.peakNav * state.book.nav / oldNav) : state.book.nav;
      if (type === 'DEPOSIT') state.book.totalDeposited = round(state.book.totalDeposited + amount);
      else state.book.totalWithdrawn = round(state.book.totalWithdrawn + amount);
      state.book.flows.push({ type, amount: round(amount), shares: round(shares), sharePrice: price, at: new Date(this.now(state)).toISOString(), requestId: input.requestId, requestHash });
      state.book.history.push({ epochId: null, type, nav: state.book.nav, return: 0 });
      return { flow: state.book.flows.at(-1), book: this.bookView(state) };
    });
  }
  providerView(state, provider) {
    const requiredEpochs = state.epochs.filter(e => e.roster.some(p => p.id === provider.id) && this.now(state) >= Date.parse(e.cutoffAt));
    const required = requiredEpochs.length, submitted = requiredEpochs.filter(e => e.submissions[provider.id]).length;
    const history = provider.history, last = history.at(-1);
    const validMean = key => { const values = history.map(row => row[key]).filter(Number.isFinite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
    return { id: provider.id, name: provider.name, kind: provider.kind, registeredAt: provider.registeredAt, required, submitted, missed: required - submitted, completeness: required ? submitted / required : null,
      metrics: { shadowNav: last?.shadowNav ?? 100000, shadowReturn: last ? last.shadowNav / 100000 - 1 : null, maxDrawdown: Math.min(0, ...history.map(row => row.maxDrawdownBps ?? row.drawdownBps)) / 10000,
        hitRate: validMean('hitRate'), ic: validMean('predictionIC'), icEpochs: history.filter(row => Number.isFinite(row.predictionIC)).length,
        hitRateEpochs: history.filter(row => Number.isFinite(row.hitRate)).length,
        directionalSamples: history.length && history.every(row => Number.isFinite(row.directionalAssetCount)) ? history.reduce((n, row) => n + row.directionalAssetCount, 0) : null,
        contribution: last ? last.marginalContributionBps / 10000 : null,
        rewardCredits: history.reduce((n, row) => n + row.rewardCredits, 0), samples: history.length, turnoverBps: last?.turnoverBps ?? null, sharpe: null } };
  }
  epochView(epoch) {
    return { id: epoch.id, sequence: epoch.sequence, status: epoch.status, cutoffAt: epoch.cutoffAt, startAt: epoch.startAt, endAt: epoch.endAt, createdAt: epoch.createdAt,
      rosterCount: epoch.roster.length, submittedCount: Object.keys(epoch.submissions).length, missedCount: epoch.root ? epoch.roster.length - Object.keys(epoch.submissions).length : null,
      policyHash: epoch.policyHash, root: epoch.root, manifestHash: epoch.manifestHash, anchor: epoch.anchor,
      aggregate: epoch.aggregate ? { ...epoch.aggregate, rawBps: epoch.aggregate.status === 'SKIPPED' ? null : epoch.aggregate.rawBps, nettingRatio: epoch.aggregate.status === 'SKIPPED' ? null : epoch.aggregate.nettingRatio } : null,
      execution: epoch.execution ? { ...epoch.execution, turnover: epoch.execution.turnoverNotional } : null, evaluation: epoch.evaluation ?? null,
      mode: epoch.mode, beginPrices: epoch.beginPrices ?? null, endPrices: epoch.endPrices ?? null, failureReason: epoch.failureReason ?? null };
  }
  bookView(state) {
    return { nav: state.book.nav, cash: null, shares: state.book.shares, sharePrice: state.book.shares ? state.book.nav / state.book.shares : 1, totalDeposited: state.book.totalDeposited,
      totalWithdrawn: state.book.totalWithdrawn, targetBps: state.book.weightsBps, history: state.book.history, marks: state.book.marks, flows: state.book.flows,
      maxDrawdown: (state.book.maxDrawdownBps ?? 0) / 10000, valuation: 'LAST_FINALIZED_MARK', flowModel: 'PROPORTIONAL_SYNTHETIC_CAPITAL' };
  }
  state(workspace = 'demo') {
    return this.run(workspace, state => {
      this.expireOpen(state);
      return { workspace: state.workspace, trust: { compute: 'TRUSTED_SERVER', execution: 'PAPER', clock: state.workspace === 'demo' ? 'SIMULATED' : 'WALL', privacy: 'OPERATOR_CAN_DECRYPT', chain: 'LOCAL_ONLY' },
        policy: { ...POLICY, hash: policyHash, policyHash }, providers: state.providers.map(p => this.providerView(state, p)), epochs: state.epochs.map(e => this.epochView(e)).reverse(),
        book: this.bookView(state), activeEpochId: this.active(state)?.id ?? null, now: new Date(this.now(state)).toISOString(), serverPublicKey: this.serverPublicKey, serverSigningKey: this.serverSigningKey, localOnly: true };
    });
  }
  manifest(workspace, epochId) {
    const state = this.store.get(this.workspace(workspace)), epoch = this.epoch(state, epochId);
    insist(epoch.manifest, 'Epoch has not been sealed', 409);
    return { epochId: epoch.id, root: epoch.root, manifestHash: epoch.manifestHash, manifest: epoch.manifest, anchor: epoch.anchor };
  }
}
