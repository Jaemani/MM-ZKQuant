import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groth16, curves } from 'snarkjs';
import { field } from '../protocol/perpl/target-prover.mjs';
// Offline consistency/cryptographic verification, NOT an independent chain receipt audit.
const path=process.argv[2]||'docs/evidence/perpl-tee-mvp.json';
const e=JSON.parse(readFileSync(path));
try {
  assert.ok(e.status.startsWith('PASS_'));
  assert.equal(e.environment,'LOCAL_MONAD_TESTNET_FORK');
  assert.equal(e.externalNetworkBroadcast,false);
  assert.ok(e.checks.length>=30 && e.checks.every(c=>c.passed));
  for(const p of e.proofs)assert.equal(await groth16.verify(e.verificationKey,p.publicSignals,p.proof),true);
  for(const o of e.observations){
    const a=e.accounts.find(a=>a.label===o.product);assert.ok(a);
    const proof=e.proofs.find(p=>p.product===o.product && BigInt(p.publicSignals[1])===BigInt(a.address) && p.publicSignals[4]===String(field(o.target)) && p.publicSignals[5]===String(field(o.before)) && p.publicSignals[6]===o.limit);
    assert.ok(proof,'Observation missing matching proof');
    assert.equal(proof.publicSignals[0],'31337');assert.equal(proof.publicSignals[2],e.market);
    assert.ok(e.transactions.some(t=>t.hash===o.tx));
    if(e.hardwareTEE)assert.equal(proof.origin,'HARDWARE_TDX');
  }
  assert.equal(e.observations.length,6);
  if(e.atomicity){
    assert.equal(e.atomicity.successfulExecutions.length,6);
    const flatten=f=>[f,...(f.calls||[]).flatMap(flatten)];
    for(const item of e.atomicity.successfulExecutions){
      assert.ok(e.observations.some(o=>o.tx===item.tx));
      const calls=flatten(item.trace),v=calls.find(c=>c.to?.toLowerCase()===e.verifier.toLowerCase()),x=calls.find(c=>c.to?.toLowerCase()===e.exchange.toLowerCase()&&c.input?.startsWith(item.venue.selector));
      assert.ok(v&&!v.error&&x&&!x.error&&!item.trace.error);
      assert.equal(BigInt(v.output),1n);assert.ok(calls.indexOf(v)<calls.indexOf(x));
    }
    const failed=e.atomicity.venueFailure;
    assert.deepEqual(failed.before,failed.after);assert.ok(failed.trace.error);
    assert.ok(e.transactions.some(t=>t.hash===failed.tx&&t.status===0));
  }

  console.log(JSON.stringify({status:'PASS_OFFLINE_PROOFS_AND_EVIDENCE_CONSISTENCY',proofs:e.proofs.length,executions:e.observations.length,limitations:'Does not independently authenticate historical fork receipts or hardware proof origin. Re-run the live harness for those checks.'}));
} finally {await(await curves.getCurveFromName('bn128')).terminate();}
