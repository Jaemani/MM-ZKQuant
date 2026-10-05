import { PlatformError } from './service.js';

const reply = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new PlatformError('JSON_CONTENT_TYPE_REQUIRED', 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 65_536) throw new PlatformError('REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { throw new PlatformError('INVALID_JSON'); }
}

export async function handlePlatformRequest(request, response, service, { origin = 'https://mm-zkquant.vercel.app', prefix = '' } = {}) {
  const requestOrigin = request.headers.origin;
  if (requestOrigin === origin || requestOrigin === 'http://localhost:5173') {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    const original = new URL(request.url, 'http://platform.local');
    const pathname = prefix && original.pathname.startsWith(prefix) ? original.pathname.slice(prefix.length) || '/' : original.pathname;
    if (request.method === 'GET' && pathname === '/v1/health') return reply(response, 200, { ok: true, mode: 'MONAD_TESTNET_PLATFORM_API' });
    if (request.method === 'GET' && pathname === '/v1/strategies') return reply(response, 200, await service.publicStrategies());
    if (request.method === 'GET' && pathname === '/v1/me/portfolio') return reply(response, 200, await service.portfolio(request.headers.authorization));
    if (request.method !== 'POST') throw new PlatformError('METHOD_NOT_ALLOWED', 405);
    const input = await readBody(request);
    if (pathname === '/v1/auth/challenge') return reply(response, 200, await service.challenge(input));
    if (pathname === '/v1/auth/verify') return reply(response, 200, await service.verify(input));
    if (pathname === '/v1/strategists') return reply(response, 201, await service.upsertStrategist(request.headers.authorization, input));
    if (pathname === '/v1/api-keys') return reply(response, 201, await service.issueApiKey(request.headers.authorization));
    if (pathname === '/v1/strategies') return reply(response, 201, await service.createStrategy(request.headers.authorization, input));
    const performance = pathname.match(/^\/v1\/strategies\/([0-9a-f-]{36})\/performance-records$/i);
    if (performance) return reply(response, 201, await service.recordPerformance(request.headers.authorization, performance[1], input));
    throw new PlatformError('NOT_FOUND', 404);
  } catch (error) {
    const status = error instanceof PlatformError ? error.status : 500;
    reply(response, status, { error: status === 500 ? 'INTERNAL_ERROR' : error.message });
  }
}
