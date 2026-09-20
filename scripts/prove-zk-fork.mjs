import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { Contract, ContractFactory, JsonRpcProvider, parseEther, keccak256 } from 'ethers';
import solc from 'solc';
import { wtns } from 'snarkjs';
import { createBookProver, json, FIELD } from '../src/zk/book.js';
import { ERC20 } from '../src/integration/protocol.js';

const rpcUrl=process.env.MM_FORK_RPC||'http://127.0.0.1:18545';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(rpcUrl).hostname),'Loopback fork only');
const rpc=new JsonRpcProvider(rpcUrl,undefined,{batchMaxCount:1,cacheTimeout:-1});rpc.pollingInterval=100;
const sources={};
for(const name of ['ApprovedVault.sol','ZkBookVault.sol'])sources[name]={content:readFileSync('contracts/integration/'+name,'utf8')};
sources['BookVerifier.sol']={content:readFileSync('artifacts/zk/BookVerifier.sol','utf8')};
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
assert.equal(compiled.errors?.filter(x=>x.severity==='error').length||0,0,json(compiled.errors));
const evidence={mode:'ZK_TWO_BOOK_MONAD_FORK',hardwareTEE:false,externalNetworkBroadcast:false,checks:[],transactions:[],proofs:[],build:JSON.parse(readFileSync('artifacts/zk/build.json')),verificationKey:JSON.parse(readFileSync('artifacts/zk/verification-key.json')),limitations:['Local single-party Groth16 setup; not a production ceremony or audit','Trusted synthetic genesis allocation; no deposit/redemption/share ownership proofs','Two spot books, one pair, serial synchronous fills, concrete signed orders rather than target intent compilation','Provider uses research BabyJubJub key; wallet-to-provider enrollment not implemented','No provider capital lock, staking/fees, NAV oracle, full risk mandate, emergency recovery or Dapp migration','Local CPU witness/proving; hardware TEE and TEE proving measurements still pending']};
const good=name=>evidence.checks.push({name,passed:true});
const reject=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);good(name);};
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
try {
  const info=await rpc.send('anvil_nodeInfo',[]);
  assert.equal(Number((await rpc.getNetwork()).chainId),31337);assert.ok(info.forkConfig?.forkUrl);
  const origin=new JsonRpcProvider(info.forkConfig.forkUrl);
  try{assert.equal(Number((await origin.getNetwork()).chainId),143);evidence.forkBlock=info.forkConfig.forkBlockNumber;evidence.forkBlockHash=(await origin.getBlock(evidence.forkBlock)).hash;}finally{origin.destroy();}
  const deployer=await rpc.getSigner(0),relayer=await rpc.getSigner(3);
  const send=async(label,tx)=>{const r=await(await tx).wait();assert.equal(r.status,1);evidence.transactions.push({label,hash:r.hash,block:r.blockNumber,gasUsed:String(r.gasUsed)});return r;};
  const deploy=async(file,name,args=[])=>{const a=compiled.contracts[file][name],c=await new ContractFactory(a.abi,a.evm.bytecode.object,deployer).deploy(...args);await send('deploy-'+name,Promise.resolve(c.deploymentTransaction()));return c;};
  const policy={cash:'0x754704Bc059F8C67012fEd69BC8A327a5aafb603',asset:'0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',router:'0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40',quoter:'0x661e93cca42afacb172121ef892830ca3b70f08d',fee:500,maxSpendBps:2500};
  evidence.policy=policy;evidence.codeHashes={};
  for(const field of ['cash','asset','router','quoter']){const code=await rpc.getCode(policy[field]);assert.ok(code.length>2);evidence.codeHashes[field]=keccak256(code);}
  const cash=new Contract(policy.cash,ERC20,deployer),asset=new Contract(policy.asset,[...ERC20,'function deposit() payable'],deployer);
  await send('wrap-local-MON',asset.deposit({value:parseEther('100')}));
  await send('funding-allowance',asset.approve(policy.router,parseEther('100')));
  const router=new Contract(policy.router,['function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns(uint256)'],deployer);
  await send('funding-external-swap',router.exactInputSingle([policy.asset,policy.cash,500,await deployer.getAddress(),(await rpc.getBlock('latest')).timestamp+900,parseEther('100'),1,0]));
  const allocation=(await cash.balanceOf(await deployer.getAddress()))/4n;
  assert.ok(allocation>1000n);
  const prover=await createBookProver(),keys=[randomBytes(32),randomBytes(32)];
  let state=prover.initial([allocation,allocation],keys);
  const verifier=await deploy('BookVerifier.sol','Groth16Verifier');
  const config=BigInt(keccak256(Buffer.from(json(policy))))%FIELD;
  const vault=await deploy('ZkBookVault.sol','ZkBookVault',[await verifier.getAddress(),policy.cash,policy.asset,policy.router,policy.fee,config,policy.maxSpendBps]);
  const context={chainId:31337,vault:await vault.getAddress(),config,maxSpendBps:policy.maxSpendBps};
  evidence.vault=context.vault;evidence.verifier=await verifier.getAddress();evidence.initialRoot=String(prover.root(state));evidence.config=String(config);
  evidence.vaultSourceSha256=sha('contracts/integration/ZkBookVault.sol');
  evidence.vaultCodeHash=keccak256(await rpc.getCode(context.vault));evidence.verifierCodeHash=keccak256(await rpc.getCode(evidence.verifier));
  await send('seed-allowance',cash.approve(context.vault,allocation*2n));
  await send('trusted-genesis-funding',vault.seed(prover.root(state),allocation*2n));
  const q=new Contract(policy.quoter,['function quoteExactInputSingle((address,address,uint256,uint24,uint160)) returns(uint256,uint160,uint32,uint256)'],rpc);
  const witness=async input=>wtns.calculate(JSON.parse(json(input)),'artifacts/zk/book-transition_js/book-transition.wasm',{type:'mem'});
  const invalid=async(name,input)=>reject(name,()=>witness(input),/Assert Failed|Error in template/);
  const mutate=(t,fn)=>{const input=structuredClone(t.input);fn(input);input.newRoot=prover.root({books:input.after,salt:input.newSalt,pending:t.next.pending});return input;};
  const prove=async(label,t)=>{console.log('Proving '+label);const p=await prover.prove(t.input);evidence.proofs.push({label,proof:p.proof,publicSignals:p.publicSignals,milliseconds:p.milliseconds});return p;};
  let firstProof;
  for(const [selected,buy] of [[0,1],[0,0],[1,1],[1,0]]){
    const before=structuredClone(state),other=structuredClone(state.books[1-selected]),batch=(await vault.batch())+1n;
    const amount=buy?state.books[selected][0]/4n:state.books[selected][1];
    const quoted=(await q.quoteExactInputSingle.staticCall([buy?policy.cash:policy.asset,buy?policy.asset:policy.cash,amount,500,0]))[0];
    const order={selected,buy,amount,minOut:quoted*9950n/10000n,deadline:(await rpc.getBlock('latest')).timestamp+900,batch};
    const signature=prover.sign(context,order,state.books[selected][3]+1n,keys[selected]);
    const auth=prover.transition(state,context,order,signature);
    if(batch===1n){
      const wrong=prover.sign(context,order,1n,keys[1]);
      await invalid('wrong-provider-signature',{...auth.input,...wrong});
      await invalid('cross-chain-signed-order',{...auth.input,chainId:143});
      await invalid('cross-vault-signed-order',{...auth.input,vault:BigInt(context.vault)+1n});
      await invalid('unsigned-order-amount-change',{...auth.input,amount:amount+1n});
      const largeOrder={...order,amount:allocation},largeSignature=prover.sign(context,largeOrder,1n,keys[0]);
      await invalid('cash-spend-policy-limit',prover.transition(state,context,largeOrder,largeSignature).input);
      await invalid('negative-balance-range',mutate(auth,x=>x.after[0][0]=-1n));
      await invalid('reservation-on-wrong-book',mutate(auth,x=>{x.after[0][2]=0n;x.after[1][2]=amount;}));
      await invalid('skip-provider-sequence',mutate(auth,x=>x.after[0][3]=2n));
    }
    const p=await prove('authorize-'+batch,auth);firstProof||=p;
    if(batch===1n){
      const signals=[...p.publicSignals];signals[6]=String(BigInt(signals[6])+1n);
      await reject('tampered-proof-root-rejected-onchain',()=>vault.authorizeAndExecute.staticCall(p.contractProof,signals),/INVALID_PROOF/);
      const wrongChain=[...p.publicSignals];wrongChain[1]='143';
      await reject('cross-chain-proof-rejected-onchain',()=>vault.authorizeAndExecute.staticCall(p.contractProof,wrongChain),/DOMAIN/);
      // A valid authorization proof with an impossible minimum must revert the
      // entire transaction, including R1 and the pending reservation.
      const impossible={...order,minOut:(1n<<95n)},sig=prover.sign(context,impossible,1n,keys[0]);
      const impossibleTransition=prover.transition(state,context,impossible,sig),ip=await prove('impossible-fill-authorization',impossibleTransition);
      await reject('dex-failure-is-atomic',async()=>{await(await vault.authorizeAndExecute(ip.contractProof,ip.publicSignals,{gasLimit:1800000})).wait();});
      assert.equal(await vault.root(),prover.root(before));assert.equal(await vault.pending(),false);assert.equal(await vault.batch(),0n);
    }
    await send('execute-'+batch,vault.connect(relayer).authorizeAndExecute(p.contractProof,p.publicSignals,{gasLimit:1800000}));state=auth.next;
    assert.equal(await vault.root(),prover.root(state));assert.equal(await vault.pending(),true);
    const out=await vault.actualOut();
    await reject('no-next-batch-before-settlement-'+batch,()=>vault.authorizeAndExecute.staticCall(p.contractProof,p.publicSignals),/PENDING_OR_UNSEEDED/);
    const settlement=prover.transition(state,context,order,signature,out);
    if(batch===1n){
      await invalid('cross-book-cash-theft-preserving-total',mutate(settlement,x=>{x.after[0][0]-=1n;x.after[1][0]+=1n;}));
      await invalid('cross-book-fill-reallocation',mutate(settlement,x=>{x.after[0][1]=0n;x.after[1][1]=out;}));
      await invalid('omitted-fill',mutate(settlement,x=>{x.after[0][1]=0n;x.assetTotal=0n;}));
      await invalid('duplicate-fill',mutate(settlement,x=>{x.after[0][1]*=2n;x.assetTotal*=2n;}));
      const fabricated=prover.transition(state,context,order,signature,out+1n),fp=await prove('fabricated-receipt',fabricated);
      await reject('valid-proof-with-fabricated-fill-rejected',()=>vault.settle.staticCall(fp.contractProof,fp.publicSignals),/RECEIPT/);
      // Proof arithmetic alone cannot authenticate a receipt: controller must.
      await rpc.send('evm_increaseTime',[901]);await rpc.send('evm_mine',[]);
    }
    const sp=await prove('settle-'+batch,settlement);
    await send('settle-'+batch,vault.connect(relayer).settle(sp.contractProof,sp.publicSignals,{gasLimit:1000000}));state=settlement.next;
    assert.equal(await vault.root(),prover.root(state));assert.equal(await vault.pending(),false);assert.equal(await vault.settledCursor(),batch);
    assert.deepEqual(state.books[1-selected],other);good('other-book-unchanged-'+batch);
    assert.equal(state.books[0][0]+state.books[1][0],await cash.balanceOf(context.vault));
    assert.equal(state.books[0][1]+state.books[1][1],await asset.balanceOf(context.vault));
    await reject('settlement-replay-'+batch,()=>vault.settle.staticCall(sp.contractProof,sp.publicSignals),/PHASE/);
    if(batch===1n)good('settlement-after-order-expiry');
  }
  await reject('stale-authorization-proof',()=>vault.authorizeAndExecute.staticCall(firstProof.contractProof,firstProof.publicSignals),/PHASE|EXPIRED|STALE_ROOT/);
  assert.equal(await cash.allowance(context.vault,policy.router),0n);assert.equal(await asset.allowance(context.vault,policy.router),0n);
  good('zero-residual-dex-allowance');good('four-fills-consumed-in-order');
  evidence.finalRoot=String(prover.root(state));evidence.settledCursor=String(await vault.settledCursor());
  evidence.finalBalances={cash:String(await cash.balanceOf(context.vault)),asset:String(await asset.balanceOf(context.vault))};
  evidence.status='PASS_LOCAL_ZK_FORK_ONLY';evidence.createdAt=new Date().toISOString();
  evidence.maxRssMiB=Math.ceil(process.resourceUsage().maxRSS/1024);
  writeFileSync('docs/evidence/zk-book-fork.json',json(evidence)+'\n');
  console.log(json({status:evidence.status,checks:evidence.checks.length,proofs:evidence.proofs.length,transactions:evidence.transactions.length,evidence:'docs/evidence/zk-book-fork.json'}));
}finally{rpc.destroy();}
