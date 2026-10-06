// Older enclave diagnostic responses include the historical execution error at
// the top level. Recognize only a completed diagnostic for the requested job;
// authentication and other request errors must still be rejected by callers.
export function normalizeExecutionResponse(message, result) {
  const diagnostic = message.action === 'DIAGNOSE' && result?.id === message.requestId &&
    ['FAILED', 'PARTIALLY_FILLED', 'EXPIRED'].includes(result.status) &&
    ((result.historicalReplay === true && Array.isArray(result.probes)) ||
      result.reason === 'NO_SAVED_CONTRACT_CALL');
  if (!diagnostic || !Object.hasOwn(result, 'error')) return result;
  const { error, ...response } = result;
  return { ...response, executionError: error };
}
