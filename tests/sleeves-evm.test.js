import test from 'node:test';
import { Interface } from 'ethers';
import { SleeveExecutionApi } from '../src/sleeves/api.js';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmnibusRuntime,signCommand,localWallet } from '../src/sleeves/runtime.js';
import { money } from '../src/sleeves/ledger.js';

 test('signed independent strategies execute from one EVM vault, reconcile receipts and recover after restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'omnibus-evm-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let r=await OmnibusRuntime.local(dir);
  const a=localWallet(1),b=localWallet(2),pa=localWallet(3),pb=localWallet(4);
  const command=(wallet,type,strategy,data)=>signCommand(r,wallet,type,strategy,data);
  const submit=async(...args)=>r.submit(await command(...args));
  const view=async w=>r.view(await command(w,'VIEW',''));
  await submit(a,'ALLOCATE','btc-trend',{amount:'100000'});await submit(a,'ALLOCATE','cash-reserve',{amount:'30000'});await submit(b,'ALLOCATE','btc-hedge',{amount:'100000'});
  assert.equal((await r.view()).portfolio.length,0);
  const forged=await command(a,'REDEEM','btc-hedge',{});await assert.rejects(()=>r.submit(forged),/지분/);
  await assert.rejects(()=>submit(pa,'ORDER','btc-hedge',{side:'SHORT_OPEN',amount:'25000'}),/Wrong provider/);
  await assert.rejects(()=>submit(pa,'ORDER','btc-trend',{side:'BUY',amount:'25001'}),/capital cap/);
  const open=await command(pa,'ORDER','btc-trend',{side:'BUY',amount:'25000'});await r.submit(open);
  await assert.rejects(()=>r.submit(open),/Replayed/);
  await submit(pb,'ORDER','btc-hedge',{side:'SHORT_OPEN',amount:'25000'});
  await assert.rejects(()=>submit(a,'REDEEM','btc-trend',{}),/포지션/);
  // Third party actually trades against the AMM; no direct NAV/price edits.
  await r.chain.tx('market-buy',r.venue,'swap',[0,true,money(500000),1,await r.chain.now()+300]);
  await submit(pa,'ORDER','btc-trend',{side:'SELL'});await submit(pb,'ORDER','btc-hedge',{side:'SHORT_CLOSE'});
  const av=await view(a),bv=await view(b);
  assert.ok(BigInt(av.portfolio.find(p=>p.strategyId==='btc-trend').claim)>money(100000));
  assert.ok(BigInt(bv.portfolio[0].claim)<money(100000));
  const bClaim=bv.portfolio[0].claim;
  const redeem=await command(a,'REDEEM','btc-trend',{});
  // Crash after external send and before ledger persistence. The next process
  // resumes the same intent/hash and applies the receipt only once.
  const original=r.chain.tx;let crashed=false;
  r.chain.tx=async(...args)=>{const result=await original(...args);if(args[2]==='withdraw'&&!crashed){crashed=true;throw new Error('injected crash after send');}return result;};
  await assert.rejects(()=>r.submit(redeem),/injected crash/);
  r=await OmnibusRuntime.local(dir);
  assert.equal((await view(a)).portfolio.length,1);assert.equal((await view(a)).portfolio[0].claim,String(money(30000)));
  assert.equal((await view(b)).portfolio[0].claim,bClaim);
  await assert.rejects(()=>r.submit(redeem),/Replayed/);
  const providerBefore=(await r.chain.read(r.cash,'balanceOf',[pa.address]))[0];await submit(pa,'PAY_PROVIDER','btc-trend',{});
  assert.ok((await r.chain.read(r.cash,'balanceOf',[pa.address]))[0]>providerBefore);
  assert.equal((await r.reconcile()).balanced,true);
  const fillRows=r.state.receipts.filter(x=>x.type==='ORDER');assert.equal(fillRows.length,4);
  for(const row of fillRows){assert.ok(row.receipt.blockNumber>row.anchor.blockNumber);assert.equal(row.receipt.logs.some(x=>x.address.toLowerCase()===r.vault.address.toLowerCase()),true);}
  const stolen=await command(a,'VIEW','');stolen.payload.signer=b.address;await assert.rejects(()=>r.view(stolen),/signature/i);
  const edited=structuredClone(fillRows[0].receipt);edited.logs=[];assert.throws(()=>r.event(edited,'Fill',fillRows[0].id),/mismatch/);
 });

 test('external wallet prepared deposit survives restart and binds the exact sender, amount and nonce',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'omnibus-external-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let r=await OmnibusRuntime.local(dir);const wallet=localWallet(1);
  // RPC adapter over actual local EVM receipts; no fabricated cash balance.
  function rpcAdapter(runtime){runtime.chain.rpc={
    getTransactionReceipt:async hash=>{const row=runtime.chain.transactions.find(x=>x.transactionHash===hash);return row?{...row,hash:row.transactionHash}:null;},
    getTransaction:async hash=>{const row=runtime.chain.transactions.find(x=>x.transactionHash===hash);return row?{from:row.sender,to:runtime.vault.address,data:new Interface(runtime.vault.abi).encodeFunctionData('deposit',[money(100),prepared.id])}:null;},
    getBlock:async()=>({timestamp:await runtime.chain.now()})
  };}
  rpcAdapter(r);
  const envelope=await signCommand(r,wallet,'ALLOCATE','btc-trend',{amount:'100'}),prepared=await r.prepare(envelope);
  assert.equal(prepared.depositRequired,true);
  const other=await signCommand(r,localWallet(2),'ALLOCATE','btc-hedge',{amount:'100'});await assert.rejects(()=>r.submit(other),/Recovery pending/);
  const receipt=await r.chain.tx('external-deposit',r.vault,'deposit',[money(100),prepared.id],1);
  r=await OmnibusRuntime.local(dir);rpcAdapter(r);
  assert.equal((await r.view()).vault.balanced,false);
  await r.complete(envelope,receipt.transactionHash);
  const view=await r.view(await signCommand(r,wallet,'VIEW',''));assert.equal(view.portfolio[0].claim,String(money(100)));assert.equal(view.vault.balanced,true);
  await assert.rejects(()=>r.complete(envelope,receipt.transactionHash),/No matching/);
 });

 test('providers register independent strategies; shared-asset debt lots and multi-asset settlement stay isolated',async()=>{
  const r=await OmnibusRuntime.local(),a=localWallet(1),provider=localWallet(3);
  const submit=async(w,type,id,data={})=>r.submit(await signCommand(r,w,type,id,data));
  for(const id of ['short-one','short-two','multi-asset'])await submit(provider,'REGISTER',id,{name:id,description:'Signed provider registration'});
  await assert.rejects(()=>submit(provider,'REGISTER','short-one',{name:'duplicate',description:''}),/고유/);
  await submit(a,'ALLOCATE','short-one',{amount:'30000'});await submit(a,'ALLOCATE','short-two',{amount:'40000'});await submit(a,'ALLOCATE','multi-asset',{amount:'100000'});
  await submit(provider,'ORDER','short-one',{side:'SHORT_OPEN',asset:'BTC',amount:'6000'});
  await submit(provider,'ORDER','short-two',{side:'SHORT_OPEN',asset:'BTC',amount:'8000'});
  const other=structuredClone(r.state.ledger.strategies.find(s=>s.id==='short-two'));
  await submit(provider,'ORDER','short-one',{side:'SHORT_CLOSE',asset:'BTC'});
  assert.deepEqual(r.state.ledger.strategies.find(s=>s.id==='short-two'),other);
  await submit(a,'REDEEM','short-one');await submit(provider,'ORDER','short-two',{side:'SHORT_CLOSE',asset:'BTC'});
  await submit(provider,'ORDER','multi-asset',{side:'BUY',asset:'BTC',amount:'10000'});
  await submit(provider,'ORDER','multi-asset',{side:'BUY',asset:'ETH',amount:'10000'});
  await submit(provider,'ORDER','multi-asset',{side:'SELL',asset:'BTC'});
  await assert.rejects(()=>submit(a,'REDEEM','multi-asset'),/포지션/);
  await submit(provider,'ORDER','multi-asset',{side:'SELL',asset:'ETH'});
  await submit(a,'REDEEM','multi-asset');
  assert.equal((await r.reconcile()).balanced,true);
  const s=r.state.ledger.strategies.find(s=>s.id==='multi-asset');assert.equal(s.venueFees.length,4);assert.equal(s.history.length,1);
 });


test('screen adapter signs allocation, close and redemption without undefined fields',async()=>{
  const api=new SleeveExecutionApi();
  const post=(action,extra={})=>api.post('local-fixture',{investor:'a',strategyId:'btc-trend',action,...extra});
  await post('ALLOCATE',{amount:'10000'});await post('ORDER',{side:'BUY',amount:'2500'});await post('ORDER',{side:'SELL'});await post('REDEEM');
  assert.equal((await post('view')).portfolio.length,0);
});
