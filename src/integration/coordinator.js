import { randomBytes } from 'node:crypto';
import { Contract, getAddress, verifyMessage } from 'ethers';
import { canonicalJson } from '../shared/protocol.js';
import { hash, domain, TYPES, approvalDigest, nextCheckpoint, compileApprovedVault } from './protocol.js';

const integer=(value)=>{if(!/^(0|[1-9][0-9]*)$/.test(String(value)))throw Error('Expected unsigned integer');return BigInt(value);};
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const INITIAL_CHECKPOINT=hash('MM_APPROVED_VAULT_GENESIS_V1');
// First external-venue experiment deliberately accepts deposits/redemptions only
// while the selected strategy is flat. There is no manipulable NAV oracle here.
// Performance fees, lending and general rebalancing are not claimed by this PoC.
export class ConfidentialCoordinator {
  constructor({provider,wallet,store,config}) {
    this.provider=provider;this.wallet=wallet;this.store=store;this.config=config;this.queue=Promise.resolve();
    this.vault=new Contract(config.vault,compileApprovedVault().abi,provider);
    this.context={chainId:config.chainId,vault:config.vault,policyHash:hash(config.policy)};
    this.state=store.read()||{version:1,sequence:0,checkpoint:INITIAL_CHECKPOINT,salt:randomBytes(32).toString('hex'),used:[],history:[],pending:null,
      strategies:config.policy.strategies.map(s=>({id:s.id,provider:getAddress(s.provider),cash:'0',asset:'0',units:'0',investors:{}}))};
    if(!store.read())store.write(this.state);
  }
  exclusive(work){const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;}
  async initialize(){
    const c=this.config;
    requireThat(Number((await this.provider.getNetwork()).chainId)===c.chainId,'Wrong chain');
    requireThat((await this.vault.signer())===this.wallet.address,'Wrong approval key');
    requireThat((await this.vault.policyHash())===hash(c.policy),'Wrong policy');
    for(const field of ['cash','asset','router'])requireThat((await this.vault[field]()).toLowerCase()===c.policy[field].toLowerCase(),'Wrong '+field);
    requireThat(Number(await this.vault.fee())===c.policy.fee,'Wrong fee');
    requireThat(c.policy.performanceFeeBps===0&&c.policy.maxTargetBps===2500&&c.policy.slippageBps>0&&c.policy.slippageBps<=100,'Unsupported policy');
    requireThat(c.policy.strategies.length===2&&new Set(c.policy.strategies.map(s=>s.id)).size===2,'Exactly two distinct strategies required');
    await this.recover();return this;
  }
  async head(){
    const b=await this.provider.getBlock(this.config.chainId===31337?'latest':'finalized');
    requireThat(b,'Missing finalized head');return b;
  }
  async chainState(){const b=await this.head();return {block:b,sequence:Number(await this.vault.sequence({blockTag:b.number})),checkpoint:await this.vault.checkpoint({blockTag:b.number})};}
  async reconcile(){
    const b=await this.head(),cash=this.state.strategies.reduce((n,s)=>n+BigInt(s.cash),0n),asset=this.state.strategies.reduce((n,s)=>n+BigInt(s.asset),0n);
    requireThat(cash===await this.vault.cashAccounted({blockTag:b.number})&&asset===await this.vault.assetAccounted({blockTag:b.number}),'Custody accounting mismatch');
    for(const s of this.state.strategies)requireThat(Object.values(s.investors).reduce((n,x)=>n+BigInt(x),0n)===BigInt(s.units),'Investor units mismatch');
    return {cash:String(cash),asset:String(asset),balanced:true};
  }
  async recover(){
    const current=await this.chainState(),pending=this.state.pending;
    if(current.sequence===this.state.sequence){
      requireThat(current.checkpoint===this.state.checkpoint,'Checkpoint mismatch');
      if(pending&&current.block.timestamp>pending.approval.deadline){this.state.pending=null;this.store.write(this.state);}
      await this.reconcile();return;
    }
    requireThat(pending&&current.sequence===this.state.sequence+1,'Rollback or competing instance detected; stop');
    const events=await this.vault.queryFilter(this.vault.filters.Applied(pending.approval.sequence,pending.approval.requestId),pending.fromBlock,current.block.number);
    requireThat(events.length===1,'Missing unique finalized receipt');
    const e=events[0],digest=approvalDigest(this.context,pending.approval),out=e.args.amountOut;
    requireThat(e.args.approvalHash===digest&&e.args.checkpoint===current.checkpoint&&nextCheckpoint(this.state.checkpoint,digest,out)===current.checkpoint,'Receipt binding mismatch');
    const next=structuredClone(this.state),s=next.strategies.find(s=>s.id===pending.strategyId),a=pending.approval;
    if(a.kind===0){s.cash=String(BigInt(s.cash)+BigInt(a.amount));s.units=String(BigInt(s.units)+BigInt(pending.units));s.investors[pending.actor]=String(BigInt(s.investors[pending.actor]||0)+BigInt(pending.units));}
    if(a.kind===1){if(pending.buy){s.cash=String(BigInt(s.cash)-BigInt(a.amount));s.asset=String(BigInt(s.asset)+out);}else{s.cash=String(BigInt(s.cash)+out);s.asset=String(BigInt(s.asset)-BigInt(a.amount));}}
    if(a.kind===2){s.cash=String(BigInt(s.cash)-BigInt(a.amount));s.units=String(BigInt(s.units)-BigInt(pending.units));delete s.investors[pending.actor];}
    next.sequence=current.sequence;next.checkpoint=current.checkpoint;next.used.push(pending.clientId);
    next.history.push({sequence:current.sequence,requestId:a.requestId,strategyId:s.id,approvalHash:digest,transactionHash:e.transactionHash,blockHash:e.blockHash,blockNumber:e.blockNumber,out:String(out),checkpoint:current.checkpoint});next.pending=null;
    // Persist the finalized receipt and economic state together. On restart a
    // pending intent is replayed from the same chain event, never guessed.
    this.state=next;await this.reconcile();this.store.write(next);
  }
  authenticate(envelope){
    const p=envelope?.payload;
    requireThat(p&&p.domain==='MM_CONFIDENTIAL_POC_V1'&&p.chainId===this.config.chainId&&p.vault.toLowerCase()===this.config.vault.toLowerCase(),'Client domain mismatch');
    requireThat(/^0x[0-9a-f]{64}$/i.test(p.nonce||''),'Invalid nonce');
    const actor=getAddress(verifyMessage(canonicalJson(p),envelope.signature));
    requireThat(actor===getAddress(p.signer),'Invalid client signer');return {p,actor,clientId:hash({actor,nonce:p.nonce})};
  }
  command(envelope){return this.exclusive(async()=>{
    await this.recover();const {p,actor,clientId}=this.authenticate(envelope),b=await this.head();
    requireThat(Number.isSafeInteger(p.deadline)&&p.deadline>=b.timestamp&&p.deadline<=b.timestamp+900,'Client expired');
    if(p.type==='VIEW')return {sequence:this.state.sequence,checkpoint:this.state.checkpoint,strategies:this.state.strategies.filter(s=>s.provider===actor||s.investors[actor]).map(s=>({id:s.id,...(s.provider===actor?{cash:s.cash,asset:s.asset,totalUnits:s.units}:{}),ownedUnits:s.investors[actor]||'0',redeemableCash:BigInt(s.asset)===0n&&BigInt(s.units)>0n?String(BigInt(s.cash)*BigInt(s.investors[actor]||0)/BigInt(s.units)):null})),balanced:(await this.reconcile()).balanced};
    requireThat(!this.state.used.includes(clientId),'Client replay');
    if(this.state.pending){requireThat(this.state.pending.clientId===clientId&&this.state.pending.envelopeHash===hash(envelope),'Another request is pending');return this.publicPending();}
    const s=this.state.strategies.find(s=>s.id===p.strategyId);requireThat(s,'Unknown strategy');
    const policy=this.config.policy;
    const approval={sequence:this.state.sequence+1,previous:this.state.checkpoint,requestId:clientId,intent:hash({state:this.state,envelope}),kind:0,tokenIn:policy.cash,amount:'0',minOut:'0',recipient:actor,deadline:Math.min(p.deadline,b.timestamp+180)};
    const pending={actor,clientId,strategyId:s.id,approval,envelopeHash:hash(envelope),fromBlock:b.number,units:'0'};
    if(p.type==='ALLOCATE'){
      requireThat(BigInt(s.asset)===0n,'Allocate only when strategy is flat');
      const d=await this.vault.deposits(clientId,{blockTag:b.number});requireThat(d.owner===actor&&!d.consumed&&d.amount>0n,'No matching uncredited deposit');
      requireThat(d.amount===integer(p.amount),'Deposit amount mismatch');approval.amount=String(d.amount);
      requireThat(BigInt(s.units)===0n||BigInt(s.cash)>0n,'Insolvent strategy');
      pending.units=String(BigInt(s.units)===0n?d.amount:d.amount*BigInt(s.units)/BigInt(s.cash));requireThat(BigInt(pending.units)>0n,'Dust units');
    }else if(p.type==='TARGET'){
      requireThat(actor===s.provider,'Wrong provider');requireThat(p.targetBps===0||p.targetBps===policy.maxTargetBps,'Unsupported target');
      pending.buy=p.targetBps>0;approval.kind=1;approval.recipient=this.config.vault;
      if(pending.buy){requireThat(BigInt(s.asset)===0n,'Already positioned');approval.amount=String(BigInt(s.cash)*BigInt(p.targetBps)/10000n);}
      else{approval.tokenIn=policy.asset;approval.amount=s.asset;}
      requireThat(BigInt(approval.amount)>0n,'Empty order');
      const quoter=new Contract(policy.quoter,['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)'],this.provider);
      const q=await quoter.quoteExactInputSingle.staticCall([approval.tokenIn,pending.buy?policy.asset:policy.cash,approval.amount,policy.fee,0],{blockTag:b.number});
      approval.minOut=String(q[0]*BigInt(10000-policy.slippageBps)/10000n);requireThat(BigInt(approval.minOut)>0n,'Dust quote');
    }else if(p.type==='REDEEM'){
      requireThat(BigInt(s.asset)===0n,'Redeem only when strategy is flat');
      const units=BigInt(s.investors[actor]||0);requireThat(units>0n,'No investor claim');
      approval.kind=2;pending.units=String(units);approval.amount=String(BigInt(s.cash)*units/BigInt(s.units));requireThat(BigInt(approval.amount)>0n,'Dust claim');
    }else throw Error('Unknown command');
    pending.signature=await this.wallet.signTypedData(domain(this.config.chainId,this.config.vault,this.context.policyHash),TYPES,approval);
    this.state.pending=pending;this.store.write(this.state);return this.publicPending();
  });}
  publicPending(){const p=this.state.pending;return {approval:p.approval,signature:p.signature};}
}
