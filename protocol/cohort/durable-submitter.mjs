import assert from 'node:assert/strict';
import {keccak256,Transaction} from 'ethers';
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v);
// Signed bytes are durably persisted BEFORE sending. Never replace an ambiguous tx.
export function durableSubmitter({provider,wallet,store,chainId,gasBudget,initialNonce=0,crash=()=>{},pollMs=500,maxPolls=120}){
 let state=store.read()||{version:1,chainId:String(chainId),sender:wallet.address,nextNonce:initialNonce,spent:'0',records:{}};
 assert.equal(state.chainId,String(chainId));assert.equal(state.sender,wallet.address);
 const save=()=>store.write(state);
 async function reconcile(record){
  let receipt=await provider.getTransactionReceipt(record.hash);
  if(!receipt){
   const nonce=await provider.getTransactionCount(wallet.address,'latest');
   assert.ok(nonce<=record.nonce,'ROLLBACK_OR_UNKNOWN_TRANSACTION');
   try{await provider.broadcastTransaction(record.raw);}catch(error){
    // A duplicate/timeout is not permission to construct or send another tx.
    if(!await provider.getTransactionReceipt(record.hash)&&!await provider.getTransaction(record.hash))throw error;
   }
   await crash('broadcast');
   for(let i=0;i<maxPolls;i++){
    receipt=await provider.getTransactionReceipt(record.hash);if(receipt)break;
    await new Promise(resolve=>setTimeout(resolve,pollMs));
   }
  }
  assert.ok(receipt,'PENDING_RECONCILE_REQUIRED');
  await crash('receipt');
  record.status=receipt.status;record.block=receipt.blockNumber;record.fee=String(receipt.fee);
  state.nextNonce=record.nonce+1;state.spent=String(Object.values(state.records).reduce((a,r)=>a+BigInt(r.fee||0),0n));save();
  assert.equal(receipt.status,1,'MINED_REVERT');return record;
 }
 async function sync(){
  assert.equal((await provider.getNetwork()).chainId,BigInt(chainId));
  for(const record of Object.values(state.records))if(record.status===undefined)await reconcile(record);
  assert.equal(await provider.getTransactionCount(wallet.address,'latest'),state.nextNonce,'JOURNAL_ROLLBACK_OR_FOREIGN_TX');
 }
 async function submit(id,request){
  await sync();
  const fingerprint=json(request),prior=state.records[id];
  if(prior){assert.equal(prior.fingerprint,fingerprint,'REQUEST_ID_REUSED');assert.equal(prior.status,1,'MINED_REVERT');return prior;}
  assert.equal(await provider.getTransactionCount(wallet.address,'pending'),state.nextNonce,'UNKNOWN_PENDING_TRANSACTION');
  const estimate=await wallet.estimateGas(request),fees=await provider.getFeeData();
  const gasLimit=estimate*13n/10n,maxFeePerGas=fees.maxFeePerGas??fees.gasPrice;
  assert.ok(BigInt(state.spent)+gasLimit*maxFeePerGas<=gasBudget,'TEE_GAS_BUDGET');
  const raw=await wallet.signTransaction({...request,chainId,nonce:state.nextNonce,gasLimit,maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n,type:2});
  const decoded=Transaction.from(raw);assert.equal(decoded.from,wallet.address);
  const record={hash:keccak256(raw),raw,nonce:state.nextNonce,fingerprint};state.records[id]=record;save();await crash('signed');
  return reconcile(record);
 }
 return{sync,submit,lookup:id=>state.records[id],publicState:()=>({nextNonce:state.nextNonce,spent:state.spent,records:Object.fromEntries(Object.entries(state.records).map(([id,r])=>[id,{hash:r.hash,status:r.status,block:r.block}]))})};
}
