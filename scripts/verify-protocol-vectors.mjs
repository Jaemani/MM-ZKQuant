import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { vectorRunner } from '../protocol/ts/vector-runner.mts';
const {vectors}=JSON.parse(readFileSync('protocol/vectors/draft-v0.1.json'));
const run=await vectorRunner();
const rust=JSON.parse(execFileSync('cargo',['run','--locked','--quiet','-p','metropolis-reference'],{input:JSON.stringify(vectors),encoding:'utf8',maxBuffer:8*1024*1024}));
assert.equal(rust.length,vectors.length);
for(let i=0;i<vectors.length;i++) {
  assert.deepEqual(run(vectors[i]),vectors[i].expected,`TypeScript: ${vectors[i].id}`);
  assert.deepEqual(rust[i],vectors[i].expected,`Rust: ${vectors[i].id}`);
}
const report={status:'PASS_DRAFT_TWO_LANGUAGE_VECTORS',vectors:vectors.length,accepted:vectors.filter(v=>!v.expected.error).length,rejected:vectors.filter(v=>v.expected.error).length,implementations:['TypeScript','Rust'],milestoneM1Complete:false};
if(process.argv.includes('--write-evidence')) {
  const paths=['protocol/vectors/draft-v0.1.json','protocol/ts/encoding.mts','protocol/ts/model.mts','protocol/ts/vector-runner.mts','protocol/reference/src/lib.rs','protocol/reference/src/model.rs','protocol/reference/src/main.rs','Cargo.lock','scripts/verify-protocol-vectors.mjs'];
  const hashes=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
  writeFileSync('docs/evidence/protocol-v0.1-conformance.json',JSON.stringify({...report,createdAt:new Date().toISOString(),sha256:hashes,limitations:['No Circom/Solidity comparison','No complete transition model or production circuit','No venue execution, hardware TEE, or proving benchmark']},null,2)+'\n');
}
console.log(JSON.stringify(report));
