import { createHash } from 'node:crypto';
import { canonicalJson } from '../shared/protocol.js';

export const ASSETS = ['BTC', 'ETH', 'MON', 'SOL'];
export const POLICY = Object.freeze({ version: 'admitted-actor-collateral-v2', universe: ASSETS,
  admission: 'OPERATOR_REVIEWED_ONE_ECONOMIC_ACTOR', maxActors: 8, minActors: 3,
  actorCapBps: 1000, assetCapBps: 2500, longOnly: false, shortMode: 'CASH_COLLATERALIZED_TEST_ASSET_BORROW_AND_SALE',
  aggregation: 'DEDUPLICATE_VECTORS_THEN_MEAN_WITHIN_ACTOR',
  contribution: 'EXACT_ACTOR_SHAPLEY_SIGNED_REFERENCE', reward: 'REALIZED_PROFIT_HIGH_WATER_MARK',
  performanceFeeBps: 1000, maxMarkAgeSeconds: 180, minHistory: 5,
  source: 'KRAKEN_CLOSED_1M_USD', venue: 'TEST_ASSET_CONSTANT_PRODUCT', tee: false });
export const digest = value => '0x' + createHash('sha256').update(canonicalJson(value)).digest('hex');
export const POLICY_HASH = digest(POLICY);
export const alphaCommitment = payload => ({ domain: 'MM_PILOT_ALPHA_COMMITMENT_V2',
  epochId: payload.epochId, actorId: payload.actorId, publicKey: payload.publicKey,
  policyHash: payload.policyHash, payloadHash: digest(payload) });

export function validateActors(actors) {
  if (!Array.isArray(actors) || actors.length > POLICY.maxActors) throw new Error('At most eight approved economic actors');
  for (const key of ['id', 'payoutAddress', 'admissionSubject']) {
    const values = actors.map(a => String(a[key] || '').toLowerCase());
    if (values.some(v => !v) || new Set(values).size !== values.length) throw new Error(`Actor ${key} must be unique`);
  }
  for (const a of actors) if (a.admissionStatus !== 'APPROVED' || !a.admissionEvidenceHash || !a.providerKeys?.length) throw new Error('Unapproved economic actor');
  const keys = actors.flatMap(a => a.providerKeys);
  if (new Set(keys).size !== keys.length) throw new Error('A provider key cannot belong to multiple actors');
  return actors;
}
export function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length !== 4 || vector.some(v => !Number.isInteger(v) || Math.abs(v) > 10000)) throw new Error('Four signed integer basis-point values required');
  return vector;
}
export function groupSignals(actors, submissions) {
  validateActors(actors);
  const known = new Map(actors.flatMap(a => a.providerKeys.map(key => [key, a.id])));
  const seenKeys = new Set();
  for (const s of submissions) {
    if (known.get(s.publicKey) !== s.actorId || seenKeys.has(s.publicKey)) throw new Error('Unapproved, misattributed or duplicate provider key');
    seenKeys.add(s.publicKey); validateVector(s.vectorBps);
  }
  return actors.map(actor => {
    const unique = [...new Map(submissions.filter(s => s.actorId === actor.id).map(s => [canonicalJson(s.vectorBps), s.vectorBps])).values()];
    return { id: actor.id, submitted: unique.length > 0,
      vectorBps: ASSETS.map((_, i) => unique.length ? Math.trunc(unique.reduce((n, v) => n + v[i], 0) / unique.length) : 0) };
  });
}
export function chooseActorWeights(actors, history = []) {
  validateActors(actors);
  const quality = actors.map(actor => {
    const obligations=history.filter(h=>h.actorId===actor.id).slice(-30);
    const rows = obligations.filter(h=>h.settled);
    const n = rows.length, reliability = n / (n + POLICY.minHistory);
    const mean = n ? rows.reduce((s, r) => s + Math.max(-500, Math.min(500, r.contributionBps)), 0) / n : 0;
    const completeness = obligations.length ? obligations.filter(r => r.submitted).length / obligations.length : 1;
    return { id: actor.id, score: Math.max(0.1, (1 + reliability * mean / 500) * completeness) };
  });
  const total = quality.reduce((n, a) => n + a.score, 0);
  return Object.fromEntries(quality.map(a => [a.id, Math.min(POLICY.actorCapBps, Math.floor(actors.length * POLICY.actorCapBps * a.score / total))]));
}
export function aggregateActors(groups, weights) {
  if (groups.filter(a => a.submitted).length < POLICY.minActors) throw new Error('Minimum three approved submitted actors not met');
  return target(groups, weights);
}
function target(groups, weights) {
  if (Object.values(weights).some(w => !Number.isInteger(w) || w < 0 || w > POLICY.actorCapBps)) throw new Error('Actor weight cap exceeded');
  return ASSETS.map((_, i) => Math.max(-POLICY.assetCapBps, Math.min(POLICY.assetCapBps,
    Math.trunc(groups.reduce((sum, a) => sum + (weights[a.id] || 0) * a.vectorBps[i] / 10000, 0)))));
}
/** All coalitions share frozen weights. Cohort admission is checked on the full set only.
 * This is reference-model attribution; realized onchain PnL remains a separate fact.
 */
export function attributeActors(groups, weights, returns, feeBps = 1) {
  if (returns.length !== 4 || returns.some(r => !Number.isFinite(r) || r < -1)) throw new Error('Invalid returns');
  aggregateActors(groups, weights);
  const n = groups.length, factorial = m => m < 2 ? 1 : m * factorial(m - 1);
  const values = Array.from({ length: 1 << n }, (_, mask) => {
    const t = target(groups.filter((_, i) => mask & (1 << i)), weights);
    return t.reduce((v, bps, i) => v + bps * returns[i] - Math.abs(bps) * 2 * feeBps / 10000, 0);
  });
  return groups.map((a, i) => {
    let contributionBps = 0;
    for (let mask = 0; mask < (1 << n); mask++) if (!(mask & (1 << i))) {
      const k = mask.toString(2).replaceAll('0', '').length;
      contributionBps += factorial(k) * factorial(n - k - 1) / factorial(n) * (values[mask | (1 << i)] - values[mask]);
    }
    return { actorId: a.id, submitted: a.submitted, contributionBps };
  });
}
export function allocateRewards(contributions, availableFeeUnits) {
  const pool = BigInt(availableFeeUnits);
  if (pool < 0n) throw new Error('Negative reward pool');
  const positives = contributions.map(r => BigInt(Math.max(0, Math.round(r.contributionBps * 1e8))));
  const total = positives.reduce((a, b) => a + b, 0n);
  return Object.fromEntries(contributions.map((r, i) => [r.actorId, String(total ? pool * positives[i] / total : 0n)]));
}

export function referenceQuality(groups, returns, history=[]) {
  return groups.map(a=>{
    const rows=history.filter(h=>h.actorId===a.id&&h.settled),previous=rows.at(-1)?.quality;
    const weights=a.vectorBps.map(v=>Math.max(-2500,Math.min(2500,v)));
    const netReturn=weights.reduce((n,w,i)=>n+w/10000*returns[i]-Math.abs(w)/10000*2/10000,0);
    const standaloneNav=Math.max(0,(previous?.standaloneNav??100000)*(1+netReturn));
    const peak=Math.max(previous?.peakNav??100000,standaloneNav);
    const samples=a.vectorBps.map((v,i)=>v!==0&&returns[i]!==0?Number(Math.sign(v)===Math.sign(returns[i])):null).filter(v=>v!==null);
    const xMean=a.vectorBps.reduce((n,v)=>n+v,0)/4,yMean=returns.reduce((n,v)=>n+v,0)/4;
    const xs=a.vectorBps.map(v=>v-xMean),ys=returns.map(v=>v-yMean);
    const denominator=Math.sqrt(xs.reduce((n,v)=>n+v*v,0)*ys.reduce((n,v)=>n+v*v,0));
    const ic=denominator?xs.reduce((n,v,i)=>n+v*ys[i],0)/denominator:null;
    return {actorId:a.id,model:'SIGNED_LINEAR_ROUND_TRIP_REFERENCE_1BP',standaloneNav,peakNav:peak,
      standaloneReturn:netReturn,drawdown:standaloneNav/peak-1,maxDrawdown:Math.min(previous?.maxDrawdown??0,standaloneNav/peak-1),
      predictionIC:ic,hitRate:samples.length?samples.reduce((n,v)=>n+v,0)/samples.length:null,
      directionalSamples:samples.length,epochs:rows.length+1,actualVenuePerformance:false,sharpe:null};
  });
}
