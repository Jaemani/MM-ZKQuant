import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
import { encryptionIdentity } from '../src/integration/sealed.js';
import { encryptedTeeRequest } from '../src/web/teeChannel.js';

test('browser channel encrypts directly to the TEE public key', async () => {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const identity = encryptionIdentity(randomBytes(32));
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://tee.invalid/platform/encrypted-investments');
    const opened = identity.open(JSON.parse(options.body));
    assert.deepEqual(opened.message, { strategyId: 'private-strategy', amount: '1000000' });
    return { ok: true, json: async () => ({ reply: opened.reply({ accepted: true }) }) };
  };
  try {
    assert.deepEqual(await encryptedTeeRequest('https://tee.invalid', identity.publicKey, '/platform/encrypted-investments', { strategyId: 'private-strategy', amount: '1000000' }), { accepted: true });
  } finally { globalThis.fetch = priorFetch; }
});

test('historical execution errors are data only for a matching diagnostic response', async () => {
  const identity = encryptionIdentity(randomBytes(32)), priorFetch = globalThis.fetch;
  let reply = {id:'failed',status:'FAILED',error:'EXECUTION_CONFIRMATION_REQUIRED',historicalReplay:true,probes:[{code:'VENUE_COLLATERAL_INSUFFICIENT'}]};
  globalThis.fetch = async (_url, options) => {
    const opened = identity.open(JSON.parse(options.body));
    return {ok:true,json:async()=>({reply:opened.reply(reply)})};
  };
  const send = message => encryptedTeeRequest('https://tee.invalid',identity.publicKey,'/platform/encrypted-strategy',message);
  try {
    const result = await send({action:'DIAGNOSE',requestId:'failed'});
    assert.equal(result.executionError,'EXECUTION_CONFIRMATION_REQUIRED');
    assert.equal(Object.hasOwn(result,'error'),false);
    assert.equal(result.probes[0].code,'VENUE_COLLATERAL_INSUFFICIENT');
    await assert.rejects(()=>send({action:'STATUS',requestId:'failed'}),/EXECUTION_CONFIRMATION_REQUIRED/);
    await assert.rejects(()=>send({action:'DIAGNOSE',requestId:'other'}),/EXECUTION_CONFIRMATION_REQUIRED/);
    reply = {error:'STRATEGY_NOT_AUTHORIZED'};
    await assert.rejects(()=>send({action:'DIAGNOSE',requestId:'failed'}),/STRATEGY_NOT_AUTHORIZED/);
  } finally {globalThis.fetch=priorFetch;}
});
