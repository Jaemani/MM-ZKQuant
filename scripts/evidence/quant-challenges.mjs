/**
 * Independent, hand-calculated challenges to the paper quant policy.
 * These fixtures use synthetic prices, NO TEE, no chain, no real fills and
 * approximate linear exposure/cost accounting. Passing confirms a formula or
 * reproduces a counterexample; it does not validate live alpha or fair payouts.
 * Run: rtk node scripts/evidence/quant-challenges.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluateOutcome, chooseWeights } from '../../src/core/engine.js';
import { AlphaService } from '../../src/server/service.js';
import { makeKeys } from '../../src/server/crypto.js';

const vector = (BTC = 0, ETH = 0, MON = 0, SOL = 0) => ({ BTC, ETH, MON, SOL });
const beginPrices = { BTC: 100, ETH: 100, MON: 100, SOL: 100 };
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7,
  `${label}: expected ${expected}, observed ${actual}`);
const project = outcome => ({
  targetBps: outcome.aggregate.targetBps,
  nav: outcome.book.nav,
  fundReturnBps: outcome.book.netReturnBps,
  pnl: outcome.book.pnl,
  turnover: outcome.execution.turnoverNotional,
  fee: outcome.execution.fee,
  slippage: outcome.execution.slippage,
  providers: outcome.providerResults.map(row => ({
    id: row.providerId, standaloneNetReturnBps: row.netReturnBps,
    contributionBps: row.marginalContributionBps,
    credits: outcome.rewardPreview.credits[row.providerId],
  })),
  unallocatedCredits: outcome.rewardPreview.unallocatedUnits,
});

export function runQuantChallenges() {
// Fixture 1: the expected numbers below were calculated from dollar holdings,
// not by calling aggregate/planExecution for a second implementation oracle.
const firstProviders = [
  { id: 'long-btc', vectorBps: vector(10000) },
  { id: 'short-btc', vectorBps: vector(-10000) },
  { id: 'long-eth', vectorBps: vector(0, 10000) },
  { id: 'missing', vectorBps: null },
];
const frozenWeights = Object.fromEntries(firstProviders.map(p => [p.id, 1000]));
const frozenBefore = structuredClone(frozenWeights);
const first = evaluateOutcome({ providers: firstProviders, weightsBps: frozenWeights,
  beginPrices, endPrices: { BTC: 120, ETH: 110, MON: 100, SOL: 100 } });
assert.deepEqual(first.aggregate.targetBps, vector(0, 1000));
assert.deepEqual(frozenWeights, frozenBefore);
assert.equal(first.aggregate.submittedCount, 3);
assert.equal(first.aggregate.unallocatedBps, 7000);
near(first.aggregate.nettingRatio, 2 / 3, 'BTC cancels before trading');
near(first.book.nav, 100985, '100000 + 10000 * 10% - 10 fee - 5 slippage');
near(first.execution.fee, 10, 'fee charged once');
near(first.execution.slippage, 5, 'slippage charged once');
const firstExpected = {
  'long-btc': [496.25, 201.5, 6716],
  'short-btc': [-503.75, -198.5, 0],
  'long-eth': [246.25, 98.5, 3283],
  missing: [0, 0, 0],
};
for (const row of first.providerResults) {
  const [standalone, marginal, credits] = firstExpected[row.providerId];
  near(row.netReturnBps, standalone, `${row.providerId} independent 25% capped book`);
  near(row.marginalContributionBps, marginal, `${row.providerId} frozen 10% LOO`);
  assert.equal(first.rewardPreview.credits[row.providerId], credits);
}

// A minimal isolated store exercises the actual service cash-flow method. The
// settled book is seeded explicitly; this is not an HTTP or durable-store test.
const workspaces = new Map();
const store = {
  keys: makeKeys(),
  get: workspace => workspaces.has(workspace) ? structuredClone(workspaces.get(workspace)) : null,
  put: (workspace, state) => workspaces.set(workspace, structuredClone(state)),
  transaction(workspace, fn) {
    const state = this.get(workspace);
    const result = fn(state);
    this.put(workspace, state);
    return result;
  },
};
const service = new AlphaService(store, { clock: () => Date.parse('2026-09-18T00:00:00Z') });
const seededState = store.get('forward');
Object.assign(seededState.book, first.book);
seededState.book.history.push({ type: 'EPOCH', nav: 100985, return: 0.00985 });
store.put('forward', seededState);
const deposit = service.flow('forward', 'DEPOSIT', { amount: 10098.5, requestId: 'quant-deposit-001' });
near(deposit.book.nav, 111083.5, 'deposit adds capital');
near(deposit.book.shares, 110000, 'deposit mints at 1.00985');
near(deposit.book.sharePrice, 1.00985, 'deposit is not return');
const withdrawal = service.flow('forward', 'WITHDRAW', { shares: 10000, requestId: 'quant-withdraw-001' });
near(withdrawal.flow.amount, 10098.5, 'withdrawal redeems at same price');
near(withdrawal.book.nav, 100985, 'round trip preserves settled NAV');
near(withdrawal.book.shares, 100000, 'round trip preserves shares');
near(withdrawal.book.nav - withdrawal.book.totalDeposited + withdrawal.book.totalWithdrawn,
  985, 'PnL excludes deposits and withdrawals');

// Fixture 2: ten empty-history identities all receive the same frozen 10%
// weight. The actor replaces neutral identities with exact copies of the same
// BTC signal. The other honest signal is deliberately identical too.
function cloneFixture(actorCopies) {
  const providers = Array.from({ length: 10 }, (_, i) => ({
    id: i === 0 ? 'honest' : i <= actorCopies ? `actor-${i}` : `neutral-${i}`,
    vectorBps: i <= actorCopies ? vector(10000) : vector(),
  }));
  const weights = chooseWeights(providers);
  assert.ok(Object.values(weights.weightsBps).every(w => w === 1000));
  const outcome = evaluateOutcome({ providers, weightsBps: weights.weightsBps, beginPrices,
    endPrices: { BTC: 110, ETH: 100, MON: 100, SOL: 100 } });
  return { actorCopies, ...project(outcome), actorCredits: providers
    .filter(p => p.id.startsWith('actor-'))
    .reduce((sum, p) => sum + outcome.rewardPreview.credits[p.id], 0) };
}
const clones = [1, 2, 3].map(cloneFixture);
const cloneExpected = [
  { nav: 101970, target: 2000, eachContribution: 98.5, actorCredits: 5000, unallocated: 0 },
  { nav: 102462.5, target: 2500, eachContribution: 49.25, actorCredits: 6666, unallocated: 1 },
  { nav: 102462.5, target: 2500, eachContribution: 0, actorCredits: 0, unallocated: 10000 },
];
for (const [i, result] of clones.entries()) {
  const expected = cloneExpected[i];
  near(result.nav, expected.nav, 'clone example NAV');
  assert.equal(result.targetBps.BTC, expected.target);
  assert.equal(result.actorCredits, expected.actorCredits);
  assert.equal(result.unallocatedCredits, expected.unallocated);
  for (const provider of result.providers.filter(p => !p.id.startsWith('neutral-'))) {
    near(provider.contributionBps, expected.eachContribution, 'identical signal LOO');
  }
}

// Fixture 3: one actor submits +BTC and -BTC through two identities. Their joint
// signal is exactly zero. Removing the coalition leaves the same ETH holding,
// so independent coalition contribution is exactly $0. Positive-only rewards
// nevertheless award the entire pool to the winning identity.
const colluders = [
  { id: 'actor-long', vectorBps: vector(10000) },
  { id: 'actor-short', vectorBps: vector(-10000) },
  { id: 'honest-eth', vectorBps: vector(0, 10000) },
  { id: 'neutral-1', vectorBps: vector() },
  { id: 'neutral-2', vectorBps: vector() },
];
const collusion = evaluateOutcome({ providers: colluders,
  weightsBps: Object.fromEntries(colluders.map(p => [p.id, 1000])), beginPrices,
  endPrices: { BTC: 110, ETH: 90, MON: 100, SOL: 100 } });
assert.deepEqual(collusion.aggregate.targetBps, vector(0, 1000));
near(collusion.book.pnl, -1015, 'ETH loses 1000 plus 15 costs');
near(collusion.providerResults[0].marginalContributionBps, 101.5, 'long identity benefit');
near(collusion.providerResults[1].marginalContributionBps, -98.5, 'short identity harm');
near(collusion.providerResults[2].marginalContributionBps, -101.5, 'honest ETH harm');
assert.deepEqual(collusion.rewardPreview.credits,
  { 'actor-long': 10000, 'actor-short': 0, 'honest-eth': 0, 'neutral-1': 0, 'neutral-2': 0 });
const noCoalitionNav = 100000 - 10000 * 0.1 - 10000 * 0.0015;
near(collusion.book.nav - noCoalitionNav, 0, 'coalition joint incremental dollar profit');
const survivors = colluders.filter(p => !p.id.startsWith('actor-'));
const withoutCoalition = evaluateOutcome({ providers: survivors,
  weightsBps: Object.fromEntries(survivors.map(p => [p.id, 1000])), beginPrices,
  endPrices: { BTC: 110, ETH: 90, MON: 100, SOL: 100 } });
assert.equal(withoutCoalition.aggregate.status, 'READY');
near(withoutCoalition.book.nav, noCoalitionNav, 'three survivors still satisfy the real cohort gate');

// Fixture 4: a perfect reported IC/hit-rate can describe one directional bet.
// The score uses a mean and no maturity term, so one such observation has the
// same effect as thirty copies. No independence/skill conclusion is licensed.
const singleBet = evaluateOutcome({
  providers: [{ id: 'lucky', vectorBps: vector(10000) },
    { id: 'neutral-1', vectorBps: vector() }, { id: 'neutral-2', vectorBps: vector() }],
  weightsBps: { lucky: 1000, 'neutral-1': 1000, 'neutral-2': 1000 }, beginPrices,
  endPrices: { BTC: 110, ETH: 100, MON: 100, SOL: 100 },
});
const lucky = singleBet.providerResults[0];
near(lucky.predictionIC, 1, 'one nonzero return cross section yields perfect IC');
near(lucky.hitRate, 1, 'one bet won');
assert.equal(lucky.directionalAssetCount, 1);
const historyRow = { status: 'SUBMITTED', netReturnBps: 246.25,
  marginalContributionBps: 98.5, drawdownBps: 0 };
const scoreRoster = count => [{ id: 'lucky', history: Array.from({ length: count }, () => ({ ...historyRow })) },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `fresh-${i}`, history: [] }))];
const oneObservation = chooseWeights(scoreRoster(1));
const thirtyObservations = chooseWeights(scoreRoster(30));
assert.deepEqual(oneObservation, thirtyObservations);
assert.equal(oneObservation.weightsBps.lucky, 1000);
assert.equal(oneObservation.weightsBps['fresh-0'], 918);
assert.equal(oneObservation.unallocatedBps, 738);

const report = {
  schema: 'MM_QUANT_CHALLENGES_V1',
  runAt: new Date().toISOString(),
  runtime: process.version,
  scope: { noTEE: true, syntheticPrices: true, approximatePaperLinearModel: true,
    actualTrades: false, actualRewards: false, chainEvidence: false,
    independentOracle: 'Explicit hand-calculated constants/dollar formulas; production engine is only the observed implementation.',
    serviceCoverage: 'flow() with an isolated in-memory store and explicitly seeded settled book; no HTTP, persistence or clock claim.' },
  arithmeticChecks: 'PASS',
  productCounterexamplesReproduced: 3,
  cases: [
    {
      id: 'accounting-separation-missing-and-flows',
      classification: 'ARITHMETIC_SUPPORT_WITHIN_DECLARED_PAPER_MODEL',
      expectedFormula: 'Fund: $100000 + $10000 ETH * 10% - $10 fee - $5 slippage = $100985. BTC +$10000 and -$10000 net to zero. Standalone BTC uses $25000 capped exposure, not the provider weight. Missing 10% weight remains unallocated; the three submitted signals are not reweighted.',
      expectedProviderResults: firstExpected,
      observed: { ...project(first), unallocatedWeightBps: first.aggregate.unallocatedBps,
        weightsUnchanged: true, deposit: { nav: deposit.book.nav, shares: deposit.book.shares,
          sharePrice: deposit.book.sharePrice }, withdrawal: { nav: withdrawal.book.nav,
          shares: withdrawal.book.shares, sharePrice: withdrawal.book.sharePrice,
          netTradingProfitAfterFlows: 985 } },
      conclusion: 'Standalone/LOO separation and cost/flow arithmetic are concretely reviewable. This does not demonstrate real execution, custody, liquidity or self-financing on-chain shares.',
    },
    {
      id: 'identical-clones-and-risk-cap',
      classification: 'PRODUCT_DESIGN_COUNTEREXAMPLE_NOT_FORMULA_BUG',
      expectedFormula: '10% exposure * (10% return - 0.15% entry cost) = 98.5 return bps per uncapped signal. At three identical signals, the 25% cap makes each removal worth 5% exposure = 49.25 bps. At four, removing any one still leaves 30% before the same cap, so every LOO contribution is zero.',
      observed: clones,
      conclusion: 'One actor increases credits from 5000 to 6666 by adding an exact copy. With one more identical identity the fund still earns $2462.50, yet all 10000 credits stay unallocated. LOO is not a novelty score or additive profit attribution; per-key caps are not per-economic-actor caps.',
    },
    {
      id: 'opposite-signal-coalition-positive-only-reward',
      classification: 'PRODUCT_DESIGN_COUNTEREXAMPLE_NOT_FORMULA_BUG',
      expectedFormula: 'Fund retains only +$10000 ETH: -$1000 price PnL - $15 costs = -$1015. Removing both actor identities leaves the exact same portfolio and zero joint contribution; honest ETH and two neutral providers still satisfy minProviders=3. Individual LOO = +101.5, -98.5 and -101.5 bps; positive-only normalization pays 10000 credits to actor-long.',
      observed: { ...project(collusion), coalitionJointContributionDollars: 0,
        coalitionCombinedCredits: 10000, withoutCoalition: { nav: withoutCoalition.book.nav,
          cohortStatus: withoutCoalition.aggregate.status, submitted: withoutCoalition.aggregate.submittedCount } },
      conclusion: 'A zero-net-signal coalition receives the whole pool while the fund loses money. With no identity aggregation, stake or downside debit, current credits cannot substantiate Sybil-resistant or economically fair provider payouts.',
    },
    {
      id: 'one-bet-perfect-metrics-and-no-maturity-weight',
      classification: 'STATISTICAL_VALIDATION_GAP_NOT_FORMULA_BUG',
      expectedFormula: 'Vectors [10000,0,0,0] and returns [10%,0,0,0] are positively collinear: IC=1. Only BTC has a nonzero signal and return: hit rate=1 from one direction pair. Quality=1+246.25/500+98.5/250=1.8865. Each fresh peer gets floor(10000/(9+1.8865))=918; lucky is capped at 1000; 738 bps remain unallocated.',
      observed: { predictionIC: lucky.predictionIC, hitRate: lucky.hitRate,
        directionalAssetCount: lucky.directionalAssetCount,
        oneObservation, thirtyObservations, identicalWeights: true,
        oneFairCoinWinningProbability: 0.5 },
      conclusion: 'The current UI exposes sample counts and leaves Sharpe null; it does not falsely claim significance. A one-bet perfect metric and one-epoch weight update nevertheless provide no statistical evidence of durable trading skill or optimal allocation. Thirty repeated rows are a mathematical sensitivity probe, not independent observations.',
    },
  ],
};
return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runQuantChallenges();
  const outputPath = fileURLToPath(new URL('../../docs/evidence/quant-challenges.json', import.meta.url));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
