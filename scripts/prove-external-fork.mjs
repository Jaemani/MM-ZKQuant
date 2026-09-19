import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, parseEther, keccak256 } from 'ethers';
import { compileApprovedVault, ERC20, hash, approvalDigest, domain, TYPES } from '../src/integration/protocol.js';
import { ConfidentialCoordinator, INITIAL_CHECKPOINT } from '../src/integration/coordinator.js';
import { SealedStore } from '../src/integration/sealed.js';
import { canonicalJson } from '../src/shared/protocol.js';

const rpcUrl=process.env.MM_FORK_RPC||'http://127.0.0.1:18545';
const url=new URL(rpcUrl);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Proof broadcasts only to a loopback Anvil fork');
const rpc=new JsonRpcProvider(rpcUrl,undefined,{batchMaxCount:1,cacheTimeout:-1});rpc.pollingInterval=100;
const evidence={mode:'MONAD_MAINNET_FORK',hardwareTEE:false,externalNetworkBroadcast:false,checks:[],transactions:[],limitations:['Software approval signer for this run; real TEE pending','Local fork receipts are not mainnet transactions','Only spot, flat-state allocations/redemptions, zero performance fees','No credited-fund key-loss recovery']};
const dir=mkdtempSync(join(tmpdir(),'mm-external-proof-')),secret=randomBytes(32),path=join(dir,'sealed.json');
try {
  const info=await rpc.send('anvil_nodeInfo',[]);
  assert.equal(Number((await rpc.getNetwork()).chainId),31337);assert.ok(info.forkConfig?.forkUrl,'A real remote-state fork is required');
  const origin=new JsonRpcProvider(info.forkConfig.forkUrl,undefined,{batchMaxCount:1});
  try {assert.equal(Number((await origin.getNetwork()).chainId),143);evidence.forkBlock=info.forkConfig.forkBlockNumber;evidence.forkBlockHash=(await origin.getBlock(evidence.forkBlock)).hash;} finally{origin.destroy();}
  const deployer=await rpc.getSigner(0),a=await rpc.getSigner(1),b=await rpc.getSigner(2),operator=await rpc.getSigner(3);
  const providerA=Wallet.createRandom(),providerB=Wallet.createRandom(),approvalKey=Wallet.createRandom();
  const policy={cash:'0x754704Bc059F8C67012fEd69BC8A327a5aafb603',asset:'0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',router:'0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40',quoter:'0x661e93cca42afacb172121ef892830ca3b70f08d',fee:500,slippageBps:50,performanceFeeBps:0,maxTargetBps:2500,strategies:[{id:'alpha-a',provider:providerA.address},{id:'alpha-b',provider:providerB.address}]};
  evidence.contractCodeHashes={};for(const [k,v] of Object.entries(policy).filter(([k])=>['cash','asset','router','quoter'].includes(k))){const code=await rpc.getCode(v);assert.ok(code.length>2,`Missing ${k} code`);evidence.contractCodeHashes[k]={address:v,codeHash:keccak256(code)};}
  const factory=new Contract('0x204faca1764b154221e35c0d20abb3c525710498',['function getPool(address,address,uint24) view returns(address)'],rpc);
  evidence.pool=await factory.getPool(policy.cash,policy.asset,policy.fee);
  const pool=new Contract(evidence.pool,['function liquidity() view returns(uint128)'],rpc);assert.ok(await pool.liquidity()>0n);evidence.poolLiquidity=String(await pool.liquidity());
  const send=async(label,promise)=>{const receipt=await (await promise).wait();assert.equal(receipt.status,1);evidence.transactions.push({label,hash:receipt.hash,block:receipt.blockNumber,gasUsed:String(receipt.gasUsed)});return receipt;};
  // Obtain cash by swapping freshly wrapped local-fork native balance through
  // the actual external router. No USDC storage edits or impersonated holders.
  const wmon=new Contract(policy.asset,[...ERC20,'function deposit() payable'],deployer),cash=new Contract(policy.cash,ERC20,deployer);
  assert.equal(Number(await wmon.decimals()),18);assert.equal(Number(await cash.decimals()),6);
  await send('wrap-local-fork-MON',wmon.deposit({value:parseEther('100')}));
  await send('funding-allowance',wmon.approve(policy.router,parseEther('100')));
  const router=new Contract(policy.router,['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)'],deployer);
  await send('funding-external-swap',router.exactInputSingle([policy.asset,policy.cash,500,await deployer.getAddress(),(await rpc.getBlock('latest')).timestamp+300,parseEther('100'),1,0]));
  const available=await cash.balanceOf(await deployer.getAddress()),allocation=available/4n;assert.ok(allocation>1000n,'Insufficient real pool output');
  for(const w of [a,b])await send('fund-test-investor',cash.transfer(await w.getAddress(),allocation));
  const bBalanceBefore=await cash.balanceOf(await b.getAddress());
  const artifact=compileApprovedVault();evidence.contractSourceHash=artifact.sourceHash;
  const vault=await new ContractFactory(artifact.abi,artifact.bytecode,deployer).deploy(approvalKey.address,policy.cash,policy.asset,policy.router,policy.fee,hash(policy),INITIAL_CHECKPOINT);await vault.waitForDeployment();evidence.vault=await vault.getAddress();
  const config={chainId:31337,vault:evidence.vault,policy};
  const make=()=>new ConfidentialCoordinator({provider:rpc,wallet:approvalKey,store:new SealedStore(path,secret,hash(config)),config});let runtime=await make().initialize();
  const envelope=async(wallet,type,strategyId,data={})=>{
    const payload={domain:'MM_CONFIDENTIAL_POC_V1',chainId:31337,vault:evidence.vault,signer:await wallet.getAddress(),nonce:'0x'+randomBytes(32).toString('hex'),deadline:(await rpc.getBlock('latest')).timestamp+300,type,strategyId,...data};
    return {payload,signature:await wallet.signMessage(canonicalJson(payload))};
  };
  const apply=async(label,e)=>{const p=await runtime.command(e);assert.equal(await vault.approvalHash(p.approval),approvalDigest(runtime.context,p.approval));await send(label,vault.connect(operator).executeApproved(p.approval,p.signature,{gasLimit:1000000}));await runtime.recover();return p;};
  const reject=async(label,fn,pattern)=>{await assert.rejects(fn,pattern);evidence.checks.push({name:label,passed:true});};
  let first;
  for(const [wallet,id] of [[a,'alpha-a'],[b,'alpha-b']]){
    const e=await envelope(wallet,'ALLOCATE',id,{amount:String(allocation)}),depositId=hash({actor:await wallet.getAddress(),nonce:e.payload.nonce});
    await send('deposit-allowance',cash.connect(wallet).approve(evidence.vault,allocation));
    await send('deposit-'+id,vault.connect(wallet).deposit(depositId,allocation));
    const p=await apply('credit-'+id,e);first||=p;
  }
  const bBefore=structuredClone(runtime.state.strategies[1]),rollbackCopy=readFileSync(path);
  const wrongProvider=await envelope(providerB,'TARGET','alpha-a',{targetBps:2500});await reject('provider-isolation',()=>runtime.command(wrongProvider),/Wrong provider/);
  const buy=await envelope(providerA,'TARGET','alpha-a',{targetBps:2500}),pending=await runtime.command(buy);
  const changed={...pending.approval,recipient:await operator.getAddress()};await reject('tampered-recipient',()=>vault.executeApproved.staticCall(changed,pending.signature),/SIGNER/);
  const operatorSig=await operator.signTypedData(domain(31337,evidence.vault,hash(policy)),TYPES,pending.approval);
  await reject('operator-cannot-authorize',()=>vault.executeApproved.staticCall(pending.approval,operatorSig),/SIGNER/);
  const adversarial=async(name,overrides,pattern)=>{const approval={...pending.approval,...overrides},signature=await approvalKey.signTypedData(domain(31337,evidence.vault,hash(policy)),TYPES,approval);await reject(name,()=>vault.executeApproved.staticCall(approval,signature),pattern);};
  await adversarial('expired-approval',{deadline:1},/EXPIRED/);
  await adversarial('cannot-spend-unaccounted-funds',{amount:String(await vault.cashAccounted()+1n)},/ACCOUNTED_BALANCE/);
  await adversarial('minimum-output-enforced',{minOut:String(2n**200n)},/Too little received/);
  await adversarial('approved-swap-cannot-pay-third-party',{recipient:await operator.getAddress()},/SWAP/);
  const wrongDomainSignature=await approvalKey.signTypedData(domain(143,evidence.vault,hash(policy)),TYPES,pending.approval);
  await reject('cross-chain-signature-rejected',()=>vault.executeApproved.staticCall(pending.approval,wrongDomainSignature),/SIGNER/);
  const crashWrite=runtime.store.write.bind(runtime.store);runtime.store.write=value=>{if(value.sequence===3)throw Error('Injected disk failure after fill');crashWrite(value);};
  await send('buy-alpha-a',vault.connect(operator).executeApproved(pending.approval,pending.signature,{gasLimit:1000000}));
  await reject('injected-crash-after-fill',()=>runtime.recover(),/Injected disk failure/);
  runtime=await make().initialize();assert.equal(runtime.state.sequence,3);assert.deepEqual(runtime.state.strategies[1],bBefore);evidence.checks.push({name:'restart-applies-exactly-once-and-preserves-B',passed:true});
  await reject('client-replay',()=>runtime.command(buy),/Client replay/);
  await reject('chain-replay',()=>vault.executeApproved.staticCall(pending.approval,pending.signature),/STALE_STATE/);
  const depositWhileOpen=await envelope(a,'ALLOCATE','alpha-a',{amount:'1'});await reject('reject-priced-deposit-while-open',()=>runtime.command(depositWhileOpen),/only when strategy is flat/);
  await apply('sell-alpha-a',await envelope(providerA,'TARGET','alpha-a',{targetBps:0}));
  assert.deepEqual(runtime.state.strategies[1],bBefore);
  await apply('redeem-alpha-b',await envelope(b,'REDEEM','alpha-b'));
  assert.equal(await cash.balanceOf(await b.getAddress()),bBalanceBefore);
  await apply('redeem-alpha-a',await envelope(a,'REDEEM','alpha-a'));
  assert.equal(await vault.cashAccounted(),0n);assert.equal(await vault.assetAccounted(),0n);
  assert.equal(await cash.balanceOf(evidence.vault),0n);assert.equal(await wmon.balanceOf(evidence.vault),0n);
  assert.equal(await cash.allowance(evidence.vault,policy.router),0n);assert.equal(await wmon.allowance(evidence.vault,policy.router),0n);
  evidence.checks.push({name:'full-external-swap-cycle-and-zero-residual-allowances',passed:true});
  const stalePath=join(dir,'rolled-back.json');writeFileSync(stalePath,rollbackCopy);
  const stale=new ConfidentialCoordinator({provider:rpc,wallet:approvalKey,store:new SealedStore(stalePath,secret,hash(config)),config});
  await reject('encrypted-old-state-rejected',()=>stale.initialize(),/Rollback or competing instance/);
  assert.equal(readFileSync(path,'utf8').includes('alpha-a'),false);evidence.checks.push({name:'disk-does-not-contain-plaintext-ledger',passed:true});
  evidence.reconciliation=await runtime.reconcile();evidence.trace=runtime.state.history;evidence.finalSequence=runtime.state.sequence;
  evidence.policyHash=hash(policy);evidence.signer=approvalKey.address;
  evidence.vaultCodeHash=keccak256(await rpc.getCode(evidence.vault));
  evidence.status='PASS_FORK_ONLY';evidence.createdAt=new Date().toISOString();
  const output=resolve('docs/evidence/external-fork.json');mkdirSync(resolve('docs/evidence'),{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({status:evidence.status,checks:evidence.checks,transactions:evidence.transactions.length,evidence:output},null,2));
}finally{rpc.destroy();}
