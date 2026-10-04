import test from 'node:test';import assert from 'node:assert/strict';
import {settleCohort} from '../protocol/cohort/accounting.mjs';
test('terminal cohort: loss has no performance fee; gains paid after HWM',()=>{
 const loss=settleCohort([100n,300n],360n,2000n);assert.deepEqual(loss.claims,[90n,270n]);assert.equal(loss.totalFee,0n);
 const gain=settleCohort([100n,300n],440n,2000n);assert.deepEqual(gain.claims,[108n,324n]);assert.equal(gain.totalFee,8n);
});
test('terminal cohort: bounded rounding and conservation across 1000 amounts',()=>{
 for(let n=0n;n<1000n;n++){const r=settleCohort([17n,53n],n,1999n);assert.equal(r.claims[0]+r.claims[1]+r.totalFee,n);assert.ok(r.allocationRemainder<70n);assert.ok(r.feeRemainders.every(x=>x<10000n));}
});
test('terminal cohort: invalid subscriptions, cap and field wrap rejected',()=>{
 for(const args of [[[0n,2n],2n,0n],[[1n,2n],-1n,0n],[[1n,2n],2n,2001n],[[1n,2n],2n**64n,0n]])assert.throws(()=>settleCohort(...args),/COHORT_RANGE/);
});
