import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash,randomBytes } from 'node:crypto';
import { curves,wtns,groth16 } from 'snarkjs';
import { createTargetProver } from '../protocol/perpl/target-prover.mjs';
import { Contract,ContractFactory,JsonRpcProvider,parseEther,keccak256 } from 'ethers';
import solc from 'solc';

const url=process.env.MM_PERPL_FORK_RPC;
const tee=process.argv.includes('--tee');
const zk=tee||process.argv.includes('--zk');
mkdirSync('.data/perpl-mvp',{recursive:true});
assert.ok(url && ['127.0.0.1','localhost'].includes(new URL(url).hostname),'Local fork only');
const rpc=new JsonRpcProvider(url,undefined,{batchMaxCount:1,cacheTimeout:-1});rpc.pollingInterval=50;
const EXCHANGE='0x1964C32f0bE608E7D29302AFF5E61268E72080cc',TOKEN='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',market=16n;
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const evidence={createdAt:new Date().toISOString(),status:'RUNNING',environment:'LOCAL_MONAD_TESTNET_FORK',hardwareTEE:false,zeroKnowledge:false,externalNetworkBroadcast:false,checks:[],transactions:[],observations:[],limitations:['Local fork, not public testnet transactions','Ordinary EIP-712 authorization; no ZK or TEE','One investor and one dedicated account per Product; no fund shares/fees/committee','Collateral seeded by local-only impersonation; not a live faucet','No claim of private submission or attribution privacy']};
if(zk){evidence.zeroKnowledge=true;evidence.proofs=[];evidence.limitations[1]='Local CPU Groth16 target authorization only; no TEE or Ledger proof. Local single-party setup.';}
const good=name=>evidence.checks.push({name,passed:true});
const reject=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);good(name);};
try {
  assert.equal((await rpc.getNetwork()).chainId,31337n);
  const info=await rpc.send('anvil_nodeInfo',[]);assert.ok(info.forkConfig?.forkUrl);
  const origin=new JsonRpcProvider(info.forkConfig.forkUrl);
  try{assert.equal((await origin.getNetwork()).chainId,10143n);evidence.forkBlock=info.forkConfig.forkBlockNumber;evidence.forkBlockHash=(await origin.getBlock(evidence.forkBlock)).hash;}finally{origin.destroy();}
  // Freeze time at the observed block; a local fork has no continuing oracle feed.
  await rpc.send('anvil_setBlockTimestampInterval',[0]);
  const deployer=await rpc.getSigner(0),managerA=await rpc.getSigner(1),managerB=await rpc.getSigner(2),relayer=await rpc.getSigner(3);
  const beneficiary=await deployer.getAddress();
  const abi=JSON.parse(readFileSync('protocol/perpl/exchange-abi.json'));
  const venue=new Contract(EXCHANGE,abi,rpc);
  const cash=new Contract(TOKEN,['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function transfer(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)'],deployer);
  const send=async(label,tx)=>{const r=await(await tx).wait();assert.equal(r.status,1);evidence.transactions.push({label,hash:r.hash,block:r.blockNumber,gasUsed:r.gasUsed});console.log(label);return r;};
  const source=readFileSync('contracts/perpl/PerplMvpAccount.sol','utf8');
  const sources={'PerplMvpAccount.sol':{content:source}};
  if(zk){sources['PerplZkMvpAccount.sol']={content:readFileSync('contracts/perpl/PerplZkMvpAccount.sol','utf8')};sources['TargetVerifier.sol']={content:readFileSync('artifacts/perpl-zk/TargetVerifier.sol','utf8')};}
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  assert.equal(compiled.errors?.filter(x=>x.severity==='error').length||0,0,json(compiled.errors));
  evidence.sourceSha256=createHash('sha256').update(source).digest('hex');
  evidence.exchange=EXCHANGE;evidence.collateral=TOKEN;evidence.market=market;
  evidence.exchangeCodeHash=keccak256(await rpc.getCode(EXCHANGE));evidence.version=Array.from(await venue.getContractVersion());
  const m=await venue.getPerpetualInfoV2(market);
  evidence.marketSnapshot={symbol:m.symbol,mark:m.markPNS,markTimestamp:m.markTimestamp,oracle:m.oraclePNS,oracleTimestamp:m.oracleTimestampSec,base:m.basePricePNS,bestAsk:m.minAskPriceONS,bestBid:m.maxBidPriceONS,priceDecimals:m.priceDecimals,lotDecimals:m.lotDecimals,status:m.status};
  console.log(json(evidence.marketSnapshot));
  const min=await venue.getMinAccountOpenCNS();const allocation=min>1000000000n?min*2n:1000000000n;
  assert.ok(await cash.balanceOf(EXCHANGE)>allocation*3n,'fixture donor balance');
  await rpc.send('anvil_impersonateAccount',[EXCHANGE]);await rpc.send('anvil_setBalance',[EXCHANGE,'0x'+parseEther('1').toString(16)]);
  const donor=await rpc.getSigner(EXCHANGE);
  await send('local-only-collateral-fixture',cash.connect(donor).transfer(beneficiary,allocation*3n));
  await rpc.send('anvil_stopImpersonatingAccount',[EXCHANGE]);
  const prover=zk?await createTargetProver():null;
  let hardware;
  if(tee){hardware=await(await import('../protocol/perpl/hardware-prover.mjs')).createHardwareTargetProver();evidence.hardwareTEE=true;evidence.attestation=hardware.evidence;evidence.limitations[1]='Hardware TDX Groth16 target proof; local relayer and fork execution; no Ledger proof. Local single-party setup.';}
  let verifier;
  if(zk){const v=compiled.contracts['TargetVerifier.sol'].Groth16Verifier;verifier=await new ContractFactory(v.abi,v.evm.bytecode.object,deployer).deploy();await send('deploy-target-verifier',Promise.resolve(verifier.deploymentTransaction()));evidence.zkBuild=prover.manifest;evidence.verificationKey=JSON.parse(readFileSync('artifacts/perpl-zk/verification-key.json'));evidence.verifier=await verifier.getAddress();}
  const artifact=zk?compiled.contracts['PerplZkMvpAccount.sol'].PerplZkMvpAccount:compiled.contracts['PerplMvpAccount.sol'].PerplMvpAccount;
  const accounts=[];
  for(const [label,manager]of [['A',managerA],['B',managerB]]) {
    const key=zk?randomBytes(32):null;
    const args=[EXCHANGE,TOKEN,await manager.getAddress(),beneficiary,market,1000n];
    if(zk)args.push(await verifier.getAddress(),prover.publicKey(key));
    const account=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,deployer).deploy(...args);
    await send('deploy-'+label,Promise.resolve(account.deploymentTransaction()));
    await send('approve-'+label,cash.approve(await account.getAddress(),allocation));
    await send('fund-'+label,account.fund(allocation,{gasLimit:4000000}));
    assert.equal(await cash.allowance(await account.getAddress(),EXCHANGE),0n);
    good('contract-owned-account-funded-'+label);
    accounts.push({label,account,manager,key});
  }
  evidence.accounts=await Promise.all(accounts.map(async({label,account})=>({label,address:await account.getAddress(),accountId:await account.accountId(),allocation})));
  const types={Target:[{name:'target',type:'int256'},{name:'limitPrice',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
  const sign=async(a,target,limit)=>{
    const value={target,limitPrice:limit,nonce:await a.account.nonce(),deadline:BigInt((await rpc.getBlock('latest')).timestamp)+300n};
    if(zk){
      const [position]=await a.account.position();
      const witness=prover.input({...value,position,chainId:31337n,account:await a.account.getAddress(),market,maxLots:1000n},a.key);
      const p=await (hardware||prover).prove(witness);evidence.proofs.push({product:a.label,nonce:value.nonce,proof:p.proof,publicSignals:p.publicSignals,milliseconds:p.milliseconds,origin:tee?'HARDWARE_TDX':'LOCAL_CPU'});
      return {...value,signature:p.encodedProof};
    }
    const signature=await a.manager.signTypedData({name:'Metropolis Perpl Feasibility',version:'1',chainId:31337,verifyingContract:await a.account.getAddress()},types,value);
    return {...value,signature};
  };
  const execute=async(a,target,limitOverride)=>{
    const [before,mark,valid]=await a.account.position();assert.ok(valid,'fresh mark');
    const limit=limitOverride??(target>before?mark*10050n/10000n:mark*9950n/10000n);
    const s=await sign(a,target,limit);
    const r=await send(`execute-${a.label}-${target}`,a.account.connect(relayer).execute(s.target,s.limitPrice,s.nonce,s.deadline,s.signature,{gasLimit:12000000}));
    const event=r.logs.map(l=>{try{return a.account.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='Executed');assert.ok(event);
    const [after]=await a.account.position();assert.equal(after,event.args.afterQty);
    evidence.observations.push({product:a.label,target,before,after,mark,limit,tx:r.hash});
    console.log(json(evidence.observations.at(-1)));
    return {s,before,after};
  };
  const a=accounts[0],b=accounts[1];
  const invoke=(account,s)=>account.execute.staticCall(s.target,s.limitPrice,s.nonce,s.deadline,s.signature);
  const [initialQty,initialMark]=await a.account.position();assert.equal(initialQty,0n);
  const valid=await sign(a,100n,initialMark);
  await reject('changed-signed-target-rejected',()=>invoke(a.account,{...valid,target:101n}),zk?/INVALID_PROOF/:/MANAGER/);
  await reject('cross-product-signature-rejected',()=>invoke(b.account,valid),zk?/INVALID_PROOF/:/MANAGER/);
  if(zk){
    const context={chainId:31337n,account:await a.account.getAddress(),market,nonce:0n,target:100n,position:0n,limitPrice:initialMark,deadline:valid.deadline,maxLots:1000n};
    const correct=prover.input(context,a.key);
    for(const [label,mutate]of [
      ['unsigned-target',x=>x.pub[4]++],['unsigned-key',x=>x.pub[9]++],['wrong-signature',x=>x.sigS++],
      ['unsigned-deadline',x=>x.pub[7]++],['unsigned-chain',x=>x.pub[0]++],
    ]){const bad=structuredClone(correct);mutate(bad);await reject('circuit-rejects-'+label,()=>wtns.calculate(JSON.parse(json(bad)),'artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm',{type:'mem'}),/Assert Failed|Error in template/);}
    // Valid proof of a false pre-state must fail because the contract reads the venue.
    const falseState=await prover.prove(prover.input({...context,position:90n},a.key));
    evidence.proofs.push({product:'A',purpose:'false-pre-state',proof:falseState.proof,publicSignals:falseState.publicSignals,milliseconds:falseState.milliseconds});
    await reject('valid-proof-with-false-venue-state-rejected',()=>invoke(a.account,{...valid,signature:falseState.encodedProof}),/INVALID_PROOF/);
    const beforeNonce=await a.account.nonce(),beforeAccount=json(await venue.getAccountByAddr(await a.account.getAddress()));
    let failed;
    try{await(await a.account.execute(101n,valid.limitPrice,valid.nonce,valid.deadline,valid.signature,{gasLimit:12000000})).wait();assert.fail('invalid proof mined successfully');}
    catch(e){failed=e.receipt;assert.equal(failed?.status,0);}
    evidence.transactions.push({label:'mined-invalid-proof-rejected',hash:failed.hash,block:failed.blockNumber,gasUsed:failed.gasUsed,status:0});
    assert.equal(await a.account.nonce(),beforeNonce);assert.equal(json(await venue.getAccountByAddr(await a.account.getAddress())),beforeAccount);good('invalid-proof-transaction-leaves-nonce-and-capital-unchanged');
  }
  if(zk)await reject('signed-over-cap-rejected-by-circuit',async()=>wtns.calculate(JSON.parse(json(prover.input({chainId:31337n,account:await a.account.getAddress(),market,nonce:0n,target:1001n,position:0n,limitPrice:initialMark,deadline:valid.deadline,maxLots:1000n},a.key))),'artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm',{type:'mem'}),/Assert Failed|Error in template/);
  else{const large=await sign(a,1001n,initialMark);await reject('signed-over-cap-rejected',()=>invoke(a.account,large),/CAP/);}
  const badPrice=await sign(a,100n,initialMark*2n);
  await reject('signed-price-band-violation-rejected',()=>invoke(a.account,badPrice),/PRICE_BAND/);
  await reject('unauthorized-recovery-rejected',()=>b.account.connect(relayer).recover.staticCall(),/BENEFICIARY/);
  const bBefore=await venue.getAccountByAddr(await b.account.getAddress());
  const first=await execute(a,100n);
  assert.ok(first.after>0n,'IOC must actually fill');good('A-actual-IOC-fill');
  await reject('consumed-intent-replay-rejected',()=>invoke(a.account,first.s),/STALE/);
  await reject('withdraw-open-position-rejected',()=>a.account.recover.staticCall(),/NOT_FLAT/);
  assert.equal(json(await venue.getAccountByAddr(await b.account.getAddress())),json(bBefore));good('B-capital-unchanged-after-A-trade');
  const noFill=await execute(a,200n,initialMark/2n);
  assert.equal(noFill.before,noFill.after);good('zero-fill-keeps-actual-position');
  await reject('zero-fill-intent-is-still-one-use',()=>invoke(a.account,noFill.s),/STALE/);
  // A controlled local counterparty adds one small order INSIDE the real spread.
  // Venue bytecode/storage rules stay intact; only fixture collateral is seeded.
  const maker=await rpc.getSigner(4),makerAddress=await maker.getAddress();
  await send('fund-controlled-counterparty',cash.transfer(makerAddress,allocation));
  await send('counterparty-approve',cash.connect(maker).approve(EXCHANGE,allocation));
  const makerVenue=venue.connect(maker);
  await send('counterparty-create',makerVenue.createAccount(allocation,{gasLimit:4000000}));
  const book=await venue.getPerpetualInfoV2(market);
  const partialPrice=book.basePricePNS+book.minAskPriceONS-1n;
  assert.ok(partialPrice>book.basePricePNS+book.maxBidPriceONS,'spread for deterministic fixture');
  const makerOrder=[9001n,market,1,0n,partialPrice,25n,BigInt(await rpc.getBlockNumber())+20n,true,false,false,16n,100n,0n,0n,10000n];
  await send('counterparty-post-25-lots',makerVenue.execOrder(makerOrder,{gasLimit:12000000}));
  const partial=await execute(a,200n,partialPrice);
  assert.equal(partial.after-partial.before,25n);assert.ok(partial.after<200n);good('partial-fill-records-25-not-requested-100');
  assert.equal(json(await venue.getAccountByAddr(await b.account.getAddress())),json(bBefore));good('B-unchanged-after-zero-and-partial-fill');
  evidence.controlledCounterparty={address:makerAddress,lotLNS:25n,pricePNS:partialPrice,description:'Local seeded counterparty on unmodified fork venue, not external user traction'};
  const closed=await execute(a,0n);assert.equal(closed.after,0n);good('A-flat');
  const beforeWallet=await cash.balanceOf(beneficiary);
  await send('recover-A',a.account.recover({gasLimit:4000000}));
  assert.ok(await cash.balanceOf(beneficiary)>beforeWallet);good('A-wallet-received-collateral');
  await reject('double-recovery-rejected',()=>a.account.recover.staticCall(),/NO_FREE_BALANCE/);
  const bTrade=await execute(b,-100n);assert.ok(bTrade.after<0n);good('B-actual-short-fill');
  const bClosed=await execute(b,0n);assert.equal(bClosed.after,0n);good('B-flat');
  const beforeBWallet=await cash.balanceOf(beneficiary);
  await send('recover-B',b.account.recover({gasLimit:4000000}));
  const receivedB=(await cash.balanceOf(beneficiary))-beforeBWallet;assert.ok(receivedB>0n);good('B-collateral-recovered');
  evidence.recoveries={A:beforeBWallet-beforeWallet,B:receivedB,unit:'AUSD base units (6 decimals)'};
  if(zk){for(const p of evidence.proofs)assert.equal(await groth16.verify(evidence.verificationKey,p.publicSignals,p.proof),true);good('all-generated-proofs-independently-verify');}
  for(const tx of evidence.transactions){const receipt=await rpc.getTransactionReceipt(tx.hash);assert.equal(receipt.status,tx.status??1);}
  good('all-transaction-receipts-requeried');
  evidence.status=tee?'PASS_HARDWARE_TDX_TO_LOCAL_PERPL_MVP':zk?'PASS_LOCAL_PERPL_ZK_MVP':'PASS_LOCAL_PERPL_FEASIBILITY';
} catch(error) {
  evidence.status='BLOCKED';evidence.error=error.shortMessage||error.message;evidence.detail=String(error).slice(0,6000);
  console.error(evidence.error);process.exitCode=1;
} finally {
  writeFileSync('.data/perpl-mvp/latest.json',json(evidence)+'\n');
  if(evidence.status.startsWith('PASS_'))writeFileSync(tee?'docs/evidence/perpl-tee-mvp.json':zk?'docs/evidence/perpl-zk-mvp.json':'docs/evidence/perpl-fork-mvp.json',json(evidence)+'\n');
  rpc.destroy();
  if(zk)await(await curves.getCurveFromName('bn128')).terminate();
}
