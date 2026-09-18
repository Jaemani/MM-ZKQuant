import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Store } from '../src/server/store.js';
import { AlphaService } from '../src/server/service.js';
import { makeHttpServer } from '../src/server/http.js';

test('HTTP restricts localhost control requests, protects private receipts and returns typed failures', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-http-'));
  const store = new Store(directory), server = makeHttpServer(new AlphaService(store));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, options, body) => new Promise((resolve, reject) => {
    const request = httpRequest(base + path, options, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
    }); request.on('error', reject); request.end(body);
  });
  const get = (path, extra = {}) => send(path, { headers: { Host: '127.0.0.1:8790', ...extra } });
  const post = (path, body, extra = {}) => send(path, { method: 'POST', headers: { Host: '127.0.0.1:8790', 'Content-Type': 'application/json', 'X-Local-Client': 'mm-alpha-sdk', ...extra } }, JSON.stringify(body));
  assert.equal((await get('/api/health')).status, 200);
  assert.equal((await get('/api/state', { Host: 'attacker.example' })).status, 403);
  assert.equal((await post('/api/demo/run', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('/api/demo/run', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/demo/run', { workspace: 'forward' })).status, 400);
  const simulated = await post('/api/demo/run', {}, { Origin: 'http://127.0.0.1:8790' });
  assert.equal(simulated.status, 200);
  const { epoch } = await simulated.json(); assert.equal(epoch.status, 'EVALUATED');
  const state = await (await get('/api/state')).json(); assert.equal(state.providers.length, 10);
  assert.equal((await get(`/api/receipts/${epoch.id}/${state.providers[0].id}`)).status, 403);
  const manifest = await (await get(`/api/epochs/${epoch.id}/manifest`)).json(); assert.equal(manifest.root, epoch.root);
  assert.equal((await get('/api/unknown')).status, 404);
  assert.equal((await post('/api/vault/deposit', { amount: 1000, requestId: 'http-flow-001' })).status, 200);
  const after = await (await get('/api/state')).json();
  await post('/api/vault/deposit', { amount: 1000, requestId: 'http-flow-001' });
  assert.equal((await (await get('/api/state')).json()).book.nav, after.book.nav);
  assert.equal((await post('/api/providers', { name: 'a'.repeat(70000) })).status, 413);
});
