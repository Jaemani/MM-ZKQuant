// Fixed public TESTNET only. Default is read-only preflight; --execute uses synthetic targets.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,existsSync,renameSync } from 'node:fs';
import { randomBytes,createHash } from 'node:crypto';
import { Wallet,JsonRpcProvider,Contract,ContractFactory,parseEther,formatEther } from 'ethers';
import { curves } from 'snarkjs';
import solc from 'solc';
import { createTargetProver } from '../protocol/perpl/target-prover.mjs';
const rehearsal=process.argv.includes('--fork-rehearsal');
const resumeRehearsal=rehearsal&&process.argv.includes('--resume-rehearsal');
const execute=rehearsal||process.argv.includes('--execute'),dir=rehearsal?'.data/perpl-testnet-rehearsal':'.data/perpl-testnet';
const rpcUrl=rehearsal?process.env.MM_PERPL_FORK_RPC:'https://testnet-rpc.monad.xyz';
if(rehearsal)assert.ok(rpcUrl&&new URL(rpcUrl).hostname==='127.0.0.1','Rehearsal requires loopback');
mkdirSync(dir,{recursive:true,mode:0o700});
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const save=(path,value)=>{writeFileSync(path+'.tmp',json(value)+'\n',{mode:0o600});renameSync(path+'.tmp',path);};
const EXCHANGE='0x1964C32f0bE608E7D29302AFF5E61268E72080cc',TOKEN='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
const rpc=new JsonRpcProvider(rpcUrl,undefined,{batchMaxCount:1,cacheTimeout:-1});
const wallet=rehearsal?await rpc.getSigner(0):new Wallet(JSON.parse(readFileSync('.data/testnet-pilot/wallet.json')).privateKey,rpc);
const venue=new Contract(EXCHANGE,JSON.parse(readFileSync('protocol/perpl/exchange-abi.json')),rpc);
const cash=new Contract(TOKEN,['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)'],wallet);
const statePath=dir+'/session.json';let state=(!rehearsal||resumeRehearsal)&&existsSync(statePath)?JSON.parse(readFileSync(statePath)):null,prover;
const report={createdAt:new Date().toISOString(),environment:rehearsal?'LOCAL_TESTNET_RUNNER_REHEARSAL':'PUBLIC_MONAD_TESTNET',status:'PREFLIGHT',externalNetworkBroadcast:false,hardwareTEE:false,syntheticPublicTargets:true,transactions:[],limitations:['No hardware TEE in this public-network runner','Public synthetic targets only; not PRIVATE_ONLY strategy submission','One investor per dedicated account; no ledger/shares/fees','No guarantee of fills or withdrawal liquidity']};
try {
  assert.equal((await rpc.getNetwork()).chainId,10143n);
  const minimum=await venue.getMinAccountOpenCNS(),allocation=minimum>100000000n?minimum:100000000n;
  assert.ok(allocation<=1000000000n,'Unexpected account minimum: stop for review');
  if(rehearsal&&!resumeRehearsal){
    const info=await rpc.send('anvil_nodeInfo',[]);assert.ok(info.forkConfig?.forkUrl);report.forkBlock=info.forkConfig.forkBlockNumber;
    await rpc.send('anvil_setBlockTimestampInterval',[0]);
    await rpc.send('anvil_impersonateAccount',[EXCHANGE]);await rpc.send('anvil_setBalance',[EXCHANGE,'0x'+parseEther('1').toString(16)]);
    const donor=await rpc.getSigner(EXCHANGE),token=new Contract(TOKEN,['function transfer(address,uint256) returns(bool)'],donor);
    await(await token.transfer(wallet.address,allocation*2n)).wait();await rpc.send('anvil_stopImpersonatingAccount',[EXCHANGE]);
    report.limitations.push('Local impersonated collateral and frozen oracle time; no public-chain transaction');
  }
  const gas=await rpc.getBalance(wallet.address),tokens=await cash.balanceOf(wallet.address);
  report.wallet=wallet.address;report.exchange=EXCHANGE;report.collateral=TOKEN;report.chainId=10143;
  report.preflight={gasMON:formatEther(gas),walletAUSDBaseUnits:tokens,allocationPerProduct:allocation,requiredNewSessionAUSD:allocation*2n};
  const blockers=[];
  if(gas<parseEther('0.1'))blockers.push('TEST_MON_BELOW_0.1');
  if(!state&&tokens<allocation*2n)blockers.push('TEST_AUSD_REQUIRED');
  const names=['PerplMvpAccount.sol','PerplZkMvpAccount.sol'];
  const sources=Object.fromEntries(names.map(n=>[n,{content:readFileSync('contracts/perpl/'+n,'utf8')}]));
  sources['TargetVerifier.sol']={content:readFileSync('artifacts/perpl-zk/TargetVerifier.sol','utf8')};
  const sourceHash=createHash('sha256').update(json(sources)).digest('hex');report.sourceSha256=sourceHash;
  const compiled=JSON.parse(solc.compile(json({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  assert.equal(compiled.errors?.filter(x=>x.severity==='error').length||0,0,json(compiled.errors));
  report.compilation='PASS';report.blockers=blockers;
  if(blockers.length){report.status='BLOCKED_PREFLIGHT';process.exitCode=2;}
  else if(!execute){report.status='READY_NOT_BROADCAST';}
  else {
    prover=await createTargetProver();
    if(!state){state={wallet:wallet.address,sourceHash,allocation:String(allocation),steps:{},keys:[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')],products:[],startedAt:new Date().toISOString()};save(statePath,state);}
    assert.equal(state.wallet,wallet.address);assert.equal(state.sourceHash,sourceHash,'Deployment sources changed; use existing code for recovery');
    const persist=()=>save(statePath,state);
    for(const entry of Object.values(state.steps)){
      if(entry.hash&&entry.status==null){
        const receipt=await rpc.getTransactionReceipt(entry.hash)||await rpc.waitForTransaction(entry.hash,1,90000);
        assert.ok(receipt,'Pending prior transaction: no further broadcasts');
        entry.status=receipt.status;entry.fee=String(receipt.fee);persist();
      }
      assert.notEqual(entry.status,0,'Prior transaction reverted: inspect session before proceeding');
    }
    const nonceBefore=await rpc.getTransactionCount(wallet.address);

    // A recorded transaction is always reconciled before any attempt to send another.
    const step=async(label,prepare)=>{
      let entry=state.steps[label],receipt;
      if(entry?.hash){receipt=await rpc.getTransactionReceipt(entry.hash);if(!receipt)receipt=await rpc.waitForTransaction(entry.hash,1,90000);assert.ok(receipt,'Pending transaction: rerun to reconcile, do not replace');}
      else {
        const request=await prepare();
        const estimate=await wallet.estimateGas(request),fee=await rpc.getFeeData();
        const gasLimit=estimate*13n/10n,maxFeePerGas=fee.maxFeePerGas??fee.gasPrice,maxPriorityFeePerGas=fee.maxPriorityFeePerGas??0n;
        let used=0n;for(const e of Object.values(state.steps))used+=BigInt(e.fee||'0');
        assert.ok(used+gasLimit*maxFeePerGas<=parseEther('0.5'),'Session test-MON cap 0.5');
        const tx=await wallet.sendTransaction({...request,gasLimit,maxFeePerGas,maxPriorityFeePerGas});
        state.steps[label]={hash:tx.hash};persist();
        receipt=await rpc.waitForTransaction(tx.hash,1,90000);assert.ok(receipt,'Pending transaction; session saved');
      }
      state.steps[label]={hash:receipt.hash,block:receipt.blockNumber,status:receipt.status,fee:String(receipt.fee),gasUsed:String(receipt.gasUsed),contractAddress:receipt.contractAddress};persist();
      report.externalNetworkBroadcast=!rehearsal;
      assert.equal(receipt.status,1,'Transaction reverted: '+label+' '+receipt.hash);
      console.log(label+' '+receipt.hash);return receipt;
    };
    const v=compiled.contracts['TargetVerifier.sol'].Groth16Verifier;
    const vr=await step('deploy-verifier',()=>new ContractFactory(v.abi,v.evm.bytecode.object,wallet).getDeployTransaction());
    const verifier=vr.contractAddress;assert.ok(verifier);
    const a=compiled.contracts['PerplZkMvpAccount.sol'].PerplZkMvpAccount;
    for(let i=0;i<2;i++){
      const label=i?'B':'A',key=Buffer.from(state.keys[i],'hex');
      const dr=await step('deploy-'+label,()=>new ContractFactory(a.abi,a.evm.bytecode.object,wallet).getDeployTransaction(EXCHANGE,TOKEN,wallet.address,wallet.address,16,100,verifier,prover.publicKey(key)));
      const address=dr.contractAddress,account=new Contract(address,a.abi,wallet);
      state.products[i]={label,address};persist();
      await step('approve-'+label,()=>cash.approve.populateTransaction(address,BigInt(state.allocation)));
      await step('fund-'+label,()=>account.fund.populateTransaction(BigInt(state.allocation)));
      const trade=async(name,target)=>step(name,async()=>{
        const [position,mark,valid]=await account.position();assert.ok(valid&&mark>0n,'Venue price not valid');
        const nonce=await account.nonce(),deadline=BigInt((await rpc.getBlock('latest')).timestamp)+180n;
        const limitPrice=target>position?mark*10050n/10000n:mark*9950n/10000n;
        const witness=prover.input({chainId:10143n,account:address,market:16n,nonce,target,position,limitPrice,deadline,maxLots:100n},key);
        const proof=await prover.prove(witness);
        state.proofs??={};state.proofs[name]={proof:proof.proof,publicSignals:proof.publicSignals,milliseconds:proof.milliseconds};persist();
        return account.execute.populateTransaction(target,limitPrice,nonce,deadline,proof.encodedProof);
      });
      const opened=await trade('open-'+label,i?-100n:100n);
      const event=opened.logs.map(l=>{try{return account.interface.parseLog(l);}catch{return null;}}).find(x=>x?.name==='Executed');
      assert.ok(event);state.products[i].openActual=String(event.args.afterQty);persist();
      // Never leave a filled position merely because the first close was only partial.
      const priorCloses=Object.keys(state.steps).filter(k=>k.startsWith('close-'+label+'-')).length;
      for(let attempt=priorCloses;attempt<priorCloses+3;attempt++){
        if((await account.position())[0]===0n)break;
        await trade('close-'+label+'-'+attempt,0n);
      }
      assert.equal((await account.position())[0],0n,'Not flat: rerun with same session to finish close');
      const recovery=await step('recover-'+label,()=>account.recover.populateTransaction());
      const recovered=recovery.logs.map(l=>{try{return account.interface.parseLog(l);}catch{return null;}}).find(x=>x?.name==='Recovered');
      assert.ok(recovered&&recovered.args.amount>0n);state.products[i].recovered=String(recovered.args.amount);persist();
    }
    for(const [name,entry]of Object.entries(state.steps)){const r=await rpc.getTransactionReceipt(entry.hash);assert.equal(r?.status,1);report.transactions.push({name,...entry,explorer:rehearsal?null:'https://testnet.monadexplorer.com/tx/'+entry.hash,logs:r.logs});}
    report.products=state.products;report.proofs=state.proofs;report.verificationKey=JSON.parse(readFileSync('artifacts/perpl-zk/verification-key.json'));
    assert.ok(state.products.every(p=>BigInt(p.openActual)!==0n),'IOC did not fill: round trip ended safely but trading validation incomplete');
    if(resumeRehearsal){assert.equal(await rpc.getTransactionCount(wallet.address),nonceBefore);report.resumeWithoutAdditionalTransactions=true;}
    report.status=rehearsal?'PASS_LOCAL_TESTNET_RUNNER_REHEARSAL':'PASS_PUBLIC_TESTNET_ZK_ROUNDTRIP';
  }
} catch(e){report.status='BLOCKED';report.error=e.shortMessage||e.message;process.exitCode=1;}
finally {
  if(state){report.sessionTransactions=state.steps;report.externalNetworkBroadcast=!rehearsal&&Object.values(state.steps).some(s=>s.hash);report.products=state.products;}
  save(dir+'/latest.json',report);
  if(report.status==='PASS_PUBLIC_TESTNET_ZK_ROUNDTRIP')save('docs/evidence/perpl-testnet-mvp.json',report);
  else if(report.status==='PASS_LOCAL_TESTNET_RUNNER_REHEARSAL')save('docs/evidence/perpl-testnet-rehearsal.json',report);
  else if(!execute)save('docs/evidence/perpl-testnet-readiness.json',report);
  console.log(json({status:report.status,preflight:report.preflight,blockers:report.blockers,error:report.error}));
  rpc.destroy();if(prover)await(await curves.getCurveFromName('bn128')).terminate();
}
