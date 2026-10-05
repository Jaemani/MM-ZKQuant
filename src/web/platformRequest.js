export async function fetchPlatformJson(url, options = {}, { fetchImpl = fetch, timeoutMs = 12000, retryDelayMs = 200 } = {}) {
  const method = options.method || 'GET';
  const attempts = method === 'GET' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        const error = Error(body?.error || 'PLATFORM_RESPONSE_INVALID');
        error.status = response.status;
        error.retryable = response.status >= 500 || !body;
        throw error;
      }
      return body;
    } catch (cause) {
      const error = cause.status ? cause : Error(cause.name === 'TimeoutError' ? 'PLATFORM_RESPONSE_TIMEOUT' : 'PLATFORM_CONNECTION_FAILED');
      if (options.signal?.aborted || attempt + 1 >= attempts || (cause.status && !cause.retryable)) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}
