import { PlatformError } from './service.js';
import { relayTeePacket } from './tee-relay.js';

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
    if (request.method === 'POST' && pathname.startsWith('/tee/')) {
      const result = await relayTeePacket(service.teeEndpoint, pathname.slice(4), await readBody(request));
      return reply(response, result.status, result.body);
    }
    if (request.method === 'GET' && pathname === '/v1/health') return reply(response, 200, { ok: true, mode: 'MONAD_TESTNET_PLATFORM_API' });
    if (request.method === 'GET' && pathname === '/v1/config') return reply(response, 200, await service.publicConfig());
    if (request.method === 'GET' && pathname === '/v1/tee-attestation') return reply(response, 200, await service.teeAttestation(request.headers.authorization));
    if (request.method === 'GET' && pathname === '/v1/ledger-proof-status') return reply(response,200,await service.ledgerProofs({statusOnly:true}));
    if (request.method === 'GET' && pathname === '/v1/ledger-proofs') return reply(response,200,await service.ledgerProofs({after:Number(original.searchParams.get('after')||0),limit:Number(original.searchParams.get('limit')||20)}));
    if (request.method === 'GET' && pathname === '/v1/strategies') return reply(response, 200, await service.publicStrategies());
    const detail = pathname.match(/^\/v1\/strategies\/([a-z][a-z0-9-]{2,47})$/i);
    if (request.method === 'GET' && detail) return reply(response, 200, await service.strategyDetail(detail[1],Object.fromEntries(original.searchParams)));
    if (request.method === 'GET' && pathname === '/v1/me') return reply(response, 200, await service.me(request.headers.authorization));
    if (request.method === 'GET' && pathname === '/v1/me/strategies') return reply(response, 200, await service.myStrategies(request.headers.authorization));
    if (request.method === 'GET' && pathname === '/v1/api-keys') return reply(response,200,await service.listApiKeys(request.headers.authorization));
    if (request.method !== 'POST') throw new PlatformError('METHOD_NOT_ALLOWED', 405);
    const input = await readBody(request);
    if (pathname === '/v1/tee-metrics') return reply(response,200,await service.publishMetrics(input));
    if (pathname === '/v1/auth/register') return reply(response,201,await service.register(input));
    if (pathname === '/v1/auth/login') return reply(response,200,await service.login(input));
    if (pathname === '/v1/auth/credentials') return reply(response,200,await service.setCredentials(request.headers.authorization,input));
    if (pathname === '/v1/auth/logout') return reply(response,200,await service.logout(request.headers.authorization));
    if (pathname === '/v1/account-authorization') return reply(response,200,await service.accountAuthorization(request.headers.authorization,input));
    if (pathname === '/v1/tee-wallet-binding') return reply(response,200,await service.bindWallet(input));
    if (pathname === '/v1/auth/challenge') return reply(response, 200, await service.challenge(input));
    if (pathname === '/v1/auth/verify') return reply(response, 200, await service.verify(input));
    if (pathname === '/v1/strategists') return reply(response, 201, await service.upsertStrategist(request.headers.authorization, input));
    const revoke = pathname.match(/^\/v1\/api-keys\/([0-9a-f-]{36})\/revoke$/i);
    if (revoke) return reply(response,200,await service.revokeApiKey(request.headers.authorization,revoke[1]));
    if (pathname === '/v1/api-keys') return reply(response, 201, await service.issueApiKey(request.headers.authorization));
    if (pathname === '/v1/strategies') return reply(response, 201, await service.createStrategy(request.headers.authorization, input));
    if (pathname === '/v1/strategy-authorization') return reply(response,200,await service.authorizeStrategy(request.headers.authorization,input.strategyId));
    const performance = pathname.match(/^\/v1\/strategies\/([0-9a-f-]{36})\/performance-records$/i);
    if (performance) return reply(response, 201, await service.recordPerformance(request.headers.authorization, performance[1], input));
    const target = pathname.match(/^\/v1\/strategies\/([0-9a-f-]{36})\/targets$/i);
    const policy = pathname.match(/^\/v1\/strategies\/([0-9a-f-]{36})\/policy$/i);
    if(policy)return reply(response,202,await service.proposePolicy(request.headers.authorization,policy[1],input));
    if (target) return reply(response, 202, await service.submitTarget(request.headers.authorization, target[1], input));
    throw new PlatformError('NOT_FOUND', 404);
  } catch (error) {
    const status = error instanceof PlatformError ? error.status : 500;
    if (status === 500) console.error('PLATFORM_REQUEST_FAILED', error.code || error.name || 'UNKNOWN');
    reply(response, status, { error: status === 500 ? 'INTERNAL_ERROR' : error.message });
  }
}
