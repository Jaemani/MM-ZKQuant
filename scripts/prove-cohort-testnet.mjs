import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Wallet,JsonRpcProvider,Contract,ContractFactory,parseEther,formatEther} from 'ethers';
import {poseidonContract} from 'circomlibjs';import {curves} from 'snarkjs';import solc from 'solc';
import {SealedStore} from '../src/integration/sealed.js';
import {durableSubmitter} from '../protocol/cohort/durable-submitter.mjs';
import {createLedgerProver} from '../protocol/cohort/ledger-prover.mjs';
import {connectCohortHardware} from '../protocol/cohort/hardware-client.mjs';
import {intentTypes,intentDomain} from '../deploy/tee/operator/engine.mjs';
assert.ok(process.argv.includes('--execute'),'Explicit --execute required');
const dir='.data/cohort-public';mkdirSync(dir,{recursive:true,mode:0o700});
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2),save=(p,v)=>{writeFileSync(p+'.tmp',json(v)+'\n',{mode:0o600,flush:true});renameSync(p+'.tmp',p);};
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
const owner=new Wallet(JSON.parse(readFileSync('.data/testnet-pilot/wallet.json')).privateKey,rpc);
let state=existsSync(dir+'/session.json')?JSON.parse(readFileSync(dir+'/session.json')):null;
const report={createdAt:new Date().toISOString(),environment:'PUBLIC_MONAD_TESTNET',hardwareTEE:true,chainId:10143,status:'RUNNING',transactions:[],checks:[],limitations:['Single terminal two-investor cohort; no mid-cycle subscriptions or rolling HWM','Public dedicated account; no shared-slot privacy or PRIVATE_ONLY endpoint','Manager signs synthetic intent outside TEE; TEE applies policy, proves and submits','Local single-party Groth16 setup; no production security audit']};
try{
 assert.equal((await rpc.getNetwork()).chainId,10143n);assert.equal(owner.address,'0xA761529aE65a0966125C47911DEDCC7F23951D57');
 const sources=Object.fromEntries(['PerplMvpAccount.sol','PerplZkMvpAccount.sol','PerplCohortVault.sol'].map(n=>[n,{content:readFileSync('contracts/perpl/'+n,'utf8')}]));
 for(const [name,path]of [['TargetVerifier.sol','artifacts/perpl-zk/TargetVerifier.sol'],['LedgerVerifier.sol','artifacts/cohort-zk/LedgerVerifier.sol']])sources[name]={content:readFileSync(path,'utf8')};
 const sourceHash=createHash('sha256').update(json(sources)).digest('hex');
 const compiled=JSON.parse(solc.compile(json({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 assert.equal(compiled.errors?.filter(e=>e.severity==='error').length||0,0,json(compiled.errors));
 if(!state){state={sourceHash,ownerInitialNonce:await rpc.getTransactionCount(owner.address),investorKey:Wallet.createRandom().privateKey,startedAt:new Date().toISOString(),steps:{},intents:{}};save(dir+'/session.json',state);}
 assert.equal(sourceHash,state.sourceHash,'Source changed during session');const persist=()=>save(dir+'/session.json',state);
 const investor=new Wallet(state.investorKey,rpc);
 const journals=[owner,investor].map((wallet,i)=>durableSubmitter({provider:rpc,wallet,store:new SealedStore(dir+'/journal-'+i+'.json',Buffer.from(wallet.privateKey.slice(2),'hex'),'cohort-public-'+i),chainId:10143,initialNonce:i?0:state.ownerInitialNonce,gasBudget:parseEther('10')}));
 const step=async(name,prepare,i=0)=>{const j=journals[i];await j.sync();let entry=j.lookup(name);
  if(!entry)entry=await j.submit(name,await prepare());assert.equal(entry.status,1);
  const r=await rpc.getTransactionReceipt(entry.hash);assert.equal(r.status,1);state.steps[name]={hash:r.hash,status:r.status,block:r.blockNumber,fee:String(r.fee),contractAddress:r.contractAddress};persist();console.log(name+' '+r.hash);return r;};
 const exchange='0x1964C32f0bE608E7D29302AFF5E61268E72080cc',tokenAddress='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
 const cash=new Contract(tokenAddress,['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],owner);
 const remote=state.complete?{identity:state.hardware.identity,evidence:state.hardware}:await connectCohortHardware();
 state.hardware=remote.evidence;persist();report.hardware=state.hardware;report.startedAt=state.startedAt;
 const trackedSenders=[owner.address,investor.address,remote.identity.operator],beforeNonces=await Promise.all(trackedSenders.map(a=>rpc.getTransactionCount(a)));
 if(!state.complete){await remote.call('/initialize',{wasm:readFileSync('artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm').toString('base64'),zkey:readFileSync('artifacts/perpl-zk/perpl-target-mvp.zkey').toString('base64')});}
 const deploy=async(file,name,label,args=[])=>{const c=compiled.contracts[file][name],r=await step(label,()=>new ContractFactory(c.abi,c.evm.bytecode.object,owner).getDeployTransaction(...args));return new Contract(r.contractAddress,c.abi,owner);};
 const tv=await deploy('TargetVerifier.sol','Groth16Verifier','deploy-target-verifier'),lv=await deploy('LedgerVerifier.sol','Groth16Verifier','deploy-ledger-verifier');
 const ph=await step('deploy-poseidon',()=>new ContractFactory(poseidonContract.generateABI(6),poseidonContract.createCode(6),owner).getDeployTransaction());
 const vault=await deploy('PerplCohortVault.sol','PerplCohortVault','deploy-vault',[exchange,tokenAddress,owner.address,remote.identity.operator,[owner.address,investor.address],owner.address,2000,await tv.getAddress(),await lv.getAddress(),ph.contractAddress,remote.identity.managerKeys[0]]);
 const address=await vault.getAddress(),account=new Contract(await vault.account(),compiled.contracts['PerplCohortVault.sol'].PerplCohortAccount.abi,rpc);
 if(!state.complete)await remote.call('/configure',{vault:address});
 await step('fund-tee-gas',async()=>({to:remote.identity.operator,value:parseEther('1')}));
 await step('fund-investor-gas',async()=>({to:investor.address,value:parseEther('0.3')}));
 await step('fund-investor-token',()=>cash.transfer.populateTransaction(investor.address,140000000n));
 await step('approve-0',()=>cash.approve.populateTransaction(address,60000000n));await step('subscribe-0',()=>vault.subscribe.populateTransaction(0,60000000n));
 await step('approve-1',()=>cash.connect(investor).approve.populateTransaction(address,140000000n),1);await step('subscribe-1',()=>vault.connect(investor).subscribe.populateTransaction(1,140000000n),1);
 await step('activate',()=>vault.activate.populateTransaction());
 const trade=async(name,target)=>{
  if(state.intents[name]?.result)return state.intents[name].result;
  if(!state.intents[name]){
   const intent={target:String(target),seq:String(await account.nonce()),deadline:String(BigInt((await rpc.getBlock('latest')).timestamp)+600n),epoch:String(await vault.keyEpoch())};
   state.intents[name]={intent,signature:await owner.signTypedData(intentDomain(10143,address),intentTypes,intent)};persist();
  }
  const response=await remote.call('/execute',state.intents[name]);assert.equal(response.status,1);
  state.intents[name].result=response;persist();console.log(name+' '+response.hash);return response;
 };
 const opened=await trade('open',100n);const openedReceipt=await rpc.getTransactionReceipt(opened.hash);
 const beforeClose=(await account.position({blockTag:openedReceipt.blockNumber}))[0];assert.ok(beforeClose>0n,'Public IOC did not fill');report.actualOpen=String(beforeClose);
 if(!state.complete){const replay=await remote.call('/execute',state.intents.open);assert.equal(replay.hash,opened.hash);assert.equal(replay.replayed,true);report.checks.push('tee-intent-replay-no-new-transaction');}
 await step('withdrawal-request',()=>vault.connect(investor).requestWithdrawal.populateTransaction(1),1);
 await step('rotate-key',()=>vault.rotateKey.populateTransaction(remote.identity.managerKeys[1]));
 await step('pause',()=>vault.setPaused.populateTransaction(true));
 let closes=Object.keys(state.intents).filter(k=>k.startsWith('close-')).length;
 for(let i=closes;i<closes+3;i++){if((await account.position())[0]===0n)break;await trade('close-'+i,0n);}
 assert.equal((await account.position())[0],0n,'Resume same session to complete close');
 await step('recover',()=>vault.recover.populateTransaction());
 const ledger=await createLedgerProver();
 if(!state.ledger){const input=ledger.input({chainId:10143n,vault:address,venueNonce:await account.nonce(),deposits:[60000000n,140000000n],recovered:await vault.recoveredAssets(),feeBps:2000n});state.ledger={input,proof:await ledger.prove(input)};persist();}
 const {input,proof}=state.ledger,p=input.pub.map(BigInt);
 await step('ledger-settle',()=>vault.settle.populateTransaction(p[3],p[9],p[10],p[11],proof.encodedProof));
 await step('claim-0',()=>vault.claim.populateTransaction(0));await step('claim-1',()=>vault.connect(investor).claim.populateTransaction(1),1);
 if(p[11]>0n)await step('claim-fee',()=>vault.claimFee.populateTransaction());
 assert.equal(await vault.totalShares(),0n);assert.equal(await cash.balanceOf(address),0n);
 for(const i of [0,1])assert.equal(await vault.claims(i),0n);assert.equal(await vault.feeClaim(),0n);
 report.vault=address;report.account=await account.getAddress();report.owner=owner.address;report.investor=investor.address;report.operator=remote.identity.operator;report.sourceHash=sourceHash;
 report.ledger={proof:proof.proof,publicSignals:proof.publicSignals,verificationKey:JSON.parse(readFileSync('artifacts/cohort-zk/verification-key.json'))};
 report.targetVerificationKey=JSON.parse(readFileSync('artifacts/perpl-zk/verification-key.json'));report.execution=Object.fromEntries(Object.entries(state.intents).map(([k,v])=>[k,v.result]));
 report.settlement={recovered:String(await vault.recoveredAssets()),claims:[String(p[9]),String(p[10])],fee:String(p[11]),totalShares:'0',phase:String(await vault.phase())};
 for(const [name,t]of Object.entries(state.steps))report.transactions.push({name,...t});
 for(const [name,v]of Object.entries(state.intents)){const r=await rpc.getTransactionReceipt(v.result.hash);assert.equal(r.status,1);report.transactions.push({name,hash:r.hash,status:r.status,block:r.blockNumber,fee:String(r.fee),from:r.from});}
 report.gasMON=formatEther(report.transactions.reduce((a,t)=>a+BigInt(t.fee),0n));report.checks.push('hardware-key-and-public-sender-bound','actual-nonzero-fill-and-flat-close','ledger-proof-accepted-against-contract-recovery','shares-burned-and-all-claims-paid');
 report.senderNoncesBefore=beforeNonces;report.senderNoncesAfter=await Promise.all(trackedSenders.map(a=>rpc.getTransactionCount(a)));report.additionalTransactionsThisRun=report.senderNoncesAfter.reduce((sum,n,i)=>sum+n-beforeNonces[i],0);
 state.complete=true;persist();report.status='PASS_PUBLIC_TEE_COHORT_LEDGER_REDEMPTION';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;process.exitCode=1;}
finally{save(dir+'/latest.json',report);if(report.status.startsWith('PASS'))save('docs/evidence/cohort-public.json',report);console.log(json({status:report.status,error:report.error,checks:report.checks}));rpc.destroy();await(await curves.getCurveFromName('bn128')).terminate();}
