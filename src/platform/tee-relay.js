// Transport only: the browser encrypts for the pinned TEE key and decrypts its
// response. No private plaintext, authentication token or ledger is available here.
const paths = new Set(['/encrypted-strategy', '/encrypted-investments']);
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/i.test(value);

export async function relayTeePacket(endpoint, path, packet, { fetchImpl = fetch, timeoutMs = 25000 } = {}) {
  if (!paths.has(path)) return { status: 404, body: { error: 'NOT_FOUND' } };
  if (!endpoint) return { status: 503, body: { error: 'TEE_UNAVAILABLE' } };
  const box = packet?.box;
  if (Object.keys(packet || {}).some(key => !['ephemeral', 'box'].includes(key)) ||
      !hex(packet?.ephemeral, 66) || box?.version !== 1 || !hex(box?.iv, 24) || !hex(box?.tag, 32) ||
      typeof box?.data !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(box.data) ||
      Object.keys(box).some(key => !['version', 'iv', 'tag', 'data'].includes(key))) {
    return { status: 400, body: { error: 'INVALID_ENCRYPTED_REQUEST' } };
  }
  try {
    // Never retry a POST: the enclave may have accepted it before a disconnect.
    const upstream = await fetchImpl(`${endpoint.replace(/\/$/, '')}/platform${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packet), signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    const body = await upstream.json();
    if (!body.reply && !body.error) throw Error('INVALID_REPLY');
    return { status: upstream.status, body: body.reply ? { reply: body.reply } : { error: body.error } };
  } catch (error) {
    return { status: 503, body: { error: error.name === 'TimeoutError' ? 'TEE_RESPONSE_TIMEOUT' : 'TEE_CONNECTION_FAILED' } };
  }
}
