import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { PilotCoordinator } from '../src/pilot/coordinator.js';
import { runLocalPilot, registerReferenceActors, submitReference } from '../src/pilot/runner.js';
import { compilePilot } from '../src/pilot/chain.js';
import { verifyContractEvidence } from '../src/pilot/verify.js';
import { encryptEnvelope, signObject } from '../src/server/crypto.js';
import { alphaCommitment } from '../src/pilot/policy.js';

test('two real local EVM rounds conserve assets, pay realized-profit fees, adjust weights and redeem shares',async()=>{
  const report=await runLocalPilot();
  const artifacts=compilePilot(),verified=verifyContractEvidence(report,artifacts);
  assert.equal(verified.epochs.length,2);assert.equal(verified.redemptionObserved,true);
  assert.ok(BigInt(verified.epochs[0].actualPayout)>0n);assert.equal(verified.epochs[1].actualPayout,'0');
  assert.equal(verified.reconstructedShareSupply,'0');
  for(const mutate of [
    r=>r.epochs[0].evaluation.allocations[Object.keys(r.epochs[0].evaluation.allocations)[0]]='123',
    r=>r.epochs[0].evaluation.realizedPnl='999999',
    r=>r.epochs[1].weights[Object.keys(r.epochs[1].weights)[0]]++,
    r=>r.transactions.find(t=>t.tag.endsWith('-commit')).blockTimestamp+=100000,
    r=>r.transactions.find(t=>t.tag.endsWith('-execute')).logs=[],
    r=>r.epochs[0].submissionReceipts.pop(),
    r=>r.epochs[0].submissionReceipts[0].commitmentSignature='invalid',
    r=>r.epochs[0].submissionReceipts[0].acceptedAt=r.epochs[0].manifest.cutoffAt,
    r=>r.epochs[0].leaves[0].payloadHash='0x'+'00'.repeat(32),
  ]) {const changed=structuredClone(report);mutate(changed);assert.throws(()=>verifyContractEvidence(changed,artifacts));}
});

test('approved actor submission is immutable, frozen, encrypted and checked again before evaluation',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'pilot-coordinator-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let now=1000;const c=new PilotCoordinator(directory,{clock:()=>now});
  const clients=await registerReferenceActors(c,['0x'+ '11'.repeat(20),'0x'+'22'.repeat(20),'0x'+'33'.repeat(20)]);
  const e=c.open({cutoffAt:1010,startAt:1020,endAt:1080});
  const openings=submitReference(c,clients,e,[[10000,0,0,0],[0,10000,0,0],[0,0,0,10000]]);
  const before=c.read();assert.throws(()=>c.seal(e.id),/seal window/);assert.deepEqual(c.read(),before);
  const forged={...openings[0].payload,vectorBps:[-10000,0,0,0]};
  const envelope=encryptEnvelope({payload:forged,signature:signObject(forged,clients[0].key),commitmentSignature:signObject(alphaCommitment(forged),clients[0].key)},createPublicKey(c.keys.encryptionPrivateKey));
  assert.throws(()=>c.submit(envelope),/replacement/);
  now=1010;const sealed=c.seal(e.id);c.verify(sealed);
  const publicText=JSON.stringify(c.publicState());assert.equal(publicText.includes(openings[0].payload.nonce),false);assert.equal(publicText.includes('envelope'),false);
  c.update(e.id,row=>row.submissions[clients[0].publicKey].envelope=envelope);
  assert.throws(()=>c.verify(c.read().epochs[0]),/commitment/);
  // A different process instance uses the same encrypted state and key material.
  const reopened=new PilotCoordinator(directory,{clock:()=>now});assert.equal(reopened.publicState().signingPublicKey,c.publicState().signingPublicKey);
  assert.throws(()=>reopened.verify(reopened.read().epochs[0]),/commitment/);
});
