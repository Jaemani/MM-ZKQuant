export function investmentMessage({ action, wallet, strategyId, amount, depositId, txHash, nonce }) {
  return `MM-ZKQuant private investment v1\n${JSON.stringify({ action, wallet, strategyId: strategyId || null, amount: amount || null, depositId: depositId || null, txHash: txHash || null, nonce })}`;
}
