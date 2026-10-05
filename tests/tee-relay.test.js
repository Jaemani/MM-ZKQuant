import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { encryptionIdentity } from '../src/integration/sealed.js';
import { encryptedTeeRequest } from '../src/web/teeChannel.js';
import { relayTeePacket } from '../src/platform/tee-relay.js';
import { makePlatformServer } from '../src/platform/http.js';

const listen = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server => new Promise(resolve => server.close(resolve));
const packet = { ephemeral: '02' + '12'.repeat(32), box: { version: 1, iv: '12'.repeat(12), data: 'abcd', tag: '12'.repeat(16) } };

test('same-origin relay carries strategy and portfolio ciphertext without database access or plaintext', async () => {
  const identity = encryptionIdentity(randomBytes(32));
  const messages = [
    { action: 'TARGET', sessionToken: 'private-token', strategyId: 'private-strategy', targets: [{ market: 16, weightBps: 2000 }] },
    { action: 'PORTFOLIO', wallet: 'private-investor', signature: 'private-signature' },
  ];
  let calls = 0;
  const tee = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const wire = Buffer.concat(chunks).toString();
    assert.equal(request.headers.authorization, undefined);
    for (const value of ['private-token', 'private-strategy', 'private-investor', 'weightBps']) assert.ok(!wire.includes(value));
    const opened = identity.open(JSON.parse(wire));
    assert.deepEqual(opened.message, messages[calls]);
    assert.equal(request.url, calls === 0 ? '/platform/encrypted-strategy' : '/platform/encrypted-investments');
    calls++;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ reply: opened.reply({ accepted: true, privateValue: 'TEE-only' }) }));
  });
  const endpoint = await listen(tee);
  const platform = makePlatformServer({ teeEndpoint: endpoint, database: { query: () => { throw Error('database must not be used'); } } }, { prefix: '/api' });
  const base = await listen(platform);
  try {
    for (const [index, path] of ['/platform/encrypted-strategy', '/platform/encrypted-investments'].entries()) {
      assert.deepEqual(await encryptedTeeRequest(endpoint, identity.publicKey, path, messages[index], { relayBase: `${base}/api/tee` }), { accepted: true, privateValue: 'TEE-only' });
    }
    assert.equal(calls, 2);
  } finally { await Promise.all([close(platform), close(tee)]); }
});

test('relay rejects plaintext and arbitrary paths before contacting the TEE', async () => {
  const options = { fetchImpl: () => { throw Error('must not fetch'); } };
  assert.equal((await relayTeePacket('https://tee.invalid', '/arbitrary', packet, options)).status, 404);
  assert.equal((await relayTeePacket('https://tee.invalid', '/encrypted-strategy', { ...packet, targets: [] }, options)).status, 400);
  assert.equal((await relayTeePacket('https://tee.invalid', '/encrypted-strategy', { action: 'TARGET' }, options)).status, 400);
});

test('failed relay POST is never retried and diagnostics contain no upstream secrets', async () => {
  let calls = 0;
  const result = await relayTeePacket('https://tee.invalid', '/encrypted-strategy', packet, { fetchImpl: async () => { calls++; throw Error('private-token network error'); } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 503, body: { error: 'TEE_CONNECTION_FAILED' } });
  assert.equal(JSON.stringify(result).includes('private-token'), false);
  const timeout = await relayTeePacket('https://tee.invalid', '/encrypted-strategy', packet, { fetchImpl: async () => { throw new DOMException('private timeout', 'TimeoutError'); } });
  assert.equal(timeout.body.error, 'TEE_RESPONSE_TIMEOUT');
});
