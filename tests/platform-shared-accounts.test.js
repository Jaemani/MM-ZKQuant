import test from 'node:test';
import assert from 'node:assert/strict';
import { getCreateAddress } from 'ethers';
import { PlatformExecution } from '../deploy/tee/operator/execution.mjs';
import { SharedAccounts,checkpointSharedAccount,selectSharedAccount } from '../deploy/tee/operator/shared-accounts.mjs';
import { newBook,depositPending,portfolio,requestWithdrawal } from '../deploy/tee/operator/ledger.mjs';
import { assertInvestmentStateEmpty,assertVaultRetirable } from '../src/platform/vault-retirement.js';

const unit=1000000n;
test('funding a second market reserves actual collateral locked in the first market',()=>{
 const info={markPNS:'1',priceDecimals:'0',lotDecimals:'0'},book={id:'a',slots:{16:'pool',32:'pool'},policy:{maxLeverageBps:20000}},pool={claims:{a:{equity:String(100n*unit),quantities:{16:'100',32:'0'}}},checkpoint:{free:'0',walletCash:'0',markets:{16:{qty:'100',mark:'1',deposit:String(100n*unit),info}}}},state={books:{a:book},sharedAccounts:{pool}};
 const shared=new SharedAccounts({});
 // The first position holds 100 AUSD despite the current 2x policy. The new
 // 100 AUSD exposure needs another 55 AUSD; locked funds cannot fund it.
 assert.equal(shared.funding(state,book,32,100n,info),55n*unit);
 assert.equal(shared.free(state,pool,book),0n);
 // A second owner has their own locked 100 AUSD. Do not reserve their
 // collateral against this owner or treat their account cash as spendable.
 pool.claims.b={equity:String(100n*unit),quantities:{16:'100'}};state.books.b={id:'b',policy:book.policy};
 pool.checkpoint.markets[16].qty='200';pool.checkpoint.markets[16].deposit=String(200n*unit);pool.checkpoint.free=String(100n*unit);
 assert.equal(shared.funding(state,book,32,100n,info),55n*unit);
 assert.equal(shared.free(state,pool,book),0n);
});
function fixture({bridge=false}={}) {
  const state={books:{},sharedAccounts:{},config:{vaultAddress:'0x1111111111111111111111111111111111111111',cashTokenAddress:'0x2222222222222222222222222222222222222222'}},banks={},records={},receipts={};let count=0,broadcasts=0,perplAccounts=0,pays=0,persisted;
  const e=Object.create(PlatformExecution.prototype);
  const info=m=>({markPNS:BigInt(Object.values(banks).find(b=>b.markets[m])?.markets[m].mark||'1'),priceDecimals:0n,lotDecimals:0n});
  e.save=s=>{persisted=structuredClone(s);};e.provider={getBlockNumber:async()=>broadcasts,getTransactionReceipt:async h=>receipts[h]};
  e.wallet={address:'0x3333333333333333333333333333333333333333'};
  e.exchange={getPerpetualInfoV2:async m=>info(m)};e.shared=new SharedAccounts(e,{nativeCreate:!bridge,artifact:{abi:['constructor(address,address,address,address)'],bytecode:'0x6000'}});
  const free=b=>{const locked=Object.values(b.markets).reduce((sum,p)=>sum+(BigInt(p.qty)<0n?-BigInt(p.qty):BigInt(p.qty))*BigInt(p.mark)*unit/2n,0n),equity=BigInt(b.equity)-BigInt(b.walletCash||0);b.free=String(equity>locked?equity-locked:0n);};
  const tx=kind=>(...args)=>({kind,args});
  e.vault=()=>({accountCount:async()=>count,accounts:async i=>`pool${i}`,...(!bridge?{createSharedAccounts:{populateTransaction:tx('create')},fundSlot:{populateTransaction:tx('fund')},recoverSlot:{populateTransaction:tx('recover')}}:{}),withdraw:{populateTransaction:tx('pay')}});
  e.shared.account=address=>({executeDelta:{populateTransaction:(...args)=>({kind:'trade',address,args})},fundFromBalance:{populateTransaction:amount=>({kind:'admit',address,args:[amount]})},recoverToVault:{populateTransaction:amount=>({kind:'recover',args:[address,amount]})}});
  e.shared.read=async(pool)=>structuredClone(banks[pool.address]);
  e.submitter={lookup:id=>records[id],publicState:()=>({records}),submit:async(id,request)=>{
    const nonce=broadcasts++;
    if(!request.kind){const address=getCreateAddress({from:e.wallet.address,nonce});banks[address]={accountId:'0',equity:'0',free:'0',walletCash:'0',markets:{}};count++;}
    if(request.kind==='create'){banks[`pool${count++}`]={accountId:'0',equity:'0',free:'0',markets:{}};}
    if(request.kind==='fund'){
      const [address,rawAmount]=request.args,amount=BigInt(rawAmount),b=banks[address];
      if(b.accountId==='0'){assert.ok(amount>=100n*unit);b.accountId=String(++perplAccounts);}
      b.equity=String(BigInt(b.equity)+amount);free(b);
    }
    if(request.kind==='admit'){
      const amount=BigInt(request.args[0]),b=banks[request.address];assert.ok(BigInt(b.walletCash)>=amount);
      if(b.accountId==='0'){assert.ok(amount>=100n*unit);b.accountId=String(++perplAccounts);}
      b.walletCash=String(BigInt(b.walletCash)-amount);free(b);
    }
    if(request.kind==='trade'){
      const [,market,rawBefore,rawDelta]=request.args,before=BigInt(rawBefore),delta=BigInt(rawDelta),b=banks[request.address],p=b.markets[market]||={qty:'0',mark:String(info(market).markPNS),premium:'0',deposit:'0',deltaPnl:'0',info:{markPNS:String(info(market).markPNS),priceDecimals:'0',lotDecimals:'0'}};
      assert.equal(BigInt(p.qty),before);p.qty=String(before+delta);b.equity=String(BigInt(b.equity)-unit);free(b);
    }
    if(request.kind==='recover'){const [address,rawAmount]=request.args,amount=BigInt(rawAmount),b=banks[address];assert.ok(amount<=BigInt(b.free)+BigInt(b.walletCash||0));b.equity=String(BigInt(b.equity)-amount);b.walletCash=String(BigInt(b.walletCash||0)>amount?BigInt(b.walletCash)-amount:0n);free(b);}
    if(request.kind==='pay'){
      const [address,rawAmount]=request.args;
      if(bridge&&banks[address]){const amount=BigInt(rawAmount),b=banks[address];b.equity=String(BigInt(b.equity)+amount);b.walletCash=String(BigInt(b.walletCash)+amount);free(b);}else pays++;
    }
    const result={status:1,hash:`0x${broadcasts}`,block:broadcasts,nonce};receipts[result.hash]={status:1,blockNumber:broadcasts};records[id]=result;return result;
  }};
  function book(id,capital=200){const b=state.books[id]=newBook({id,strategist_wallet:id,fee_bps:0});depositPending(b,id,String(BigInt(capital)*unit));return b;}
  async function target(book,targets){const job={id:`${book.id}-${Object.keys(book.requests).length}`,targets,deadline:Math.floor(Date.now()/1000)+300,steps:{}};book.requests[job.id]=job;await e.execute(state,book,job);return job;}
  return {e,state,banks,book,target,counts:()=>({accounts:count,perplAccounts,broadcasts,pays}),persisted:()=>persisted,free};
}

test('multiple markets and two same-direction strategies share one Perpl account',async()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b');
  await f.target(a,[{market:16,weightBps:2500},{market:17,weightBps:2500}]);
  await f.target(b,[{market:16,weightBps:5000}]);
  assert.equal(f.counts().accounts,1);assert.equal(f.counts().perplAccounts,1);
  assert.equal(a.slots[16],a.slots[17]);assert.equal(a.slots[16],b.slots[16]);
  assert.equal(f.banks.pool0.markets[16].qty,'150');assert.equal(f.banks.pool0.markets[17].qty,'50');
  const av=await f.e.observeBook(a,undefined,f.state),bv=await f.e.observeBook(b,undefined,f.state);
  assert.equal(av.reduce((s,p)=>s+p.equity,0n)+bv.reduce((s,p)=>s+p.equity,0n),BigInt(f.banks.pool0.equity));
  assert.equal(portfolio(a,'a').value,'198000000');assert.equal(portfolio(b,'b').value,'199000000');
});

test('an opposite direction creates only the unavoidable second account and shares its other market',async()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b');
  await f.target(a,[{market:16,weightBps:5000},{market:17,weightBps:2500}]);
  await f.target(b,[{market:16,weightBps:-5000},{market:17,weightBps:2500}]);
  assert.equal(f.counts().accounts,2);assert.notEqual(a.slots[16],b.slots[16]);
  assert.equal(b.slots[16],b.slots[17]);assert.equal(f.banks.pool0.markets[16].qty,'100');assert.equal(f.banks.pool1.markets[16].qty,'-100');
});

test('small-capital strategies use an existing account without a new 100 AUSD minimum',async()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b',20);
  await f.target(a,[{market:16,weightBps:5000}]);await f.target(b,[{market:16,weightBps:5000}]);
  assert.equal(f.counts().perplAccounts,1);assert.equal(f.banks.pool0.markets[16].qty,'110');assert.equal(portfolio(b,'b').value,'19000000');
});

test('a sign reversal reuses a compatible account and cannot flatten another strategy',async()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b'),c=f.book('c');
  await f.target(a,[{market:16,weightBps:5000}]);await f.target(b,[{market:16,weightBps:5000}]);await f.target(c,[{market:16,weightBps:-5000}]);
  const bQty=f.state.sharedAccounts[b.slots[16]].claims.b.quantities[16];
  await f.target(a,[{market:16,weightBps:-5000}]);
  assert.equal(f.counts().accounts,2);assert.equal(a.slots[16],c.slots[16]);assert.equal(f.banks[b.slots[16]].markets[16].qty,bQty);
});

test('risk exit removes only the halted strategys exposure from a shared position',async()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b');
  await f.target(a,[{market:16,weightBps:5000}]);await f.target(b,[{market:16,weightBps:5000}]);
  const other=portfolio(b,'b').value;a.status='RISK_EXIT';await f.e.riskExit(f.state,a);
  assert.equal(a.status,'HALTED');assert.equal(f.banks.pool0.markets[16].qty,'100');
  await f.e.observeBook(b,undefined,f.state);assert.equal(portfolio(b,'b').value,other);
});

test('scheduled redemption charges only the exiting strategy and preserves another shared position',async()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b');
  await f.target(a,[{market:16,weightBps:5000}]);await f.target(b,[{market:16,weightBps:5000}]);
  const other=portfolio(b,'b').value;requestWithdrawal(a,'a',a.totalUnits,'withdraw',0);
  await f.e.settle(f.state,a,Math.floor(Date.now()/1000));
  assert.equal(a.withdrawals.withdraw.status,'PAID');assert.equal(a.withdrawals.withdraw.amount,'198000000');assert.equal(f.counts().pays,1);
  assert.equal(f.banks.pool0.markets[16].qty,'100');await f.e.observeBook(b,undefined,f.state);assert.equal(portfolio(b,'b').value,other);
});

test('market PnL and funding follow exposure, while unexplained losses cannot be silently allocated',async()=>{
  const pool={address:'pool',claims:{a:{equity:'100000000',quantities:{16:'100'}},b:{equity:'100000000',quantities:{16:'50'}}},checkpoint:{equity:'200000000',markets:{16:{qty:'150',mark:'1',premium:'0'}}}};
  const snapshot={equity:'353000000',free:'0',markets:{16:{qty:'150',mark:'2',premium:'3000000',info:{priceDecimals:'0',lotDecimals:'0'}}}};
  checkpointSharedAccount(pool,snapshot);
  assert.equal(pool.claims.a.equity,'202000000');assert.equal(pool.claims.b.equity,'151000000');
  const prior=structuredClone(pool);assert.throws(()=>checkpointSharedAccount(pool,{...snapshot,equity:'350000000'}),/RECONCILIATION/);assert.deepEqual(pool,prior);
  assert.throws(()=>checkpointSharedAccount(pool,{...snapshot,markets:{16:{...snapshot.markets[16],qty:'149'}}}),/POSITION_MISMATCH/);
});

test('an empty market reuses a shared account regardless of its other markets direction',()=>{
  const state={sharedAccounts:{a:{address:'a',claims:{other:{equity:'100',quantities:{16:'-10'}}}}}},book={id:'b',slots:{}};
  assert.equal(selectSharedAccount(state,book,17,20n).address,'a');assert.equal(selectSharedAccount(state,book,16,20n),null);
});

test('confirmed funding replays once after a crash before sealed-state save',async()=>{
  const f=fixture(),book=f.book('a');book.executionMode='SHARED';book.cash='200000000';
  const job={id:'crash',steps:{}};book.requests.crash=job;
  await f.e.shared.allocate(f.state,book,16,100n,job);
  const request=await f.e.vault(f.state).fundSlot.populateTransaction(book.slots[16],100n*unit,'opaque');
  const effect={kind:'SHARED_FUND',bookId:book.id,address:book.slots[16],amount:String(100n*unit)};
  const save=f.e.save;let crash=true;
  f.e.save=s=>{if(crash&&Object.values(f.state.sharedAccounts).some(p=>BigInt(p.claims.a?.equity||0)>0n))throw Error('CRASH');save(s);};
  await assert.rejects(()=>f.e.step(f.state,job,'fund',request,effect),/CRASH/);
  crash=false;const restored=f.persisted(),restoredJob=restored.books.a.requests.crash;
  await f.e.step(restored,restoredJob,'fund',request,effect);await f.e.step(restored,restoredJob,'fund',request,effect);
  assert.equal(restored.books.a.cash,'100000000');assert.equal(restored.sharedAccounts[book.slots[16]].claims.a.equity,'100000000');assert.equal(f.counts().perplAccounts,1);
});

test('retirement refuses sealed claims, pending subscriptions, fees and unresolved transactions',()=>{
  const state={books:{a:newBook({id:'a',strategist_wallet:'a',fee_bps:0})}};
  assert.doesNotThrow(()=>assertInvestmentStateEmpty(state));
  depositPending(state.books.a,'a','1');assert.throws(()=>assertInvestmentStateEmpty(state),/ACTIVE_INVESTMENTS/);
  state.books.a.investors={};state.books.a.feesDue='1';assert.throws(()=>assertInvestmentStateEmpty(state),/ACTIVE_INVESTMENTS/);
  state.books.a.feesDue='0';state.books.a.requests.pending={status:'EXECUTING'};assert.throws(()=>assertInvestmentStateEmpty(state),/ACTIVE_INVESTMENTS/);
  state.books.a.requests={};state.sharedAccounts={pool:{claims:{a:{equity:'0',quantities:{16:'1'}}}}};assert.throws(()=>assertInvestmentStateEmpty(state),/ACTIVE_INVESTMENTS/);
});

test('retirement requires a paused empty custody vault and empty Perpl accounts',async()=>{
  let paused=false,cash=0n,position=0n,orders=[],count=0;
  const contract=address=>address==='vault'?{paused:async()=>paused,accountCount:async()=>count,accounts:async()=> 'slot'}:address==='token'?{balanceOf:async a=>a==='vault'?cash:0n}:address==='slot'?{accountId:async()=>1n}:{getAccountByAddr:async()=>({accountId:1n,balanceCNS:0n,lockedBalanceCNS:0n,positions:{bank1:position,bank2:0n,bank3:0n,bank4:0n}}),getOrderLocks:async()=>orders};
  const check=()=>assertVaultRetirable({provider:{getBlockNumber:async()=>42},vaultAddress:'vault',cashTokenAddress:'token',contract});
  await assert.rejects(check,/MUST_BE_PAUSED/);paused=true;cash=1n;await assert.rejects(check,/VAULT_HAS_FUNDS/);
  cash=0n;count=1;position=1n;await assert.rejects(check,/ACCOUNT_HAS_FUNDS/);position=0n;orders=[{}];await assert.rejects(check,/HAS_ORDERS/);
  orders=[];assert.equal((await check()).ready,true);
});

test('receipt lookup failure cannot partially debit shared funding before replay',async()=>{
  const f=fixture(),book=f.book('a');book.executionMode='SHARED';book.cash='200000000';
  const job={id:'receipt-delay',steps:{}};book.requests[job.id]=job;
  await f.e.shared.allocate(f.state,book,16,100n,job);
  const request=await f.e.vault(f.state).fundSlot.populateTransaction(book.slots[16],100n*unit,'opaque');
  const effect={kind:'SHARED_FUND',bookId:book.id,address:book.slots[16],amount:String(100n*unit)},lookup=f.e.provider.getTransactionReceipt;
  f.e.provider.getTransactionReceipt=async()=>null;
  await assert.rejects(()=>f.e.step(f.state,job,'fund',request,effect),/PENDING_RECONCILE_REQUIRED/);
  assert.equal(book.cash,'200000000');assert.equal(f.state.sharedAccounts[book.slots[16]].claims.a.equity,'0');
  f.e.provider.getTransactionReceipt=lookup;await f.e.step(f.state,job,'fund',request,effect);
  assert.equal(book.cash,'100000000');assert.equal(f.counts().perplAccounts,1);
});

test('confirmed shared fills restore ownership and fees once after a crash',async()=>{
  const f=fixture(),book=f.book('a');await f.target(book,[{market:16,weightBps:5000}]);
  const job={id:'fill-crash',steps:{}};book.requests[job.id]=job;
  const request=await f.e.shared.account(book.slots[16]).executeDelta.populateTransaction('opaque',16,100n,10n,1n,Math.floor(Date.now()/1000)+120,200);
  const effect={kind:'SHARED_TRADE',bookId:book.id,address:book.slots[16],market:16,before:'100',ownedBefore:'100',delta:'10'};
  const save=f.e.save;let crash=true;
  f.e.save=s=>{if(crash&&f.state.sharedAccounts[book.slots[16]].claims.a.quantities[16]==='110')throw Error('CRASH');save(s);};
  await assert.rejects(()=>f.e.step(f.state,job,'trade',request,effect),/CRASH/);
  crash=false;const restored=f.persisted(),restoredJob=restored.books.a.requests[job.id],before=f.counts().broadcasts;
  await f.e.step(restored,restoredJob,'trade',request,effect);await f.e.step(restored,restoredJob,'trade',request,effect);
  assert.equal(f.counts().broadcasts,before);assert.equal(restored.sharedAccounts[book.slots[16]].claims.a.quantities[16],'110');assert.equal(restored.sharedAccounts[book.slots[16]].claims.a.equity,'98000000');
});

test('a v1 vault funds a reusable shared account without replacing the custody address',async()=>{
  const f=fixture({bridge:true}),a=f.book('a'),b=f.book('b',20),vault=f.state.config.vaultAddress;
  await f.target(a,[{market:16,weightBps:2500},{market:17,weightBps:2500}]);await f.target(b,[{market:16,weightBps:5000}]);
  assert.equal(f.counts().accounts,1);assert.equal(f.counts().perplAccounts,1);assert.equal(f.state.config.vaultAddress,vault);
  assert.equal(a.slots[16],a.slots[17]);assert.equal(a.slots[16],b.slots[16]);
  assert.equal(portfolio(a,'a').value,'198000000');assert.equal(portfolio(b,'b').value,'19000000');
  const other=portfolio(b,'b').value;requestWithdrawal(a,'a',a.totalUnits,'w',0);await f.e.settle(f.state,a,Math.floor(Date.now()/1000));
  assert.equal(a.withdrawals.w.status,'PAID');await f.e.observeBook(b,undefined,f.state);assert.equal(portfolio(b,'b').value,other);
});

test('v1 shared account direction conflicts do not create an account for every market',async()=>{
  const f=fixture({bridge:true}),a=f.book('a'),b=f.book('b');
  await f.target(a,[{market:16,weightBps:5000},{market:17,weightBps:2500}]);
  await f.target(b,[{market:16,weightBps:-5000},{market:17,weightBps:2500}]);
  assert.equal(f.counts().accounts,2);assert.equal(b.slots[16],b.slots[17]);assert.notEqual(a.slots[16],b.slots[16]);
});

test('open legacy positions remain untouched and flat empty accounts migrate on the next request',async()=>{
  for(const qty of [0n,5n]) {
    const f=fixture(),book=f.book('legacy');book.slots={16:'legacy-account'};
    f.e.observation=async()=>({address:'legacy-account',market:16,qty,free:0n,equity:qty?100n*unit:0n});
    const job={id:'expired',targets:[],steps:{},deadline:1};
    await assert.rejects(()=>f.e.execute(f.state,book,job),/ORDER_EXPIRED/);
    assert.equal(f.counts().broadcasts,0);assert.equal(book.investors.legacy.pending,'200000000');
    if(qty)assert.deepEqual(book.slots,{16:'legacy-account'});
    else {assert.deepEqual(book.slots,{});assert.equal(book.executionMode,'SHARED');}
  }
});

test('a strategy awaiting valuation reconciliation cannot publish old results as newly observed metrics',()=>{
  const f=fixture(),a=f.book('a'),b=f.book('b');a.valuationError='SHARED_ACCOUNT_POSITION_MISMATCH';
  f.e.investments={state:()=>f.state};
  assert.deepEqual(f.e.metrics().strategies.map(s=>s.strategyId),[b.id]);
  delete a.valuationError;assert.equal(f.e.metrics().strategies.length,2);
});
