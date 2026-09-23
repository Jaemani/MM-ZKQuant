import { encode } from './encoding.mts';

export const abs = (n: bigint) => n < 0n ? -n : n;
function nonnegative(n: bigint) { if (n < 0n) throw new Error('negative value'); }
export function ceilDiv(n: bigint, d: bigint) {
  nonnegative(n); if (d <= 0n) throw new Error('nonpositive divisor');
  return (n + d - 1n) / d;
}
export function delta(target: bigint, position: bigint, open: bigint = 0n) {
  [target, position, open].forEach(x => encode('qty',x));
  if (open !== 0n) throw new Error('IOC requires no open orders');
  const result = target - position;
  encode('qty',result); return result;
}
export function isReduction(position: bigint, signedQty: bigint) {
  [position,signedQty].forEach(x => encode('qty',x));
  const after = position + signedQty;
  encode('qty',after);
  return abs(after) <= abs(position) && (position === 0n ? after === 0n : after * position >= 0n);
}
export function custodyDraw(marginDelta: bigint, slotCredit: bigint, available: bigint) {
  [marginDelta,slotCredit,available].forEach(x=>encode('amount',x));
  nonnegative(slotCredit); nonnegative(available);
  const draw = marginDelta > slotCredit ? marginDelta - slotCredit : 0n;
  if (draw > available) throw new Error('insufficient capital');
  return draw;
}
export function minimumReduction(position: bigint, bps: bigint) {
  encode('qty',position); encode('bps',bps);
  if (bps > 10000n) throw new Error('fraction above 100%');
  return ceilDiv(abs(position) * bps,10000n);
}
export type MarkedPosition = { qty: bigint; price: bigint; quoteNumerator: bigint; quoteDenominator: bigint };
// Explicit lot * tick -> collateral-atom conversion. No implicit market decimals.
export function notional(p: MarkedPosition) {
  encode('qty',p.qty); encode('price',p.price);
  if (p.price <= 0n || p.quoteNumerator <= 0n || p.quoteDenominator <= 0n) throw new Error('invalid market scale/mark');
  return ceilDiv(abs(p.qty) * p.price * p.quoteNumerator,p.quoteDenominator);
}
export function withinLeverage(positions: MarkedPosition[], equity: bigint, haircut: bigint, leverage: bigint) {
  encode('amount',equity); encode('bps',haircut); encode('bps',leverage);
  if (haircut > 10000n) throw new Error('haircut above 100%');
  const gross = positions.reduce((s,p)=>s+notional(p),0n);
  const availableEquity = equity > 0n ? equity : 0n;
  return gross * 10000n * 10000n <= availableEquity * (10000n-haircut) * leverage;
}

// Candidate safety policy for the IOC gap, not the v0.1 TradeCircuit transition.
// Actual positions must come from authenticated Gate evidence, never a venue HTTP response.
export type SlotObservation = { projectedQty: bigint; observedQty: bigint | null; evidenceIndex: bigint | null; requiredIndex: bigint; fallbackRequired: bigint; beforeQty: bigint };
export function reconcileSlot(s: SlotObservation) {
  [s.projectedQty,s.beforeQty].forEach(x=>encode('qty',x));
  encode('u64',s.requiredIndex); nonnegative(s.fallbackRequired);
  if (s.observedQty === null || s.evidenceIndex === null) throw new Error('authenticated outcome required');
  encode('qty',s.observedQty); encode('u64',s.evidenceIndex);
  if (s.evidenceIndex < s.requiredIndex) throw new Error('stale outcome');
  const reduced = isReduction(s.beforeQty,s.observedQty-s.beforeQty);
  return { qty: s.observedQty, fallbackDone: reduced && abs(s.beforeQty)-abs(s.observedQty) >= s.fallbackRequired };
}
export function submissionRoute(policy: 'PRIVATE_ONLY'|'ALLOW_PUBLIC', privateAvailable: boolean, waitedMs: bigint, waitMs: bigint, now: bigint, expiresAt: bigint) {
  if (!['PRIVATE_ONLY','ALLOW_PUBLIC'].includes(policy)) throw new Error('unknown submission policy');
  [waitedMs,waitMs,now,expiresAt].forEach(x=>encode('u64',x));
  if (now >= expiresAt) return 'EXPIRED';
  if (privateAvailable) return 'PRIVATE';
  if (policy === 'ALLOW_PUBLIC' && waitedMs >= waitMs) return 'SUBMISSION_PUBLIC_FALLBACK';
  return 'WAIT_PRIVATE';
}
