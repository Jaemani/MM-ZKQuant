// Return actionable codes without leaking RPC requests, signed bytes or positions.
// Perpl TakerOrderSettlementFailed has eight uint256 arguments. Only its final
// failure enum is exported; account, prices and quantities remain in the TEE.
export function perplFailure(error) {
  const data=[error?.data,error?.info?.error?.data,error?.error?.data].find(value=>typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value));
  if(!data||data.slice(0,10).toLowerCase()!=='0xb29d1949'||data.length!==522)return null;
  const value=BigInt('0x'+data.slice(10+7*64)),resultCode=value<=9n?Number(value):null;
  const codes={1:'VENUE_BALANCE_INSUFFICIENT',2:'VENUE_COLLATERAL_INSUFFICIENT',3:'VENUE_COLLATERAL_INSUFFICIENT',4:'VENUE_POSITION_MISSING',5:'VENUE_SOLVENCY_REJECTED',6:'VENUE_POSITION_VALUE_NEGATIVE',7:'STALE_VENUE_PRICE',8:'VENUE_NEGATIVE_PNL_LIMIT'};
  return {selector:'0xb29d1949',reason:'TakerOrderSettlementFailed',resultCode,code:codes[resultCode]||'VENUE_SETTLEMENT_REJECTED'};
}
export function executionError(error) {
  const venue=perplFailure(error);if(venue)return venue.code;
  const codes = new Set([
    "ORDER_EXPIRED",
    "PARTIAL_FILL_RETRY",
    "MINED_REVERT",
    "PENDING_RECONCILE_REQUIRED",
    "ROLLBACK_OR_UNKNOWN_TRANSACTION",
    "JOURNAL_ROLLBACK_OR_FOREIGN_TX",
    "UNKNOWN_PENDING_TRANSACTION",
    "TEE_GAS_BUDGET",
    "OPERATOR_GAS_INSUFFICIENT",
    "INSUFFICIENT_STRATEGY_CASH_MIN_ACCOUNT_100_AUSD",
    "INSUFFICIENT_SHARED_ACCOUNT_CASH",
    "SHARED_ACCOUNT_RECONCILIATION_REQUIRED",
    "SHARED_ACCOUNT_POSITION_MISMATCH",
    "SHARED_ACCOUNT_DIRECTION_CONFLICT",
    "SHARED_ACCOUNT_CAPITAL_EXHAUSTED",
    "SHARED_ACCOUNT_CREATION_UNCONFIRMED",
    "SHARED_ACCOUNT_UNAVAILABLE",
    "WITHDRAWAL_LIQUIDITY_PENDING",
    "STALE_VENUE_PRICE",
    "LEVERAGE_LIMIT",
  ]);
  if (codes.has(error?.message)) return error.message;
  const text = [
    error?.code,
    error?.shortMessage,
    error?.message,
    error?.info?.error?.message,
    error?.error?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    text.includes("insufficient funds") ||
    text.includes("insufficient balance") ||
    text.includes("gas required exceeds allowance")
  )
    return "OPERATOR_GAS_INSUFFICIENT";
  if (text.includes("timeout") || text.includes("timed out"))
    return "RPC_CONFIRMATION_DELAYED";
  if (text.includes("could not coalesce") || text.includes("unknown_error"))
    return "RPC_RESPONSE_UNCONFIRMED";
  return "EXECUTION_CONFIRMATION_REQUIRED";
}
