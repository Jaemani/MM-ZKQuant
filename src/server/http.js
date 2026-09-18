import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { AlphaService, AppError } from './service.js';
import { PilotApi } from '../pilot/api.js';
import { SleeveReview } from '../sleeves/review.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicDocuments = new Set(['requirements.md', 'development-spec.md', 'acceptance-tests.md', 'three-week-execution-plan.md', 'mvp-readiness.md', 'pilot/runbook.md', 'pilot/development-spec.md', 'confidential-alpha-v0.2.md', 'sleeves-v0.2.md']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };
function reply(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON content type required', 415);
  let size = 0, chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new AppError('Request body exceeds 64 KiB', 413);
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new AppError('Invalid JSON object'); }
}
export function makeHttpServer(service, { port = 8790, pilotDirectory = resolve(process.env.ALPHA_DATA_DIR || resolve(ROOT,'.data'),'testnet-pilot') } = {}) {
  let pilot;
  const pilotApi=()=>pilot||(pilot=new PilotApi(pilotDirectory,ROOT));
  let sleeves;
  const sleeveReview=()=>sleeves||(sleeves=new SleeveReview(resolve(pilotDirectory,'../sleeve-review/state.json')));
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    let workspace = 'demo';
    try {
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']);
      if (!allowedHosts.has(request.headers.host)) throw new AppError('This review server only accepts localhost requests', 403);
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      const path = url.pathname;
      workspace = service.workspace(url.searchParams.get('workspace') ?? 'demo');
      if (request.method === 'GET') {
        if(path==='/api/sleeves/review'){try{return reply(response,200,sleeveReview().view(url.searchParams.get('investor')||'review-a'));}catch(error){throw new AppError(error.message,400);}}
        if(path.startsWith('/api/pilot/')) {try{return reply(response,200,pilotApi().get(path,url));}catch(error){throw new AppError(error.message,400);}}
        if (path === '/api/health') return reply(response, 200, { ok: true, mode: 'LOCAL_REVIEW_ONLY' });
        if (path === '/api/state') return reply(response, 200, service.state(workspace));
        if (path === '/api/verification-key') return reply(response, 200, { algorithm: 'Ed25519', publicKey: service.serverSigningKey });
        let match = path.match(/^\/api\/receipts\/([^/]+)\/([^/]+)$/);
        if (match) return reply(response, 200, service.getReceipt(workspace, match[1], match[2], request.headers.authorization?.replace(/^Bearer /, '')));
        match = path.match(/^\/api\/epochs\/([^/]+)\/manifest$/);
        if (match) return reply(response, 200, service.manifest(workspace, match[1]));
        if (path.startsWith('/api/')) throw new AppError('Endpoint not found', 404);
        if (path.startsWith('/docs/') && publicDocuments.has(path.slice(6))) {
          response.writeHead(200, { 'Content-Type': mime['.md'] }); response.end(readFileSync(resolve(ROOT, 'docs', path.slice(6)))); return;
        }
        const dist = resolve(ROOT, 'dist');
        const target = resolve(dist, '.' + decodeURIComponent(path));
        let file = target.startsWith(dist + sep) && existsSync(target) && statSync(target).isFile() ? target : resolve(dist, 'index.html');
        if (!existsSync(file)) { response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Run npm run dev for development, or npm run build before npm start.'); return; }
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); response.end(readFileSync(file)); return;
      }
      if (request.method !== 'POST' || !path.startsWith('/api/')) throw new AppError('Method not allowed', 405);
      const allowedOrigins = new Set([...allowedHosts].map(host => 'http://' + host));
      if (request.headers.origin ? !allowedOrigins.has(request.headers.origin) : request.headers['x-local-client'] !== 'mm-alpha-sdk') throw new AppError('Same-origin browser or explicit local SDK request required', 403);
      const body = await readBody(request);
      if(path.startsWith('/api/sleeves/review/')){
        try {const review=sleeveReview(),action=path.slice('/api/sleeves/review/'.length);if(!['allocate','redeem','cycle'].includes(action))throw new Error('Unknown review operation');return reply(response,200,review[action](body));}catch(error){throw new AppError(error.message,400);}
      }
      if(path.startsWith('/api/pilot/')) {try{return reply(response,200,await pilotApi().post(path,body));}catch(error){throw new AppError(error.message,400);}}
      workspace = service.workspace(body.workspace ?? workspace);
      if (path === '/api/providers') return reply(response, 201, service.register(workspace, body));
      if (path === '/api/epochs') return reply(response, 201, service.createEpoch(workspace, body));
      if (path === '/api/submissions') return reply(response, 200, service.submit(workspace, body));
      if (path === '/api/demo/run') { if (workspace !== 'demo') throw new AppError('Synthetic cycles are only allowed in the demo workspace'); return reply(response, 200, service.demoRun()); }
      if (path === '/api/vault/deposit') return reply(response, 200, service.flow(workspace, 'DEPOSIT', body));
      if (path === '/api/vault/withdraw') return reply(response, 200, service.flow(workspace, 'WITHDRAW', body));
      const match = path.match(/^\/api\/epochs\/([^/]+)\/(seal|evaluate)$/);
      if (match) return reply(response, 200, match[2] === 'seal' ? service.seal(workspace, match[1], body) : service.evaluate(workspace, match[1], body));
      throw new AppError('Endpoint not found', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const reason = status === 500 ? 'Internal operation failed; the transaction was rolled back' : error.message;
      if (request.method === 'POST') service.store.audit(workspace, request.url?.split('?')[0] ?? 'unknown', reason);
      reply(response, status, { error: reason });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535');
  const store = new Store(process.env.ALPHA_DATA_DIR ?? resolve(ROOT, '.data'));
  const server = makeHttpServer(new AlphaService(store), { port });
  server.requestTimeout = 15000;
  server.listen(port, '127.0.0.1', () => console.log(`MM Alpha Fund review server: http://127.0.0.1:${port} (PAPER / operator-trusted / localhost only)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
