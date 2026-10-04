import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {JsonRpcProvider,Contract,ContractFactory,parseEther} from 'ethers';
import {poseidonContract} from 'circomlibjs';
import solc from 'solc';import {curves,wtns} from 'snarkjs';
import {createOperator,operatorKeys,intentDomain,intentTypes} from '../deploy/tee/operator/engine.mjs';
import {createTargetProver} from '../protocol/perpl/target-prover.mjs';
import {createLedgerProver} from '../protocol/cohort/ledger-prover.mjs';
const rpc=new JsonRpcProvider(process.env.MM_PERPL_FORK_RPC,undefined,{batchMaxCount:1,cacheTimeout:-1});
const report={createdAt:new Date().toISOString(),environment:'LOCAL_PERPL_FORK',hardwareTEE:false,checks:[],transactions:[],status:'RUNNING',limitations:['Single terminal cohort, two investors, public dedicated account','Local single-party setup','Local prover and impersonated collateral; hardware/public follow-up separate']};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2);
try{
 assert.equal((await rpc.getNetwork()).chainId,31337n);await rpc.send('anvil_setBlockTimestampInterval',[0]);
 const [owner,investor]=await Promise.all([0,1].map(i=>rpc.getSigner(i)));
 const withOperator=process.argv.includes('--operator'),secret=randomBytes(32),derived=await operatorKeys(secret);
 const operator=withOperator?derived.wallet.connect(rpc):await rpc.getSigner(2);
 if(withOperator)await(await owner.sendTransaction({to:operator.address,value:parseEther('2')})).wait();
 const exchange='0x1964C32f0bE608E7D29302AFF5E61268E72080cc',tokenAddress='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
 const cash=new Contract(tokenAddress,['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],owner);
 await rpc.send('anvil_impersonateAccount',[exchange]);await rpc.send('anvil_setBalance',[exchange,'0x'+parseEther('1').toString(16)]);
 for(const who of [owner,investor])await(await cash.connect(await rpc.getSigner(exchange)).transfer(who.address,200000000n)).wait();await rpc.send('anvil_stopImpersonatingAccount',[exchange]);
 const sources=Object.fromEntries(['PerplMvpAccount.sol','PerplZkMvpAccount.sol','PerplCohortVault.sol'].map(n=>[n,{content:readFileSync('contracts/perpl/'+n,'utf8')}]));
 sources['TargetVerifier.sol']={content:readFileSync('artifacts/perpl-zk/TargetVerifier.sol','utf8')};sources['LedgerVerifier.sol']={content:readFileSync('artifacts/cohort-zk/LedgerVerifier.sol','utf8')};
 const compiled=JSON.parse(solc.compile(json({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 assert.equal(compiled.errors?.filter(e=>e.severity==='error').length||0,0,json(compiled.errors));
 const tx=async(name,promise)=>{const r=await(await promise).wait();assert.equal(r.status,1);report.transactions.push({name,hash:r.hash,status:r.status,block:r.blockNumber});return r;};
 const deploy=async(file,name,args=[])=>{const c=compiled.contracts[file][name],v=await new ContractFactory(c.abi,c.evm.bytecode.object,owner).deploy(...args);await v.waitForDeployment();return v;};
 const tv=await deploy('TargetVerifier.sol','Groth16Verifier'),lv=await deploy('LedgerVerifier.sol','Groth16Verifier');
 const ph=await new ContractFactory(poseidonContract.generateABI(6),poseidonContract.createCode(6),owner).deploy();await ph.waitForDeployment();
 const target=await createTargetProver(),ledger=await createLedgerProver();let key=withOperator?derived.key(0):randomBytes(32);
 const vault=await deploy('PerplCohortVault.sol','PerplCohortVault',[exchange,tokenAddress,owner.address,operator.address,[owner.address,investor.address],owner.address,2000,await tv.getAddress(),await lv.getAddress(),await ph.getAddress(),target.publicKey(key)]);
 const address=await vault.getAddress(),account=new Contract(await vault.account(),compiled.contracts['PerplCohortVault.sol'].PerplCohortAccount.abi,operator);
 let engine;const engineArgs={secret,provider:rpc,controller:owner.address,chainId:31337,storeDir:'.data/cohort/operator-'+Date.now()};
 if(withOperator){engine=await createOperator({...engineArgs,crash:p=>{if(p==='broadcast')throw Error('SIMULATED_PROCESS_LOSS');}});await engine.configure(address);}
 const signedIntent=async target=>{const intent={target:String(target),seq:String(await account.nonce()),deadline:String(BigInt((await rpc.getBlock('latest')).timestamp)+600n),epoch:String(await vault.keyEpoch())};return{intent,signature:await owner.signTypedData(intentDomain(31337,address),intentTypes,intent)};};
 const reject=async(name,fn)=>{await assert.rejects(fn);report.checks.push(name);};
 await tx('approve-0',cash.approve(address,60000000n));await tx('subscribe-0',vault.subscribe(0,60000000n));
 await tx('approve-1',cash.connect(investor).approve(address,140000000n));await tx('subscribe-1',vault.connect(investor).subscribe(1,140000000n));
 assert.equal(await vault.totalShares(),200000000n);report.checks.push('shares-issued-at-subscription-nav-one');
 await tx('activate',vault.activate());
 await reject('subscriptions-closed-during-trading',()=>vault.subscribe.staticCall(0,1));
 const proofFor=async(q,k=key)=>{const [position,mark]=await account.position(),seq=await account.nonce(),deadline=BigInt((await rpc.getBlock('latest')).timestamp)+600n,price=q>position?mark*10050n/10000n:mark*9950n/10000n;
  const proof=await target.prove(target.input({chainId:31337n,account:await account.getAddress(),market:16n,nonce:seq,target:q,position,limitPrice:price,deadline,maxLots:100n},k));return {args:[q,price,seq,deadline,proof.encodedProof],proof};};
 const open=await proofFor(100n);await reject('direct-account-bypass-rejected',()=>account.execute.staticCall(...open.args));
 await reject('unauthorized-relayer-rejected',()=>vault.execute.staticCall(...open.args));
 if(withOperator){
  const {intent,signature}=await signedIntent(100n);
  await reject('process-loss-after-actual-broadcast',()=>engine.execute(intent,signature));
  engine=await createOperator(engineArgs);await engine.configure(address);
  const retry=await engine.execute(intent,signature);assert.equal(retry.replayed,true);
  const r=await rpc.getTransactionReceipt(retry.hash);assert.equal(r.status,1);report.transactions.push({name:'open',hash:r.hash,status:r.status,block:r.blockNumber});
  assert.equal(await account.nonce(),1n);report.checks.push('engine-restart-reconciles-real-receipt-without-duplicate-order');
  const bad=await signedIntent(101n);await reject('operator-policy-cap',()=>engine.execute(bad.intent,bad.signature));
 }else await tx('open',vault.connect(operator).execute(...open.args));assert.notEqual((await account.position())[0],0n);
 await reject('settlement-before-recovery-rejected',()=>vault.settle.staticCall(0,0,0,0,'0x'));
 await tx('request-withdrawal',vault.connect(investor).requestWithdrawal(1));assert.equal(await vault.phase(),2n);
 await reject('recovery-while-position-open-rejected',()=>vault.recover.staticCall());
 const oldClose=await proofFor(0n);const oldIntent=withOperator?await signedIntent(0n):null;const nextKey=withOperator?derived.key(1):randomBytes(32);await tx('rotate',vault.rotateKey(target.publicKey(nextKey)));key=nextKey;
 await reject('revoked-proof-key-rejected',()=>vault.connect(operator).execute.staticCall(...oldClose.args));
 await tx('pause',vault.setPaused(true));const close=await proofFor(0n);
 if(withOperator){
  await reject('operator-revoked-epoch',()=>engine.execute(oldIntent.intent,oldIntent.signature));
  const signed=await signedIntent(0n),r=await engine.execute(signed.intent,signed.signature);assert.equal(r.status,1);
  const receipt=await rpc.getTransactionReceipt(r.hash);report.transactions.push({name:'close-while-paused',hash:r.hash,status:receipt.status,block:receipt.blockNumber});
 }else await tx('close-while-paused',vault.connect(operator).execute(...close.args));assert.equal((await account.position())[0],0n);
 if(process.argv.includes('--profit-fixture')){
  // Explicit local fixture: additional venue collateral models a profitable terminal balance.
  await tx('fixture-cash',cash.transfer(address,20000000n));await rpc.send('anvil_impersonateAccount',[address]);await rpc.send('anvil_setBalance',[address,'0x'+parseEther('1').toString(16)]);
  const asVault=await rpc.getSigner(address);await tx('fixture-approve',cash.connect(asVault).approve(await account.getAddress(),20000000n));await tx('fixture-venue-credit',account.connect(asVault).fund(20000000n));await rpc.send('anvil_stopImpersonatingAccount',[address]);
  report.limitations.push('Positive P&L fixture adds 20 test AUSD by local impersonation; not a real profitable strategy');
 }
 await tx('recover',vault.recover());
 const witness=ledger.input({chainId:31337n,vault:address,venueNonce:await account.nonce(),deposits:[60000000n,140000000n],recovered:await vault.recoveredAssets(),feeBps:2000n});
 assert.equal(witness.pub[2],await vault.ledgerRoot());
 const proof=await ledger.prove(witness);
 mkdirSync('.data/cohort',{recursive:true});
 for(const [name,mutate]of [
  ['inflated-claim',w=>w.pub[9]++],['fake-shares',w=>w.pub[12]++],['wrong-old-root',w=>w.pub[2]++],['wrong-new-root',w=>w.pub[3]++],
  ['fake-allocation',w=>{w.gross[0]++;w.gross[1]--;}],['incorrect-fee',w=>w.fees[0]++]]){
   const bad=structuredClone(witness);mutate(bad);
   await reject(name,()=>wtns.calculate(JSON.parse(json(bad)),'artifacts/cohort-zk/perpl-cohort-ledger_js/perpl-cohort-ledger.wasm','.data/cohort/invalid.wtns'));
 }
 await reject('tampered-onchain-claims-rejected',()=>vault.settle.staticCall(witness.pub[3],witness.pub[9]+1n,witness.pub[10],witness.pub[11],proof.encodedProof));
 await tx('ledger-settle',vault.settle(witness.pub[3],witness.pub[9],witness.pub[10],witness.pub[11],proof.encodedProof));
 assert.equal(await vault.totalShares(),0n);report.checks.push('terminal-shares-burned');
 await reject('duplicate-ledger-proof-rejected',()=>vault.settle.staticCall(witness.pub[3],witness.pub[9],witness.pub[10],witness.pub[11],proof.encodedProof));
 await reject('other-investor-claim-rejected',()=>vault.claim.staticCall(1));
 for(const [i,signer]of [[0,owner],[1,investor]]){const before=await cash.balanceOf(signer.address);await tx('claim-'+i,vault.connect(signer).claim(i));assert.equal(await cash.balanceOf(signer.address)-before,witness.pub[9+i]);}
 await reject('duplicate-claim-rejected',()=>vault.claim.staticCall(0));
 if(witness.pub[11]>0n){await tx('claim-fee',vault.claimFee());await reject('duplicate-fee-claim-rejected',()=>vault.claimFee.staticCall());report.checks.push('positive-performance-fee-paid');}else await reject('no-performance-fee-on-loss',()=>vault.claimFee.staticCall());
 assert.equal(await cash.balanceOf(address),0n);report.checks.push('claims-plus-fees-equal-actual-recovery','no-residual-custody-or-shares');
 report.vault=address;report.account=await account.getAddress();report.ledger={proof:proof.proof,publicSignals:proof.publicSignals,verificationKey:JSON.parse(readFileSync('artifacts/cohort-zk/verification-key.json'))};report.status='PASS_LOCAL_COHORT_LEDGER_AND_REDEMPTION';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;process.exitCode=1;}
finally{writeFileSync(process.argv.includes('--profit-fixture')?'docs/evidence/cohort-profit-local.json':process.argv.includes('--operator')?'docs/evidence/cohort-operator-local.json':'docs/evidence/cohort-local.json',json(report)+'\n');console.log(json({status:report.status,checks:report.checks,error:report.error}));rpc.destroy();await(await curves.getCurveFromName('bn128')).terminate();}
