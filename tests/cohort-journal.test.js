import test from 'node:test';import assert from 'node:assert/strict';
import {Wallet,Transaction} from 'ethers';import {durableSubmitter} from '../protocol/cohort/durable-submitter.mjs';
function fixture(){
 const signer=Wallet.createRandom();let nonce=0,snapshot=null,broadcasts=0;const receipts=new Map();
 const wallet={address:signer.address,estimateGas:async()=>21000n,signTransaction:tx=>signer.signTransaction(tx)};
 const provider={getNetwork:async()=>({chainId:31337n}),getTransactionCount:async()=>nonce,
  getTransactionReceipt:async hash=>receipts.get(hash),getTransaction:async hash=>receipts.get(hash),
  getFeeData:async()=>({maxFeePerGas:1n,maxPriorityFeePerGas:0n}),broadcastTransaction:async raw=>{
   const tx=Transaction.from(raw);if(receipts.has(tx.hash))return {hash:tx.hash};assert.equal(tx.nonce,nonce);nonce++;broadcasts++;
   receipts.set(tx.hash,{hash:tx.hash,status:1,blockNumber:nonce,fee:21000n});return{hash:tx.hash};
  }};
 const store={read:()=>structuredClone(snapshot),write:s=>{snapshot=structuredClone(s);}};
 return{wallet,provider,store,chainId:31337,gasBudget:1000000n,pollMs:0,maxPolls:1,
  get saved(){return structuredClone(snapshot)},set saved(s){snapshot=s},get broadcasts(){return broadcasts},get nonce(){return nonce}};
}
for(const point of ['signed','broadcast','receipt'])test('durable journal resumes crash after '+point+' without duplicate tx',async()=>{
 const f=fixture(),request={to:Wallet.createRandom().address,value:1n};
 const a=durableSubmitter({...f,crash:p=>{if(p===point)throw Error('CRASH');}});
 await assert.rejects(a.submit('intent',request),/CRASH/);
 const b=durableSubmitter(f);const result=await b.submit('intent',request);assert.equal(result.status,1);assert.equal(f.broadcasts,1);assert.equal(f.nonce,1);
 await b.submit('intent',request);assert.equal(f.broadcasts,1);
 await assert.rejects(b.submit('intent',{...request,value:2n}),/REQUEST_ID_REUSED/);
});
test('journal rollback and lost state fail closed against chain nonce',async()=>{
 const f=fixture(),a=durableSubmitter(f),request={to:Wallet.createRandom().address,value:1n};
 await a.submit('one',request);const old=f.saved;await a.submit('two',request);
 f.saved=old;await assert.rejects(durableSubmitter(f).sync(),/JOURNAL_ROLLBACK/);
 f.saved=null;await assert.rejects(durableSubmitter(f).sync(),/JOURNAL_ROLLBACK/);
});
test('lost broadcast response reconciles the same tx',async()=>{
 const f=fixture(),broadcast=f.provider.broadcastTransaction;
 f.provider.broadcastTransaction=async raw=>{await broadcast(raw);throw Error('TIMEOUT');};
 const s=durableSubmitter(f);await s.submit('one',{to:Wallet.createRandom().address,value:1n});assert.equal(f.broadcasts,1);
});
