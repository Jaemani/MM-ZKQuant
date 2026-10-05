import test from 'node:test';
import assert from 'node:assert/strict';
import {PlatformExecution} from '../deploy/tee/operator/execution.mjs';
import {newBook,depositPending,activatePending,markBook,markVenueEquity,requestWithdrawal,portfolio,requestPendingWithdrawal,publicMetrics} from '../deploy/tee/operator/ledger.mjs';

function fixture({exitCost=1000000n}={}){
 const book=newBook({id:'s',strategist_wallet:'alice',fee_bps:0});
 depositPending(book,'alice','200000000');activatePending(book);book.cash='100000000';book.slots={16:'slot'};
 const state={books:{s:book}},o={address:'slot',market:16,qty:100n,free:0n,equity:100000000n,mark:1n,info:{markPNS:1n,priceDecimals:0n,lotDecimals:0n}};
 const e=Object.create(PlatformExecution.prototype);e.save=()=>{};e.provider={getBlockNumber:async()=>1};e.observation=async()=>structuredClone(o);
 e.observeBook=async(_,options)=>{markVenueEquity(book,BigInt(book.cash)+o.equity-BigInt(book.feesDue),options);return [structuredClone(o)];};
 const tx=(kind)=>(...args)=>({kind,args});e.vault=()=>({recoverSlot:{populateTransaction:tx('recover')},withdraw:{populateTransaction:tx('pay')}});
 let trades=0,pays=0,failRecovery=false;
 e.trade=async(state,book,job,market,target,label)=>{if(o.qty===target)return;trades++;const released=(o.equity-o.free)*(o.qty-target)/o.qty;o.free+=released-exitCost;o.equity-=exitCost;o.qty=target;job.steps[label]={applied:true};};
 e.step=async(state,job,label,request,effect)=>{if(job.steps[label]?.applied)return;if(request.kind==='recover'){if(failRecovery){failRecovery=false;throw Error('VENUE_WITHDRAWAL_LIMIT');}const amount=request.args[1];o.free-=amount;o.equity-=amount;}else pays++;const result={hash:'0xpaid'};e.applyEffect(state,effect,result);job.steps[label]={applied:true};return result;};
 return {e,book,state,o,counts:()=>({trades,pays}),failOnce:()=>{failRecovery=true;}};
}
test('cash-funded partial redemption preserves the remaining position and other investor value',async()=>{
 const {e,book,state,o,counts}=fixture();requestWithdrawal(book,'alice','100000000','w',0);
 await e.settle(state,book,86400);
 assert.equal(o.qty,100n);assert.equal(counts().trades,0);assert.equal(book.withdrawals.w.amount,'100000000');
 assert.equal(portfolio(book,'alice').value,'100000000');assert.equal(book.cash,'0');
});
test('redemption shortfall reduces positions and charges liquidation costs only to redeemed units',async()=>{
 const {e,book,state,o}=fixture();requestWithdrawal(book,'alice','150000000','w',0);
 await e.settle(state,book,86400);
 assert.equal(o.qty,50n);assert.equal(book.withdrawals.w.amount,'149000000');
 assert.equal(portfolio(book,'alice').value,'50000000');assert.equal(book.equity,'50000000');
});
test('venue withdrawal failure retains claims and resumes without closing or paying twice',async()=>{
 const {e,book,state,counts,failOnce}=fixture();requestWithdrawal(book,'alice','200000000','w',0);failOnce();
 await assert.rejects(()=>e.settle(state,book,86400),/WITHDRAWAL_LIMIT/);
 assert.equal(book.withdrawals.w.status,'SETTLING');assert.equal(book.totalUnits,'200000000');
 await e.settle(state,book,86401);await e.settle(state,book,86402);
 assert.deepEqual(counts(),{trades:1,pays:1});assert.equal(book.withdrawals.w.amount,'199000000');assert.equal(book.totalUnits,'0');
 assert.equal(publicMetrics(book).pnlBps,-50);
});
test('pending cash redemption is reserved across target submission and never changes active NAV',async()=>{
 const {e,book,state}=fixture();depositPending(book,'bob','20000000');
 requestPendingWithdrawal(book,'bob','10000000','pending',0);activatePending(book);
 assert.equal(portfolio(book,'bob').pending,'10000000');assert.equal(portfolio(book,'bob').units,'10000000');
 await e.settle(state,book,86400);assert.equal(portfolio(book,'bob').pending,'0');
 assert.equal(portfolio(book,'bob').value,'10000000');assert.equal(book.withdrawals.pending.status,'PAID');
});
test('risk exit closes only the affected strategy slots and requires explicit resume',async()=>{
 const {e,book,state,o}=fixture();book.status='RISK_EXIT';
 const other=newBook({id:'other',strategist_wallet:'bob',fee_bps:0});depositPending(other,'bob','70000000');activatePending(other);state.books.other=other;
 await e.riskExit(state,book);assert.equal(book.status,'HALTED');assert.equal(o.qty,0n);assert.equal(other.equity,'70000000');assert.equal(other.status,'ACTIVE');
});
test('performance fee excludes gains consumed by the investor exit costs',async()=>{
 const {e,book,state}=fixture();book.feeBps=2000;book.cash='100010000';
 requestWithdrawal(book,'alice','200000000','w',0);await e.settle(state,book,86400);
 assert.equal(book.withdrawals.w.amount,'199010000');assert.equal(book.investors.alice.fees,'0');assert.equal(book.feesDue,'0');
});
test('confirmed funding survives a crash before ledger save and applies exactly once',async()=>{
 const {e,book,state}=fixture();book.requests.job={id:'opaque-job',steps:{}};
 let persisted,records={},broadcasts=0,crash=true;
 e.save=s=>{if(crash&&Object.values(records).length)throw Error('PROCESS_CRASH');persisted=structuredClone(s);};
 e.submitter={lookup:id=>records[id],submit:async(id)=>{broadcasts++;return records[id]={status:1,hash:'0xconfirmed'};}};
 const run=(s)=>PlatformExecution.prototype.step.call(e,s,s.books.s.requests.job,'fund',{to:'slot',data:'0x'}, {bookId:'s',kind:'CASH',delta:'-10000000'});
 await assert.rejects(()=>run(state),/PROCESS_CRASH/);
 assert.equal(persisted.books.s.cash,'100000000');
 crash=false;const restarted=structuredClone(persisted);await run(restarted);await run(restarted);
 assert.equal(restarted.books.s.cash,'90000000');assert.equal(broadcasts,1);
});
test('an expired queued target cannot admit pending investor cash',async()=>{
 const {e,book,state}=fixture();depositPending(book,'bob','20000000');
 const job={id:'expired',deadline:1,targets:[],steps:{}};
 await assert.rejects(()=>e.execute(state,book,job),/ORDER_EXPIRED/);
 assert.equal(portfolio(book,'bob').pending,'20000000');assert.equal(portfolio(book,'bob').units,'0');
});
test('redemption costs do not trigger the remaining investors stop loss',async()=>{
 const {e,book,state}=fixture({exitCost:3000000n});book.policy.stopLossBps=100;
 requestWithdrawal(book,'alice','150000000','w',0);await e.settle(state,book,86400);
 await e.observeBook(book);
 assert.equal(book.status,'ACTIVE');assert.equal(book.nav,'1000000000000000000');
 assert.equal(book.maxObservedDrawdownBps,0);assert.equal(book.withdrawals.w.amount,'147000000');
});
test('redemption cost reservation survives a failed recovery without halting continuing investors',async()=>{
 const {e,book,state,failOnce}=fixture({exitCost:3000000n});book.policy.stopLossBps=100;
 requestWithdrawal(book,'alice','150000000','w',0);failOnce();
 await assert.rejects(()=>e.settle(state,book,86400),/WITHDRAWAL_LIMIT/);
 await e.observeBook(book);assert.equal(book.status,'ACTIVE');assert.equal(book.nav,'1000000000000000000');
 await e.settle(state,book,86401);await e.observeBook(book);
 assert.equal(book.status,'ACTIVE');assert.equal(book.equity,'50000000');
});
