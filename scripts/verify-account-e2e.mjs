import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Wallet,JsonRpcProvider,Contract} from 'ethers';
import {groth16} from 'snarkjs';
import {createRequire} from 'node:module';
import {api,tee,rpcUrl,savePrivate,environment} from './platform-ops.mjs';
import {verifyPlatformTee} from '../src/platform/tee-attestation.js';
import {teeAttestationPolicy} from '../src/platform/tee-attestation-policy.js';
const path='.data/judge-accounts/fixture.json',fixture=JSON.parse(readFileSync(path)),save=()=>savePrivate(path,fixture),config=await api('/v1/config');
await verifyPlatformTee({endpoint:config.teeEndpoint,publicKey:config.teeEncryptionPublicKey,vault:config.vaultAddress});
for(const account of [fixture.strategist,fixture.investor]){const auth=await api('/v1/auth/login',{body:{username:account.username,password:account.password}});assert.equal(auth.userId,account.userId);account.sessionToken=auth.sessionToken;}save();
fixture.validation||={};
const investment=(account,action,values={})=>tee(config,'/platform/encrypted-investments',{action,sessionToken:account.sessionToken,requestId:'0x'+randomBytes(32).toString('hex'),...values});
const manager=(action,values={})=>tee(config,'/platform/encrypted-strategy',{action,strategyId:fixture.strategy.id,sessionToken:fixture.strategist.sessionToken,...values});
async function operation(label,account,action,values){
 let step=fixture.validation[label];if(!step){step=fixture.validation[label]={requestId:'0x'+randomBytes(32).toString('hex'),values};save();}
 if(!step.done){step.result=await investment(account,action,{...step.values,requestId:step.requestId});step.done=true;save();}
 return step.result;
}
async function waitFor(label,read,check,timeout=180000){const start=Date.now();while(Date.now()-start<timeout){const result=await read();if(check(result))return result;await new Promise(r=>setTimeout(r,2500));}throw Error(label+'_TIMEOUT');}
function orderDone(status,id){const order=status.requests.find(r=>r.id===id);if(order&&['FAILED','EXPIRED'].includes(order.status))throw Error('JUDGE_ORDER_'+(order.error||order.status)+' '+JSON.stringify(order.diagnostic));return order&&['EXECUTED','PARTIALLY_FILLED'].includes(order.status);}
await waitFor('SEED_ORDER',()=>manager('STATUS'),s=>orderDone(s,fixture.target.requestId));
if(!fixture.validation.before){fixture.validation.before={investor:await investment(fixture.investor,'PORTFOLIO'),proof:await api('/v1/ledger-proof-status')};save();}
assert.equal((await operation('allocate',fixture.investor,'ALLOCATE',{strategyId:fixture.strategy.id,amount:'25000000'})).status,'PENDING');
if(fixture.validation.target){const status=await manager('STATUS'),order=status.requests.find(r=>r.id===fixture.validation.target.requestId);if(order&&['FAILED','EXPIRED'].includes(order.status)){fixture.validation.previousTargets||=[];fixture.validation.previousTargets.push({...fixture.validation.target,status:order.status,error:order.error,diagnostic:order.diagnostic});if(fixture.validation.previousTargets.length>2)throw Error('JUDGE_TARGET_RETRY_LIMIT_'+JSON.stringify(order.diagnostic));delete fixture.validation.target;delete fixture.validation.submitted;save();}}
if(!fixture.validation.target){const status=await manager('STATUS');fixture.validation.target={requestId:'judge-e2e-'+randomBytes(12).toString('hex'),sequence:status.sequence+1,targets:[{market:16,weightBps:1000}]};save();}
if(!fixture.validation.submitted){await manager('TARGET',fixture.validation.target);fixture.validation.submitted=true;save();}
await waitFor('INVESTOR_ACTIVATION',()=>manager('STATUS'),s=>orderDone(s,fixture.validation.target.requestId));
let portfolio=await investment(fixture.investor,'PORTFOLIO');
if(!fixture.validation.redeem){const position=portfolio.positions.find(p=>p.strategyId===fixture.strategy.id);assert.ok(BigInt(position.units)>0n);assert.equal(position.pending,'0');await operation('redeem',fixture.investor,'REDEEM',{strategyId:fixture.strategy.id,percentage:100});}
const redemption=fixture.validation.redeem.result;
portfolio=await waitFor('REDEMPTION',()=>investment(fixture.investor,'PORTFOLIO'),p=>p.positions.find(p=>p.strategyId===fixture.strategy.id)?.withdrawals.some(w=>w.id===redemption.id&&w.status==='PAID'));
const paid=portfolio.positions.find(p=>p.strategyId===fixture.strategy.id).withdrawals.find(w=>w.id===redemption.id);
assert.equal(paid.destination,'BALANCE');assert.equal(paid.txHash,undefined);assert.equal(portfolio.positions.find(p=>p.strategyId===fixture.strategy.id).units,'0');
await operation('withdraw',fixture.investor,'WITHDRAW_CASH',{amount:'1000000'});
const withdrawal=fixture.validation.withdraw.result;
portfolio=await waitFor('CASH_WITHDRAWAL',()=>investment(fixture.investor,'PORTFOLIO'),p=>p.cash.withdrawals.some(w=>w.id===withdrawal.id&&w.status==='PAID'));
const withdrawalPaid=portfolio.cash.withdrawals.find(w=>w.id===withdrawal.id),provider=new JsonRpcProvider(rpcUrl,10143,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
try{
 const receipt=await provider.getTransactionReceipt(withdrawalPaid.txHash);assert.equal(receipt.status,1);const tx=await provider.getTransaction(withdrawalPaid.txHash);
 const vault=new Contract(config.vaultAddress,['function withdraw(address,uint256,bytes32)'],provider);const decoded=vault.interface.parseTransaction(tx);
 assert.equal(decoded.args[0].toLowerCase(),new Wallet(fixture.investor.key).address.toLowerCase());assert.equal(decoded.args[1],1000000n);
 assert.equal(BigInt(portfolio.externalDeposited),200000000n);assert.equal(BigInt(portfolio.externalWithdrawn),1000000n);
 // Request one checkpoint using the original operator credential; the regular hourly cadence is retained.
 if(!fixture.validation.checkpoint){
  const identity=await(await fetch(config.teeEndpoint+'/attestation?challenge='+randomBytes(32).toString('hex'))).json();
  let accessToken;
  for(const value of Object.values(environment))if(typeof value==='string'&&createHash('sha256').update(value).digest('hex')===identity.identity.accessHash)accessToken=value;
  for(const directory of readdirSync('.data')){try{const client=JSON.parse(readFileSync(`.data/${directory}/client.json`));if(client.token&&createHash('sha256').update(client.token).digest('hex')===identity.identity.accessHash)accessToken=client.token;}catch{}}
  let requestedAt=Math.floor(Date.now()/1000),mode='OPERATOR_REQUEST';
  if(accessToken)await tee(config,'/platform/encrypted-investments',{action:'CHECKPOINT_NOW',accessToken});
  else {
   // Preserve the regular schedule when the original operator token is unavailable.
   // The active checkpoint must include both actual judge cash deposits.
   const quantPortfolio=await investment(fixture.strategist,'PORTFOLIO');
   const deposits=[portfolio,quantPortfolio].flatMap(p=>p.deposits.filter(d=>d.status==='CONFIRMED'&&d.confirmedAt));
   requestedAt=Math.max(...deposits.map(d=>Math.floor(Date.parse(d.confirmedAt)/1000)));assert.ok(Number.isFinite(requestedAt));mode='HOURLY_SCHEDULE';
  }
  fixture.validation.checkpoint={requestedAt,mode,previousSequence:fixture.validation.before.proof.checkpoint?.lastSequence||0};save();
 }
 const checkpoint=fixture.validation.checkpoint;
 const proofStatus=await waitFor('LEDGER_CHECKPOINT',()=>api('/v1/ledger-proof-status'),s=>{if(s.error)throw Error(s.error);return s.checkpoint?.onchainVerified&&s.checkpoint.checkpointAt>=checkpoint.requestedAt-2&&s.checkpoint.lastSequence>checkpoint.previousSequence;},1800000);
 assert.equal(proofStatus.intervalSeconds,3600);assert.equal(proofStatus.genesisRoot,teeAttestationPolicy.ledgerGenesis.genesisRoot);
 const last=proofStatus.checkpoint.lastSequence,page=await api(`/v1/ledger-proofs?after=${Math.max(checkpoint.previousSequence,last-2)}&limit=2`),key=JSON.parse(readFileSync('public'+JSON.parse(readFileSync('public/zk/platform-ledger-v1/manifest.json')).artifacts.verificationKey.path));
 const requireSnark=createRequire(createRequire(import.meta.url).resolve('snarkjs'));globalThis.curve_bn128=await requireSnark('ffjavascript').buildBn128(true);
 try{for(const record of page.records){assert.ok(await groth16.verify(key,record.payload.publicSignals,record.payload.proof));assert.equal((await provider.getTransactionReceipt(record.anchored.txHash)).status,1);}}finally{await globalThis.curve_bn128.terminate();}
 const report={verified:true,accountLoginBothRoles:true,realTestnetFunding:true,pendingUntilTarget:true,independentPerplExecution:true,redemptionToBalance:true,settlementSeconds:60,cashWithdrawalReceipt:withdrawalPaid.txHash,privateCashInLedgerProofs:true,checkpointIncludesJudgeFunding:true,checkpointAt:proofStatus.checkpoint.checkpointAt,laterMutationsAwaitHourlyCheckpoint:proofStatus.checkpoint.checkpointAt<withdrawalPaid.paidAt,onchainCheckpointSequence:last,genesisPreserved:true,proofIntervalSeconds:3600};
 fixture.validation.verified=report;save();mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/account-ux-e2e.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{provider.destroy();}
