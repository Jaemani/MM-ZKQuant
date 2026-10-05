import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformDatabase } from './database.js';
import { PlatformError, PlatformService } from './service.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
const environment = () => {
  const values = { ...process.env };
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && !values[match[1]]) values[match[1]] = match[2].trim();
    }
  } catch { /* deployment supplies environment variables */ }
  return values;
};
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new PlatformError('JSON_CONTENT_TYPE_REQUIRED', 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 65_536) throw new PlatformError('REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { throw new PlatformError('INVALID_JSON'); }
}

export function makePlatformServer(service, { origin = 'https://mm-zkquant.vercel.app' } = {}) {
  return createServer(async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (requestOrigin === origin || requestOrigin === 'http://localhost:5173') {
      response.setHeader('Access-Control-Allow-Origin', requestOrigin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      const url = new URL(request.url, 'http://platform.local');
      if (request.method === 'GET' && url.pathname === '/v1/health') return json(response, 200, { ok: true, mode: 'MONAD_TESTNET_PLATFORM_API' });
      if (request.method === 'GET' && url.pathname === '/v1/strategies') return json(response, 200, await service.publicStrategies());
      if (request.method === 'GET' && url.pathname === '/v1/me/portfolio') return json(response, 200, await service.portfolio(request.headers.authorization));
      if (request.method !== 'POST') throw new PlatformError('METHOD_NOT_ALLOWED', 405);
      const input = await body(request);
      if (url.pathname === '/v1/auth/challenge') return json(response, 200, await service.challenge(input));
      if (url.pathname === '/v1/auth/verify') return json(response, 200, await service.verify(input));
      if (url.pathname === '/v1/strategists') return json(response, 201, await service.upsertStrategist(request.headers.authorization, input));
      if (url.pathname === '/v1/api-keys') return json(response, 201, await service.issueApiKey(request.headers.authorization));
      if (url.pathname === '/v1/strategies') return json(response, 201, await service.createStrategy(request.headers.authorization, input));
      const performance = url.pathname.match(/^\/v1\/strategies\/([0-9a-f-]{36})\/performance-records$/i);
      if (performance) return json(response, 201, await service.recordPerformance(request.headers.authorization, performance[1], input));
      throw new PlatformError('NOT_FOUND', 404);
    } catch (error) {
      const status = error instanceof PlatformError ? error.status : 500;
      json(response, status, { error: status === 500 ? 'INTERNAL_ERROR' : error.message });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = environment(), port = Number(config.PORT || 8789);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT must be an integer from 1024 to 65535');
  const database = new PlatformDatabase({ databaseUrl: config.DATABASE_URL });
  const server = makePlatformServer(new PlatformService(database), { origin: config.PLATFORM_ORIGIN });
  server.listen(port, '0.0.0.0', () => console.log(`MM-ZKQuant platform API listening on ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => database.close().finally(() => process.exit(0))));
}
