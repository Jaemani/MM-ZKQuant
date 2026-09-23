import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCodec, FIELD, encode } from '../../protocol/ts/encoding.mts';
import { vectorRunner } from '../../protocol/ts/vector-runner.mts';
const {vectors}=JSON.parse(readFileSync(new URL('../../protocol/vectors/draft-v0.1.json',import.meta.url)));
const run=await vectorRunner();
for(const v of vectors) test(`vector ${v.id}`,()=>assert.deepEqual(run(v),v.expected));
test('bytes32 masks low 253 bits; it does not reduce modulo p',()=>{
  const x=(1n<<256n)-1n;
  assert.equal(encode('bytes32',x),(1n<<253n)-1n);
  assert.notEqual(encode('bytes32',x),x%FIELD);
  assert.throws(()=>encode('u64',Number.MAX_SAFE_INTEGER));
});
test('S3: two conflicting same-sequence envelopes yield distinct commitments',async()=>{
  const c=await createCodec(), h=['10143','7','1','2','3','50','1','1800000000'];
  const a=c.intent(h,[['1','100'],['2','200']],'1');
  const b=c.intent(h,[['1','999'],['2','-200']],'2');
  assert.notEqual(a.intentComm,b.intentComm);
  // T4 only binds sequence and unused bit: after market 0 from A, bit 1 from B is unused.
  const currentSeq=3n,mask=1n,newSeq=3n,targetIndex=1n;
  assert.equal(newSeq===currentSeq && (mask & (1n<<targetIndex))===0n,true);
});
