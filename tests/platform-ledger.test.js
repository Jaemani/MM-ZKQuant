import test from 'node:test';
import assert from 'node:assert/strict';
import { newBook, depositPending, activatePending, markBook, crystallizeFees, requestWithdrawal, cancelWithdrawal, portfolio, SCALE } from '../deploy/tee/operator/ledger.mjs';
import { validatePolicy, validateTargets, targetLots } from '../src/platform/policy.js';
const make = () => newBook({ id: 's', strategist_wallet: '0xabc', fee_bps: 2000 });
test('pending cash does not participate in gains and joins at the next submission NAV', () => {
 const b=make(); depositPending(b,'alice','100000000'); activatePending(b);
 depositPending(b,'bob','60000000'); markBook(b,'120000000');
 assert.equal(portfolio(b,'bob').value,'0'); assert.equal(portfolio(b,'alice').value,'116000000');
 activatePending(b); assert.equal(portfolio(b,'bob').units,'50000000'); assert.equal(b.equity,'180000000');
});
test('separate subscription watermarks avoid charging recovery and charge new capital fairly', () => {
 const b=make(); depositPending(b,'alice','100000000'); activatePending(b);
 markBook(b,'110000000'); const fee=crystallizeFees(b); assert.ok(fee>=1999999n && fee<=2000000n);
 markBook(b,'98000000'); depositPending(b,'bob','10000000'); activatePending(b);
 const units=BigInt(b.totalUnits); markBook(b,units*105n/100n);
 const before=portfolio(b,'alice').fees; crystallizeFees(b);
 assert.equal(portfolio(b,'alice').fees,before); assert.ok(BigInt(portfolio(b,'bob').fees)>0n);
});
test('redemption cutoff and unit reservation prevent duplicate full withdrawals',()=>{
 const b=make();depositPending(b,'alice','1000');activatePending(b);
 const w=requestWithdrawal(b,'alice','1000','w1',0);assert.equal(w.settlementAt,86400);
 assert.throws(()=>requestWithdrawal(b,'alice','1','w2',0),/INSUFFICIENT/);
 assert.throws(()=>cancelWithdrawal(b,'bob','w1',1),/CANNOT_CANCEL/);
 cancelWithdrawal(b,'alice','w1',1);requestWithdrawal(b,'alice','1000','w2',83000);
 assert.equal(b.withdrawals.w2.settlementAt,172800);
});
test('risk exit blocks new pending capital activation',()=>{
 const b=make();depositPending(b,'alice','1000');activatePending(b);markBook(b,'700');
 assert.equal(b.status,'RISK_EXIT');depositPending(b,'bob','100');assert.throws(()=>activatePending(b),/HALTED/);
});
test('full target vector supports shorts with gross exposure cap and integer lot sizing',()=>{
 const p=validatePolicy();validateTargets([{market:16,weightBps:12000},{market:17,weightBps:-3000}],p);
 assert.throws(()=>validateTargets([{market:16,weightBps:21000}],p),/LEVERAGE/);
 assert.throws(()=>validateTargets([{market:16,weightBps:100},{market:16,weightBps:100}],p),/VECTOR/);
 assert.equal(targetLots('100000000',10000,'5000000',2,5),200n);
 assert.equal(targetLots('100000000',-3000,'5000000',2,5),-60n);
});
