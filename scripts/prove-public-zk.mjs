import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,existsSync,renameSync } from 'node:fs';
import { randomBytes,createHash } from 'node:crypto';
import { Wallet,JsonRpcProvider,Contract,ContractFactory,parseEther,formatEther,keccak256,AbiCoder,toQuantity } from 'ethers';
import { groth16,curves } from 'snarkjs';
import solc from 'solc';
import { createTargetProver } from '../protocol/perpl/target-prover.mjs';
const rehearsal=process.argv.includes('--rehearsal'),execute=process.argv.includes('--execute');
const url=rehearsal?process.env.MM_PERPL_FORK_RPC:'https://testnet-rpc.monad.xyz';
if(rehearsal)assert.equal(new URL(url).hostname,'127.0.0.1');
const dir=rehearsal?'.data/public-zk-rehearsal':'.data/public-zk';mkdirSync(dir,{recursive:true,mode:0o700});
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const save=(p,v)=>{writeFileSync(p+'.tmp',json(v)+'\n',{mode:0o600});renameSync(p+'.tmp',p);};
const rpc=new JsonRpcProvider(url,undefined,{batchMaxCount:1,cacheTimeout:-1});
let prover,reader;
const report={createdAt:new Date().toISOString(),environment:rehearsal?'LOCAL_PUBLIC_ZK_REHEARSAL':'PUBLIC_MONAD_TESTNET',chainId:10143,status:'RUNNING',hardwareTEE:false,dexExecution:false,externalNetworkBroadcast:false,transactions:[],checks:[],limitations:['Synthetic target authorization only; no TEE in this run','No Perpl call, deposit, fill, recovery or ledger proof','Local single-party Groth16 setup; not production security approval']};
const statePath=dir+'/session.json';let state=!rehearsal&&existsSync(statePath)?JSON.parse(readFileSync(statePath)):null;
try {
  assert.equal((await rpc.getNetwork()).chainId,10143n);
  if(rehearsal)assert.ok((await rpc.send('anvil_nodeInfo',[])).forkConfig?.forkUrl);
  const wallet=rehearsal?await rpc.getSigner(0):new Wallet(JSON.parse(readFileSync('.data/testnet-pilot/wallet.json')).privateKey,rpc);
  report.wallet=wallet.address;report.startBalanceMON=formatEther(await rpc.getBalance(wallet.address));
  const sources={'PublicZkProbe.sol':{content:readFileSync('contracts/perpl/PublicZkProbe.sol','utf8')},'TargetVerifier.sol':{content:readFileSync('artifacts/perpl-zk/TargetVerifier.sol','utf8')}};
  const sourceHash=createHash('sha256').update(json(sources)).digest('hex');report.sourceSha256=sourceHash;
  const compiled=JSON.parse(solc.compile(json({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
  assert.equal(compiled.errors?.filter(x=>x.severity==='error').length||0,0,json(compiled.errors));
  if(!execute){report.status='READY_NOT_BROADCAST';}
  else {
    prover=await createTargetProver();report.build=prover.manifest;
    state??={key:randomBytes(32).toString('hex'),wallet:wallet.address,sourceHash,steps:{}};
    assert.equal(state.wallet,wallet.address);assert.equal(state.sourceHash,sourceHash);
    const persist=()=>save(statePath,state);persist();
    const waitReceipt=async(hash)=>{
      const until=Date.now()+90000;
      while(Date.now()<until){
        const receipt=await rpc.getTransactionReceipt(hash);
        if(receipt&&(rehearsal||await rpc.getBlockNumber()>=receipt.blockNumber+1))return receipt;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw Error(`Pending transaction ${hash}; rerun to reconcile`);
    };
    const step=async(label,prepare,expected=1)=>{
      let receipt;const old=state.steps[label];
      if(old?.hash){receipt=await waitReceipt(old.hash);}
      else {
        const req=await prepare(),fees=await rpc.getFeeData();
        const gasLimit=expected===0?1000000n:(await wallet.estimateGas(req))*13n/10n;
        const maxFeePerGas=fees.maxFeePerGas??fees.gasPrice;
        const spent=Object.values(state.steps).reduce((a,s)=>a+BigInt(s.fee||0),0n);
        assert.ok(spent+gasLimit*maxFeePerGas<=parseEther('1'),'Test MON session cap 1');
        const tx=await wallet.sendTransaction({...req,gasLimit,maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n});
        state.steps[label]={hash:tx.hash};persist();
        receipt=await waitReceipt(tx.hash);
      }
      assert.ok(receipt,'Pending transaction: rerun to reconcile');
      state.steps[label]={hash:receipt.hash,status:receipt.status,block:receipt.blockNumber,fee:String(receipt.fee),contractAddress:receipt.contractAddress};persist();
      assert.equal(receipt.status,expected,label);
      console.log(label+' '+receipt.hash);return receipt;
    };
    const v=compiled.contracts['TargetVerifier.sol'].Groth16Verifier;
    const vr=await step('deploy-verifier',()=>new ContractFactory(v.abi,v.evm.bytecode.object,wallet).getDeployTransaction());
    assert.equal(await rpc.getCode(vr.contractAddress),'0x'+v.evm.deployedBytecode.object,'Verifier runtime bytecode');
    const p=compiled.contracts['PublicZkProbe.sol'].PublicZkProbe,key=Buffer.from(state.key,'hex');
    const pr=await step('deploy-probe',()=>new ContractFactory(p.abi,p.evm.bytecode.object,wallet).getDeployTransaction(vr.contractAddress,prover.publicKey(key)));
    const probe=new Contract(pr.contractAddress,p.abi,wallet);report.verifier=vr.contractAddress;report.probe=pr.contractAddress;
    if(!state.proof){
      const witness=prover.input({chainId:10143n,account:pr.contractAddress,market:16n,nonce:0n,target:100n,position:0n,limitPrice:850000n,deadline:BigInt((await rpc.getBlock('latest')).timestamp)+1800n,maxLots:100n},key);
      state.proof=await prover.prove(witness);persist();
    }
    const proof=state.proof;report.proof=proof;report.verificationKey=JSON.parse(readFileSync('artifacts/perpl-zk/verification-key.json'));
    assert.equal(await groth16.verify(report.verificationKey,proof.publicSignals,proof.proof),true);report.checks.push('local-Groth16-verification');
    const bad=[...proof.publicSignals];bad[4]='99';
    if(!state.steps['reject-tampered']?.hash)await assert.rejects(()=>probe.submit.staticCall(proof.encodedProof,bad),/INVALID_PROOF/);
    const rejected=await step('reject-tampered',()=>probe.submit.populateTransaction(proof.encodedProof,bad),0);
    assert.equal(rejected.logs.length,0);
    if(!state.steps['accept-valid']?.hash)assert.equal(await probe.accepted(),0n);
    report.checks.push('tampered-target-mined-status-0-no-events');
    const valid=await step('accept-valid',()=>probe.submit.populateTransaction(proof.encodedProof,proof.publicSignals));
    const events=valid.logs.map(l=>{try{return probe.interface.parseLog(l);}catch{return null;}}).filter(x=>x?.name==='Accepted');assert.equal(events.length,1);
    assert.equal(events[0].args.publicInputsHash,keccak256(AbiCoder.defaultAbiCoder().encode(['uint256[11]'],[proof.publicSignals])));
    assert.equal(await probe.accepted(),1n);report.checks.push('valid-proof-mined-status-1-matching-event-and-counter');
    if(!state.steps['reject-replay']?.hash)await assert.rejects(()=>probe.submit.staticCall(proof.encodedProof,proof.publicSignals),/STALE/);
    const replay=await step('reject-replay',()=>probe.submit.populateTransaction(proof.encodedProof,proof.publicSignals),0);assert.equal(replay.logs.length,0);assert.equal(await probe.accepted(),1n);report.checks.push('replay-mined-status-0-counter-unchanged');
    report.verificationRpc=url;report.testMonSessionCap='1';
    reader=new JsonRpcProvider(url,undefined,{batchMaxCount:1,cacheTimeout:-1});assert.equal((await reader.getNetwork()).chainId,10143n);
    for(const [label,s]of Object.entries(state.steps)){
      const r=await reader.getTransactionReceipt(s.hash);assert.ok(r);assert.equal(r.status,s.status);
      const tx=await reader.getTransaction(s.hash);assert.equal(tx.from.toLowerCase(),wallet.address.toLowerCase());assert.equal(tx.chainId,10143n);
      let historicalRevertReason=null;
      if(s.status===0){
        historicalRevertReason=label==='reject-tampered'?'INVALID_PROOF':'STALE';
        await assert.rejects(()=>reader.send('eth_call',[{from:tx.from,to:tx.to,data:tx.data,gas:toQuantity(tx.gasLimit)},toQuantity(r.blockNumber-1)]),e=>e.reason===historicalRevertReason);
      }
      report.transactions.push({label,...s,gasUsed:String(r.gasUsed),gasLimit:String(tx.gasLimit),historicalRevertReason,logs:r.logs,calldata:tx.data,to:tx.to,blockHash:r.blockHash,explorer:rehearsal?null:'https://testnet.monadexplorer.com/tx/'+s.hash});
    }
    assert.equal(await new Contract(pr.contractAddress,p.abi,reader).accepted(),1n);
    report.checks.push('receipts-transactions-and-final-state-reread');report.totalFeeMON=formatEther(Object.values(state.steps).reduce((a,s)=>a+BigInt(s.fee||0),0n));
    report.status=rehearsal?'PASS_LOCAL_PUBLIC_ZK_REHEARSAL':'PASS_PUBLIC_TESTNET_ZK_ACCEPTANCE';
  }
} catch(e){report.status='BLOCKED';report.error=e.shortMessage||e.message;process.exitCode=1;}
finally {
  report.externalNetworkBroadcast=!rehearsal&&!!state&&Object.values(state.steps).some(s=>s.hash);
  if(state)report.sessionTransactions=state.steps;
  save(dir+'/latest.json',report);
  if(report.status.startsWith('PASS_'))save('docs/evidence/'+(rehearsal?'public-zk-rehearsal':'public-zk-testnet')+'.json',report);
  console.log(json({status:report.status,error:report.error,checks:report.checks,totalFeeMON:report.totalFeeMON}));
  rpc.destroy();reader?.destroy();if(prover)await(await curves.getCurveFromName('bn128')).terminate();
}
