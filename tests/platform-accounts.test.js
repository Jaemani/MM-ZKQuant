import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Interface,hexlify,randomBytes} from 'ethers';
import {hashPassword,checkPassword,normalizeUsername} from '../src/platform/password.js';
import {PrivateInvestments} from '../deploy/tee/operator/investments.mjs';
import {PlatformExecution} from '../deploy/tee/operator/execution.mjs';
import {cashBalance,assertCashTransfers} from '../deploy/tee/operator/cash-ledger.mjs';
import {activatePending,markBook} from '../deploy/tee/operator/ledger.mjs';
import {financialSnapshot,flushLedgerMark} from '../deploy/tee/operator/ledger-journal.mjs';
import {createLedgerWitness} from '../protocol/platform/ledger-witness.mjs';

const rid=()=>hexlify(randomBytes(32));
test('account credentials normalize usernames and verify salted passwords',async()=>{
  assert.equal(normalizeUsername(' Judge-Investor '),'judge-investor');
  assert.throws(()=>normalizeUsername('a b'),/INVALID_USERNAME/);
  const a=await hashPassword('a-valid-password'),b=await hashPassword('a-valid-password');assert.notEqual(a,b);
  assert.equal(await checkPassword('a-valid-password',a),true);assert.equal(await checkPassword('wrong-password',a),false);
  await assert.rejects(hashPassword('short'),/INVALID_PASSWORD/);
});
test('session-only top-up, allocation, settlement and cash withdrawal preserve private balances and ZK transitions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'veilvest-account-')),wallet=Wallet.createRandom(),other=Wallet.createRandom(),operator=Wallet.createRandom(),vault=Wallet.createRandom().address,token=Wallet.createRandom().address;
  const accounts={alice:{userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',wallet:null},bob:{userId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',wallet:other.address}},receipts={};
  const strategy={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',strategist_wallet:wallet.address,fee_bps:0,status:'FUNDING',policy:{settlementPeriodSeconds:60,withdrawalCutoffSeconds:0}},event=new Interface(['event Deposit(bytes32 indexed id,address indexed investor,uint256 amount)']);
  const investments=new PrivateInvestments({secret:randomBytes(32),storeDir:dir,provider:{getTransactionReceipt:async h=>receipts[h]?.receipt,getTransaction:async h=>receipts[h]?.tx},operator:operator.address,wallet:operator,catalogUrl:'https://test.invalid/v1/strategies'});
  investments.store.write({version:2,config:{vaultAddress:vault,cashTokenAddress:token},books:{},intents:{},usedNonces:{}});
  const priorFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    if(url.endsWith('/account-authorization')){const account=accounts[options.headers.Authorization.slice(7)];return {ok:!!account,json:async()=>account?{...account}:{error:'SESSION_EXPIRED'}};}
    if(url.endsWith('/tee-wallet-binding')){const {payload,signature}=JSON.parse(options.body);assert.ok(signature);accounts.alice.wallet=payload.wallet;return {ok:true};}
    return {ok:true,json:async()=>({strategies:[strategy]})};
  };
  const request=(action,values={},sessionToken='alice')=>investments.accountRequest({action,sessionToken,requestId:rid(),...values});
  try{
    assert.equal((await request('PORTFOLIO')).cash.available,'0');assert.equal(Object.keys(investments.state().books).length,0);
    const prepared=await request('PREPARE_TOPUP',{wallet:wallet.address,amount:'100000000'}),hash=rid(),encoded=event.encodeEventLog(event.getEvent('Deposit'),[prepared.depositId,wallet.address,100000000n]);
    receipts[hash]={receipt:{status:1,blockNumber:1,logs:[{address:vault,...encoded}]},tx:{from:wallet.address,to:vault}};
    await assert.rejects(()=>request('COMPLETE_TOPUP',{depositId:prepared.depositId,txHash:hash},'bob'),/DEPOSIT_NOT_FOUND/);
    const complete={depositId:prepared.depositId,txHash:hash};await request('COMPLETE_TOPUP',complete);await request('COMPLETE_TOPUP',complete);
    assert.equal((await request('PORTFOLIO')).cash.available,'100000000');
    const allocation={strategyId:strategy.id,amount:'70000000',requestId:rid()};await request('ALLOCATE',allocation);await request('ALLOCATE',allocation);
    await assert.rejects(()=>request('ALLOCATE',{...allocation,amount:'1'}),/REQUEST_ID_REUSED/);
    assert.equal((await request('PORTFOLIO')).cash.available,'30000000');assert.equal((await request('PORTFOLIO')).positions[0].pending,'70000000');
    const pending=await request('RETURN_PENDING',{strategyId:strategy.id,amount:'10000000'});
    const execution=Object.create(PlatformExecution.prototype);execution.investments=investments;execution.save=s=>investments.store.write(s);execution.observeBook=async book=>{markBook(book,book.cash);return [];};execution.vault=()=>{throw Error('Internal transfers must not use a Vault transaction');};
    let state=investments.state();await execution.settle(state,state.books[strategy.id],pending.settlementAt);
    assert.equal((await request('PORTFOLIO')).cash.available,'40000000');
    state=investments.state();activatePending(state.books[strategy.id]);investments.store.write(state);
    const redemption=await request('REDEEM',{strategyId:strategy.id,amount:'20000000'});
    state=investments.state();await execution.settle(state,state.books[strategy.id],redemption.settlementAt);
    let view=await request('PORTFOLIO');assert.equal(view.cash.available,'60000000');assert.equal(view.positions[0].value,'40000000');assert.equal(view.externalDeposited,'100000000');assert.equal(view.externalWithdrawn,'0');
    assert.equal(BigInt(view.cash.total)+BigInt(view.positions[0].value)+BigInt(view.positions[0].pending),100000000n);
    const withdrawal=await request('WITHDRAW_CASH',{amount:'60000000'});assert.equal((await request('PORTFOLIO')).cash.available,'0');
    await assert.rejects(()=>request('ALLOCATE',{strategyId:strategy.id,amount:'1'}),/INSUFFICIENT_PLATFORM_BALANCE/);
    await request('CANCEL_CASH_WITHDRAWAL',{depositId:withdrawal.id});assert.equal((await request('PORTFOLIO')).cash.available,'60000000');
    const cashWithdrawal=await request('WITHDRAW_CASH',{amount:'1000000'});state=investments.state();const cash=Object.values(state.books).find(b=>b.kind==='CASH_ACCOUNT');
    const effect={kind:'CASH_WITHDRAW',bookId:cash.id,withdrawalId:cashWithdrawal.id,amount:'1000000'};await execution.applyEffect(state,effect,{hash:'0xconfirmed'});await execution.applyEffect(state,effect,{hash:'0xconfirmed'});investments.store.write(state);
    view=await request('PORTFOLIO');assert.equal(view.cash.total,'59000000');assert.equal(view.externalWithdrawn,'1000000');
    assert.deepEqual((await request('PORTFOLIO',{},'bob')).positions,[]);assert.equal((await request('PORTFOLIO',{},'bob')).cash.available,'0');
    const latest=await request('REDEEM',{strategyId:strategy.id,amount:'1',percentage:100});assert.equal(latest.units,'40000000');
    await assert.rejects(()=>request('REDEEM',{strategyId:strategy.id,percentage:101}),/INVALID_REDEMPTION_PERCENTAGE/);
    const tasks=Object.values(state.books).map(book=>{flushLedgerMark(book);return {bookId:book.id,events:book.zkLedger.events};});assertCashTransfers(tasks,state.cashTransfers);
    const builder=await createLedgerWitness();for(const book of Object.values(state.books)){const mirror=builder.importBook(book.zkLedger.baseline);for(const ev of book.zkLedger.events)builder.applyEvent(mirror,ev);builder.assertMatches(financialSnapshot(book),mirror);}
    const forged=structuredClone(tasks);forged.find(t=>t.events.some(e=>e.transferId)).events.find(e=>e.transferId).amount='2';assert.throws(()=>assertCashTransfers(forged,state.cashTransfers),/RECONCILIATION/);
    const originalSerial=investments.serial;investments.serial=()=>{throw Error('Read must not queue behind execution');};
    assert.equal((await request('PORTFOLIO')).cash.available,'59000000');
    execution.authorize=async()=>strategy;assert.equal((await execution.accept({action:'STATUS'})).sequence,0);investments.serial=originalSerial;
    execution.investments=investments;assert.deepEqual(execution.metrics().strategies.map(s=>s.strategyId),[strategy.id]);
  }finally{globalThis.fetch=priorFetch;await rm(dir,{recursive:true,force:true});}
});
