// Shared public configuration and integer target semantics. BPS are NAV exposure.
export const DEFAULT_POLICY = Object.freeze({ maxLeverageBps: 20000, stopLossBps: 1500, maxDrawdownBps: 2000, settlementPeriodSeconds: 86400, settlementOffsetSeconds: 0, withdrawalCutoffSeconds: 3600, orderTtlSeconds: 120, slippageBps: 50 });
export function validatePolicy(value = {}) {
  const p = { ...DEFAULT_POLICY, ...value };
  const ranges = { maxLeverageBps: [10000, 100000], stopLossBps: [100, 10000], maxDrawdownBps: [100, 10000], settlementPeriodSeconds: [3600, 2592000], settlementOffsetSeconds: [0, 2591999], withdrawalCutoffSeconds: [0, 2591999], orderTtlSeconds: [15, 300], slippageBps: [1, 100] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isSafeInteger(p[key]) || p[key] < min || p[key] > max) throw Error(`INVALID_POLICY_${key}`);
  if (p.settlementOffsetSeconds >= p.settlementPeriodSeconds || p.withdrawalCutoffSeconds >= p.settlementPeriodSeconds) throw Error('INVALID_SETTLEMENT_SCHEDULE');
  return Object.fromEntries(Object.keys(ranges).map(k => [k, p[k]]));
}
export function validateTargets(targets, policy) {
  if (!Array.isArray(targets) || targets.length > 16) throw Error('INVALID_TARGET_VECTOR');
  const markets = new Set(); let gross = 0;
  for (const t of targets) {
    if (!Number.isSafeInteger(t.market) || t.market <= 0 || markets.has(t.market) || !Number.isSafeInteger(t.weightBps)) throw Error('INVALID_TARGET_VECTOR');
    markets.add(t.market); gross += Math.abs(t.weightBps);
  }
  if (gross > policy.maxLeverageBps) throw Error('LEVERAGE_LIMIT');
  return targets.map(({ market, weightBps }) => ({ market, weightBps }));
}
export function nextSettlement(policy, nowSeconds) {
  const { settlementPeriodSeconds: period, settlementOffsetSeconds: offset, withdrawalCutoffSeconds: cutoff } = policy;
  let at = (Math.floor((nowSeconds - offset) / period) + 1) * period + offset;
  if (nowSeconds >= at - cutoff) at += period;
  return at;
}
export function targetLots(equity, weightBps, mark, priceDecimals, lotDecimals, collateralDecimals = 6) {
  if (BigInt(equity) < 0n || BigInt(mark) <= 0n) throw Error('INVALID_VALUATION');
  return BigInt(equity) * BigInt(weightBps) * 10n ** BigInt(priceDecimals + lotDecimals) / (10000n * BigInt(mark) * 10n ** BigInt(collateralDecimals));
}
