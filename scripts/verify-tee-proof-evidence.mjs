import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groth16, curves } from 'snarkjs';

// Rechecks only the public proof. Hardware provenance was checked online;
// this command cannot retrospectively establish fresh hardware attestation.
try {
  const tee=JSON.parse(readFileSync('docs/evidence/tee-hardware-probe.json'));
  const fork=JSON.parse(readFileSync('docs/evidence/zk-book-fork.json'));
  for(const field of ['circuitSha256','wasmSha256','zkeySha256'])assert.equal(tee.manifest[field],fork.build[field]);
  assert.equal(await groth16.verify(fork.verificationKey,tee.proof.publicSignals,tee.proof.proof),true);
  const changed=[...tee.proof.publicSignals];changed[6]=String(BigInt(changed[6])+1n);
  assert.equal(await groth16.verify(fork.verificationKey,changed,tee.proof.proof),false);
  console.log(JSON.stringify({status:'PASS_OFFLINE_PROOF_ONLY',hardwareReverified:false,productionSetup:false}));
} finally { await(await curves.getCurveFromName('bn128')).terminate(); }
