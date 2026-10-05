// Return actionable codes without leaking RPC requests, signed bytes or positions.
export function executionError(error) {
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
