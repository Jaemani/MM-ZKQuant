/**
 * Deterministic paper-only portfolio arithmetic. Signed vectors represent
 * synthetic linear exposure, not spot ownership, borrowing or margin trades.
 * Monetary values and drifted weights use 8 decimal places; targets and
 * provider weights use integer basis points rounded toward zero.
 */
export const ENGINE_VERSION = 'paper-linear-v1';
export const UNIVERSE = Object.freeze(['BTC', 'ETH', 'MON', 'SOL']);
export const DEFAULT_RISK = Object.freeze({
  providerCapBps: 1000,
  assetCapBps: 2500,
  grossCapBps: 10000,
  minProviders: 3,
  feeBps: 10,
  slippageBps: 5,
});

const BPS = 10000;
const round = (value) => Number(finite(value, 'computed value').toFixed(8));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const emptyVector = () => Object.fromEntries(UNIVERSE.map((asset) => [asset, 0]));
const vectorMap = (fn) => Object.fromEntries(UNIVERSE.map((asset) => [asset, fn(asset)]));
const mean = (values) => values.length ? sum(values) / values.length : 0;

function finite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be finite and in [${minimum}, ${maximum}]`);
  }
  return value;
}

function integer(value, label, minimum = 0, maximum = BPS) {
  finite(value, label, minimum, maximum);
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

export function validateVector(vectorBps) {
  if (!vectorBps || typeof vectorBps !== 'object' || Array.isArray(vectorBps)) {
    throw new TypeError('vectorBps must be an asset-to-integer-bps object');
  }
  if (Object.keys(vectorBps).length !== UNIVERSE.length ||
      Object.keys(vectorBps).some((asset) => !UNIVERSE.includes(asset))) {
    throw new TypeError(`vectorBps must contain exactly ${UNIVERSE.join(', ')}`);
  }
  for (const asset of UNIVERSE) integer(vectorBps[asset], `vectorBps.${asset}`, -BPS, BPS);
  return vectorMap((asset) => vectorBps[asset]);
}

function exposures(weights = {}) {
  return vectorMap((asset) => finite(weights[asset] ?? 0, `weightsBps.${asset}`));
}

function validatePrices(prices, label) {
  for (const asset of UNIVERSE) {
    finite(prices?.[asset], `${label}.${asset}`, Number.MIN_VALUE);
  }
}

function settings(risk = {}) {
  const result = { ...DEFAULT_RISK, ...risk };
  integer(result.providerCapBps, 'providerCapBps', 1);
  integer(result.assetCapBps, 'assetCapBps', 0);
  integer(result.grossCapBps, 'grossCapBps', 0);
  integer(result.minProviders, 'minProviders', 1, 10000);
  finite(result.feeBps, 'feeBps', 0, BPS);
  finite(result.slippageBps, 'slippageBps', 0, BPS);
  return result;
}

function providerIds(providers) {
  if (!Array.isArray(providers)) throw new TypeError('providers must be an array');
  const ids = providers.map((provider) => provider.id);
  if (ids.some((id) => typeof id !== 'string' || !id.length) || new Set(ids).size !== ids.length) {
    throw new TypeError('Provider IDs must be unique nonempty strings');
  }
  return ids;
}

/** Pass only history from epochs settled before the epoch being opened. */
export function chooseWeights(providers, { providerCapBps = DEFAULT_RISK.providerCapBps } = {}) {
  providerIds(providers);
  integer(providerCapBps, 'providerCapBps', 1);
  const scores = providers.map((provider) => {
    const history = (provider.history ?? []).slice(-30);
    const submitted = history.filter((row) => row.status !== 'MISSED');
    const numeric = (key) => submitted.map((row) => row[key]).filter(Number.isFinite);
    const net = Math.max(-1000, Math.min(1000, mean(numeric('netReturnBps'))));
    const marginal = Math.max(0, Math.min(1000, mean(numeric('marginalContributionBps'))));
    const drawdown = Math.min(BPS, Math.abs(Math.min(0, ...numeric('drawdownBps'))));
    const completeness = history.length ? submitted.length / history.length : 1;
    const quality = Math.max(0.05, (1 + net / 500 + marginal / 250) *
      completeness * (1 - drawdown / BPS));
    return { id: provider.id, quality };
  });
  const totalQuality = sum(scores.map((row) => row.quality));
  const budget = Math.min(BPS, providers.length * providerCapBps);
  const weightsBps = Object.fromEntries(scores.map(({ id, quality }) =>
    [id, Math.min(providerCapBps, Math.floor(budget * quality / totalQuality))]));
  return {
    weightsBps,
    unallocatedBps: BPS - sum(Object.values(weightsBps)),
    method: 'Prior 30 settled epochs: net return, positive LOO contribution, completeness and drawdown; cap overflow remains unallocated.',
  };
}

function riskTarget(rawBps, risk) {
  const riskAdjustments = [];
  let targetBps = vectorMap((asset) => {
    const clipped = Math.max(-risk.assetCapBps, Math.min(risk.assetCapBps, rawBps[asset]));
    if (clipped !== rawBps[asset]) riskAdjustments.push(`${asset}: asset cap`);
    return Math.trunc(clipped) || 0;
  });
  const gross = sum(Object.values(targetBps).map(Math.abs));
  if (gross > risk.grossCapBps) {
    targetBps = vectorMap((asset) => Math.trunc(targetBps[asset] * risk.grossCapBps / gross) || 0);
    riskAdjustments.push('Portfolio: gross exposure cap');
  }
  return { targetBps, riskAdjustments };
}

function weightedVector(providers, weightsBps) {
  return vectorMap((asset) => round(sum(providers.map((provider) =>
    (weightsBps[provider.id] ?? 0) * (provider.vectorBps?.[asset] ?? 0) / BPS))));
}

export function aggregate({ providers, weightsBps, previousWeightsBps = {}, risk = {} }) {
  const ids = providerIds(providers);
  const policy = settings(risk);
  for (const [id, weight] of Object.entries(weightsBps ?? {})) {
    if (!ids.includes(id)) throw new TypeError(`Weight has no provider: ${id}`);
    integer(weight, `weightsBps.${id}`, 0, policy.providerCapBps);
  }
  if (sum(Object.values(weightsBps ?? {})) > BPS) throw new RangeError('Provider weights exceed 10000 bps');
  const frozenWeights = weightsBps ?? {};
  const submitted = providers.filter((provider) => provider.vectorBps != null);
  for (const provider of submitted) validateVector(provider.vectorBps);
  const rawBps = weightedVector(providers, frozenWeights);
  const weightedGross = sum(submitted.map((provider) =>
    (frozenWeights[provider.id] ?? 0) * sum(Object.values(provider.vectorBps).map(Math.abs)) / BPS));
  const netGross = sum(Object.values(rawBps).map(Math.abs));
  const skipped = submitted.length < policy.minProviders;
  const normalized = skipped
    ? { targetBps: exposures(previousWeightsBps), riskAdjustments: [] }
    : riskTarget(rawBps, policy);
  return {
    status: skipped ? 'SKIPPED' : 'READY',
    reason: skipped ? (submitted.length === 0 ? 'ALL_MISSING' : 'MIN_COHORT') : null,
    rawBps,
    ...normalized,
    grossBps: round(sum(Object.values(normalized.targetBps).map(Math.abs))),
    nettingRatio: weightedGross ? round(1 - netGross / weightedGross) : 0,
    submittedCount: submitted.length,
    missingCount: providers.length - submitted.length,
    unallocatedBps: BPS - sum(submitted.map((provider) => frozenWeights[provider.id] ?? 0)),
  };
}

/** All orders are simulated USDC notional changes in synthetic exposure. */
export function planExecution({ targetBps, currentWeightsBps = {}, nav, prices,
  feeBps = 10, slippageBps = 5, maxOrderNotional = 2500 }) {
  finite(nav, 'nav', 0);
  finite(feeBps, 'feeBps', 0, BPS);
  finite(slippageBps, 'slippageBps', 0, BPS);
  finite(maxOrderNotional, 'maxOrderNotional', 0.00000001);
  validatePrices(prices, 'prices');
  const target = exposures(targetBps);
  const current = exposures(currentWeightsBps);
  const orders = [];
  for (const asset of UNIVERSE) {
    const delta = round(nav * (target[asset] - current[asset]) / BPS);
    const sign = Math.sign(delta);
    let remaining = Math.abs(delta);
    const sliceCount = Math.ceil(remaining / maxOrderNotional);
    if (sliceCount > 100000) throw new RangeError('Execution plan exceeds 100000 slices per asset');
    for (let sliceIndex = 0; remaining > 0 && sliceIndex < sliceCount; sliceIndex += 1) {
      const notional = round(Math.min(remaining, maxOrderNotional));
      const fee = round(notional * feeBps / BPS);
      const slippage = round(notional * slippageBps / BPS);
      orders.push({
        asset, side: sign > 0 ? 'BUY' : 'SELL', sliceIndex,
        notional, signedNotional: sign * notional,
        quantity: round(notional / prices[asset]),
        referencePrice: prices[asset],
        fillPrice: round(prices[asset] * (1 + sign * slippageBps / BPS)),
        fee, slippage, cost: round(fee + slippage),
      });
      remaining = round(remaining - notional);
    }
  }
  const fee = round(sum(orders.map((order) => order.fee)));
  const slippage = round(sum(orders.map((order) => order.slippage)));
  return {
    orders,
    turnoverNotional: round(sum(orders.map((order) => order.notional))),
    fee, slippage, cost: round(fee + slippage),
  };
}

function simulateBook(previous, targetBps, beginPrices, returns, policy) {
  const nav = finite(previous.nav, 'previousBook.nav', 0);
  const peak = finite(previous.peakNav ?? nav, 'previousBook.peakNav', nav);
  const execution = planExecution({ targetBps, currentWeightsBps: previous.weightsBps,
    nav, prices: beginPrices, feeBps: policy.feeBps, slippageBps: policy.slippageBps });
  const grossReturn = sum(UNIVERSE.map((asset) => targetBps[asset] / BPS * returns[asset]));
  const uncappedNav = round(nav * (1 + grossReturn) - execution.cost);
  const nextNav = Math.max(0, uncappedNav);
  const peakNav = Math.max(peak, nextNav);
  const drawdownBps = peakNav ? round((nextNav / peakNav - 1) * BPS) : 0;
  const maxDrawdownBps = Math.min(previous.maxDrawdownBps ?? previous.drawdownBps ?? 0, drawdownBps);
  const drifted = nextNav === 0 ? emptyVector() : vectorMap((asset) =>
    round(nav * targetBps[asset] * (1 + returns[asset]) / nextNav));
  return {
    execution,
    book: {
      nav: nextNav, peakNav, weightsBps: drifted,
      grossReturnBps: round(grossReturn * BPS),
      netReturnBps: nav ? round((nextNav / nav - 1) * BPS) : 0,
      pnl: round(nextNav - nav),
      drawdownBps, maxDrawdownBps,
      turnoverBps: nav ? round(execution.turnoverNotional / nav * BPS) : 0,
      cost: execution.cost,
      bankrupt: nextNav === 0,
      lossBeyondCapital: Math.max(0, round(-uncappedNav)),
    },
  };
}

function predictionMetrics(vector, returns) {
  if (vector == null) return { predictionIC: null, hitRate: null, predictionAssetCount: 0, directionalAssetCount: 0 };
  const signals = UNIVERSE.map((asset) => vector[asset]);
  const changes = UNIVERSE.map((asset) => returns[asset]);
  const signalMean = mean(signals);
  const changeMean = mean(changes);
  const numerator = sum(signals.map((signal, index) => (signal - signalMean) * (changes[index] - changeMean)));
  const denominator = Math.sqrt(sum(signals.map((signal) => (signal - signalMean) ** 2)) *
    sum(changes.map((change) => (change - changeMean) ** 2)));
  const directional = UNIVERSE.filter((asset) => vector[asset] !== 0 && returns[asset] !== 0);
  return {
    predictionAssetCount: UNIVERSE.length,
    directionalAssetCount: directional.length,
    predictionIC: denominator ? round(Math.max(-1, Math.min(1, numerator / denominator))) : null,
    hitRate: directional.length ? round(directional.filter((asset) =>
      Math.sign(vector[asset]) === Math.sign(returns[asset])).length / directional.length) : null,
  };
}

/** Mark a carried book between epochs without trading or charging costs. */
export function markBook(previousBook, beginPrices, endPrices) {
  validatePrices(beginPrices, 'beginPrices');
  validatePrices(endPrices, 'endPrices');
  const returns = vectorMap((asset) => finite(endPrices[asset] / beginPrices[asset] - 1, `return.${asset}`));
  return simulateBook(previousBook, exposures(previousBook.weightsBps), beginPrices, returns,
    settings({ feeBps: 0, slippageBps: 0 })).book;
}

export function evaluateOutcome({ providers, weightsBps = {}, beginPrices, endPrices,
  previousBook = { nav: 100000, weightsBps: {} }, previousShadows = {}, risk = {}, rewardPoolUnits = 10000 }) {
  integer(rewardPoolUnits, 'rewardPoolUnits', 0, Number.MAX_SAFE_INTEGER);
  validatePrices(beginPrices, 'beginPrices');
  validatePrices(endPrices, 'endPrices');
  const policy = settings(risk);
  const returns = vectorMap((asset) => finite(endPrices[asset] / beginPrices[asset] - 1, `return.${asset}`));
  const aggregation = aggregate({ providers, weightsBps, previousWeightsBps: previousBook.weightsBps, risk: policy });
  const real = simulateBook(previousBook, aggregation.targetBps, beginPrices, returns, policy);
  const providerResults = providers.map((provider) => {
    const missing = provider.vectorBps == null;
    const targetBps = riskTarget(provider.vectorBps ?? emptyVector(), policy).targetBps;
    const shadow = simulateBook(previousShadows[provider.id] ?? { nav: 100000, weightsBps: {} },
      targetBps, beginPrices, returns, policy);
    let marginalContributionBps = 0;
    if (!missing && aggregation.status === 'READY') {
      // Counterfactual changes only this signal. It keeps the previous real book,
      // frozen weights, fee model and risk caps. Cohort gating is not reapplied.
      const without = providers.map((row) => row.id === provider.id ? { ...row, vectorBps: null } : row);
      const counterfactualTarget = riskTarget(weightedVector(without, weightsBps), policy).targetBps;
      const counterfactual = simulateBook(previousBook, counterfactualTarget, beginPrices, returns, policy);
      marginalContributionBps = round(real.book.netReturnBps - counterfactual.book.netReturnBps);
    }
    return {
      providerId: provider.id,
      status: missing ? 'MISSED' : 'SUBMITTED',
      targetBps,
      ...predictionMetrics(provider.vectorBps, returns),
      grossReturnBps: shadow.book.grossReturnBps,
      netReturnBps: shadow.book.netReturnBps,
      drawdownBps: shadow.book.drawdownBps,
      maxDrawdownBps: shadow.book.maxDrawdownBps,
      turnoverBps: shadow.book.turnoverBps,
      cost: shadow.execution.cost,
      marginalContributionBps,
      shadowBook: shadow.book,
    };
  });
  const positiveTotal = sum(providerResults.map((row) => Math.max(0, row.marginalContributionBps)));
  const credits = Object.fromEntries(providerResults.map((row) => [row.providerId, positiveTotal
    ? Math.floor(rewardPoolUnits * (Math.max(0, row.marginalContributionBps) / positiveTotal)) : 0]));
  const allocatedUnits = sum(Object.values(credits));
  return {
    model: ENGINE_VERSION,
    aggregate: aggregation,
    execution: real.execution,
    returnsBps: vectorMap((asset) => round(returns[asset] * BPS)),
    book: real.book,
    providerResults,
    rewardPreview: { poolUnits: rewardPoolUnits, allocatedUnits,
      unallocatedUnits: rewardPoolUnits - allocatedUnits, credits },
  };
}
