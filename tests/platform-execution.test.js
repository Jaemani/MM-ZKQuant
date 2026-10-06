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
function gasFixture() {
 const {e,book,state}=fixture(),records={};state.config={vaultAddress:'vault'};
 e.step=PlatformExecution.prototype.step;
 let gasAvailable=false,broadcasts=0;
 e.investments={state:()=>state,serial:fn=>fn()};e.catalogAt=Date.now();
 e.observeBook=async()=>[];e.settle=async()=>{};e.payFees=async()=>{};
 e.submitter={sync:async()=>{},lookup:id=>records[id],publicState:()=>({records}),submit:async(id)=>{
   if(broadcasts>0&&!gasAvailable)throw Error('OPERATOR_GAS_INSUFFICIENT');
   broadcasts++;return records[id]={status:1,hash:`confirmed-${broadcasts}`};
 }};
 e.execute=async(state,book,job)=>{
   job.status='EXECUTING';
   await e.step(state,job,'first',{to:'slot',data:'0x01'},{bookId:book.id,kind:'CASH',delta:'-10000000'});
   await e.step(state,job,'second',{to:'slot',data:'0x02'},{bookId:book.id,kind:'CASH',delta:'-1000000'});
   job.status='EXECUTED';delete job.error;
 };
 const job=book.requests.gas={id:'gas',status:'QUEUED',deadline:Math.floor(Date.now()/1000)+300,steps:{}};
 return {e,book,state,job,records,topUp:()=>{gasAvailable=true;},broadcasts:()=>broadcasts};
}
test('gas shortage retains the active request and top-up resumes without replaying confirmed effects',async()=>{
 const f=gasFixture();await f.e.tick();
 assert.equal(f.job.status,'EXECUTING');assert.equal(f.job.error,'OPERATOR_GAS_INSUFFICIENT');
 assert.equal(f.book.cash,'90000000');assert.equal(f.broadcasts(),1);
 const first=f.job.steps.first.hash,secondId=f.job.steps.second.id;
 await f.e.tick();assert.equal(f.broadcasts(),1);assert.equal(f.book.cash,'90000000');
 f.topUp();await f.e.tick();await f.e.tick();
 assert.equal(f.job.status,'EXECUTED');assert.equal(f.job.error,undefined);assert.equal(f.book.cash,'89000000');
 assert.equal(f.broadcasts(),2);assert.equal(f.job.steps.first.hash,first);assert.equal(f.job.steps.second.id,secondId);
});
test('an expired gas wait cannot broadcast an unsigned saved step, but confirmed effects still reconcile',async()=>{
 const f=gasFixture();await f.e.tick();f.job.deadline=1;f.topUp();
 await f.e.tick();assert.equal(f.job.status,'EXPIRED');assert.equal(f.job.error,'ORDER_EXPIRED');assert.equal(f.broadcasts(),1);assert.equal(f.book.cash,'90000000');
 const {e,book,state}=fixture(),job={id:'expired-confirmed',deadline:1,steps:{}};
 e.step=PlatformExecution.prototype.step;
 e.submitter={lookup:()=>({status:1,hash:'confirmed'}),submit:()=>{throw Error('must not broadcast');}};
 await e.step(state,job,'recover',{to:'vault',data:'0x'},{bookId:book.id,kind:'CASH',delta:'1000000'});
 await e.step(state,job,'recover',{to:'vault',data:'0x'},{bookId:book.id,kind:'CASH',delta:'1000000'});
 assert.equal(book.cash,'101000000');
});
test('old failed gas-budget requests are historical and are not silently resubmitted',async()=>{
 const f=gasFixture();f.job.status='FAILED';f.job.error='TEE_GAS_BUDGET';f.topUp();
 await f.e.tick();assert.equal(f.job.status,'FAILED');assert.equal(f.job.error,'TEE_GAS_BUDGET');assert.equal(f.broadcasts(),0);
});

test('background execution releases the financial mutex between strategies and reads fresh account changes',async()=>{
 const f=gasFixture(),events=[];f.job.status='EXECUTED';f.state.books.other=newBook({id:'other',strategist_wallet:'bob',fee_bps:0});
 let tail=Promise.resolve(),mutation;
 f.e.investments.serial=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
 f.e.observeBook=async book=>{events.push(book.id);if(book===f.book)mutation=f.e.investments.serial(()=>{events.push('account');f.state.books.other.cash='123';});else assert.equal(book.cash,'123');return [];};
 await f.e.tick();await mutation;assert.deepEqual(events,[f.book.id,'account','other']);
});

test('failed execution diagnostics replay historical calls without broadcasting or exposing calldata',async()=>{
 const e=Object.create(PlatformExecution.prototype),state={books:{s:{requests:{failed:{id:'failed',status:'FAILED',error:'EXECUTION_CONFIRMATION_REQUIRED',createdAt:210,deadline:330,steps:{'fund-16':{id:'fund',applied:true},'target-16-0':{request:{to:'private-account',data:'private-calldata'},applied:false}}}}}}},before=JSON.stringify(state),calls=[];
 e.authorize=async()=>({id:'s'});e.investments={state:()=>structuredClone(state),serial:()=>{throw Error('Diagnostics must not acquire the mutation queue');}};
 e.wallet={address:'operator',sendTransaction:()=>{throw Error('must not broadcast');}};
 e.submitter={lookup:()=>({block:90,status:1})};
 e.provider={getBlock:async tag=>({number:tag==='latest'?100:tag,timestamp:200+(tag==='latest'?100:tag)}),call:async request=>{calls.push(request);const error=Error('RPC message contains private request');error.code='CALL_EXCEPTION';error.reason='ORDER_TOO_SMALL';throw error;}};
 const result=await e.accept({action:'DIAGNOSE',requestId:'failed'});assert.deepEqual(calls.map(c=>c.blockTag),[90,100]);assert.equal(result.prerequisitesConfirmed,true);assert.equal(result.stage,'TRADE');assert.equal(result.error,'EXECUTION_CONFIRMATION_REQUIRED');assert.ok(result.probes.every(p=>p.result==='REVERTED'&&p.reason==='ORDER_TOO_SMALL'));assert.equal(JSON.stringify(state),before);assert.ok(!JSON.stringify(result).includes('private-'));
 await assert.rejects(()=>e.accept({action:'DIAGNOSE',requestId:'missing'}),/REQUEST_NOT_FOUND/);
});
