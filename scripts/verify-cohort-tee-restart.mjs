// Reconnect after an operator VM restart; repeat the same signed intent, never a new trade.
import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
import{JsonRpcProvider,Contract,Wallet}from'ethers';
import{intentDomain,intentTypes}from'../deploy/tee/operator/engine.mjs';import{connectCohortHardware}from'../protocol/cohort/hardware-client.mjs';
const old=JSON.parse(readFileSync('docs/evidence/cohort-public.json')),state=JSON.parse(readFileSync('.data/cohort-public/session.json'));
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
const result={observedAt:new Date().toISOString(),status:'RUNNING'};
try{
 const remote=await connectCohortHardware();assert.notEqual(remote.evidence.challenge,old.hardware.challenge);
 assert.equal(remote.identity.operator,old.operator);assert.deepEqual(remote.identity.managerKeys,old.hardware.identity.managerKeys);
 const before=await rpc.getTransactionCount(old.operator);
 await remote.call('/initialize',{wasm:readFileSync('artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm').toString('base64'),zkey:readFileSync('artifacts/perpl-zk/perpl-target-mvp.zkey').toString('base64')});
 await remote.call('/configure',{vault:old.vault});
 const response=await remote.call('/execute',state.intents.open);assert.equal(response.replayed,true);assert.equal(response.hash,old.execution.open.hash);
 const owner=new Wallet(JSON.parse(readFileSync('.data/testnet-pilot/wallet.json')).privateKey);
 const account=new Contract(old.account,['function nonce() view returns(uint256)'],rpc);
 const now=(await rpc.getBlock('latest')).timestamp;
 const baseline={target:'0',seq:String(await account.nonce()),deadline:String(now+500),epoch:'1'};
 const checks=[];
 for(const [name,change,signer,pattern]of [
  ['wrong-manager',{},Wallet.createRandom(),/MANAGER_SIGNATURE/],
  ['revoked-epoch',{epoch:'0'},owner,/REVOKED_EPOCH/],
  ['expired-intent',{deadline:String(now-1)},owner,/INTENT_DEADLINE/],
  ['over-cap',{target:'101'},owner,/TARGET_CAP/],
  ['terminal-phase',{},owner,/PHASE/]]){
  const intent={...baseline,...change},signature=await signer.signTypedData(intentDomain(10143,old.vault),intentTypes,intent);
  await assert.rejects(()=>remote.call('/execute',{intent,signature}),pattern);checks.push(name);
 }
 result.rejectedHardwareRequests=checks;
 const after=await rpc.getTransactionCount(old.operator);assert.equal(after,before);
 result.status='PASS_HARDWARE_RESTART_SAME_KEYS_AND_NO_DUPLICATE_TX';result.operator=old.operator;result.nonceBefore=before;result.nonceAfter=after;result.replayedTransaction=response.hash;result.attestation=remote.evidence;
}catch(e){result.status='FAIL';result.error=e.message;process.exitCode=1;}
finally{writeFileSync('docs/evidence/cohort-tee-restart.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,error:result.error}));rpc.destroy();}
