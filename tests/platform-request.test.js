import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlatformJson } from '../src/web/platformRequest.js';

test('read-only profile requests recover from transient network and server failures', async () => {
  for (const first of [() => { throw new TypeError('Failed to fetch'); }, () => new Response(JSON.stringify({error:'INTERNAL_ERROR'}), {status:500})]) {
    let calls = 0;
    const result = await fetchPlatformJson('/api/v1/me', {}, { retryDelayMs:0, fetchImpl: async () => ++calls === 1 ? first() : new Response(JSON.stringify({wallet:'alice'})) });
    assert.deepEqual(result, {wallet:'alice'});
    assert.equal(calls,2);
  }
});

test('write requests and unauthorized sessions are never retried', async () => {
  for (const [method,status] of [['POST',503],['GET',401]]) {
    let calls = 0;
    await assert.rejects(fetchPlatformJson('/api/v1/auth/verify', {method}, { fetchImpl: async () => { calls++; return new Response(JSON.stringify({error:'SESSION_EXPIRED'}), {status}); } }), error => error.status === status);
    assert.equal(calls,1);
  }
});

test('non-JSON proxy failures receive bounded retries and a usable diagnostic', async () => {
  let calls = 0;
  await assert.rejects(fetchPlatformJson('/api/v1/config', {}, { retryDelayMs:0, fetchImpl: async () => { calls++; return new Response('<html>gateway failure</html>', {status:502}); } }), /PLATFORM_RESPONSE_INVALID/);
  assert.equal(calls,2);
});
