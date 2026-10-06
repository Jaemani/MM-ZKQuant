import { Contract,ContractFactory,getCreateAddress } from 'ethers';
import { markVenueEquity } from './ledger.mjs';

const n=x=>BigInt(x||0);
const sameSide=(a,b)=>a===0n||b===0n||(a>0n)===(b>0n);
export const sharedAccountAbi=[
  'function accountId() view returns(uint256)',
  'function marketCount() view returns(uint256)',
  'function tradedMarkets(uint256) view returns(uint256)',
  'function executeDelta(bytes32,uint256,int256,int256,uint256,uint256,uint256)',
  'function fundFromBalance(uint256)',
  'function recoverToVault(uint256)',
];
const scale=info=>10n**(n(info.priceDecimals)+n(info.lotDecimals));
const value=(qty,price,info)=>qty*price*1000000n/scale(info);
const totalQty=(pool,market,exclude)=>Object.entries(pool.claims).reduce((sum,[id,c])=>sum+(id===exclude?0n:n(c.quantities[market])),0n);
const compatible=(pool,market,bookId,target)=>Object.entries(pool.claims).every(([id,c])=>id===bookId||sameSide(n(c.quantities[market]),target));
export function claim(pool,bookId) {return pool.claims[bookId]||={equity:'0',quantities:{}};}

// Prefer reuse, including across markets. Opposing strategies never net: they
// receive distinct accounts only for the conflicting market.
export function selectSharedAccount(state,book,market,target) {
  const pools=Object.values(state.sharedAccounts||{});
  const current=book.slots[market];
  const candidates=pools.filter(p=>compatible(p,market,book.id,n(target)));
  candidates.sort((a,b)=>{
    const rank=p=>p.address===current?3:p.claims[book.id]?2:1;
    return rank(b)-rank(a)||a.address.localeCompare(b.address);
  });
  return candidates[0]||null;
}

function distribute(pool,amount,weights) {
  const owners=Object.entries(weights).filter(([,w])=>n(w)>0n),total=owners.reduce((sum,[,w])=>sum+n(w),0n);
  if(!amount)return;
  if(!total)throw Error('SHARED_ACCOUNT_RECONCILIATION_REQUIRED');
  let remaining=amount;
  owners.forEach(([id,w],index)=>{const share=index===owners.length-1?remaining:amount*n(w)/total;remaining-=share;claim(pool,id).equity=String(n(claim(pool,id).equity)+share);});
}

export function checkpointSharedAccount(pool,snapshot,{actor=null,market=null}={}) {
  const before=pool.checkpoint||{equity:'0',markets:{}};
  const working=structuredClone(pool);
  let attributed=0n;
  for(const [m,current] of Object.entries(snapshot.markets)) {
    const prior=before.markets[m];
    const expected=totalQty(pool,m);
    if((actor===null||String(m)!==String(market))&&n(current.qty)!==expected)throw Error('SHARED_ACCOUNT_POSITION_MISMATCH');
    if(!prior)continue;
    const funding=actor!==null&&String(m)===String(market)?0n:n(current.premium)-n(prior.premium);
    const weights={};
    for(const [id,c] of Object.entries(pool.claims)) {
      const qty=n(c.quantities[m]);
      const pnl=value(qty,n(current.mark)-n(prior.mark),current.info);
      claim(working,id).equity=String(n(claim(working,id).equity)+pnl);attributed+=pnl;
      weights[id]=String(qty<0n?-qty:qty);
    }
    if(funding){distribute(working,funding,weights);attributed+=funding;}
  }
  const remainder=n(snapshot.equity)-n(before.equity)-attributed;
  if(actor!==null)claim(working,actor).equity=String(n(claim(working,actor).equity)+remainder);
  else if(remainder) {
    // Material unexplained changes (liquidation, external settlement, or a
    // foreign transaction) must never silently move another strategy's money.
    const tolerance=BigInt(Math.max(1,Object.keys(snapshot.markets).length*Object.keys(pool.claims).length))*2n;
    if(remainder>tolerance||remainder< -tolerance)throw Error('SHARED_ACCOUNT_RECONCILIATION_REQUIRED');
    distribute(working,remainder,Object.fromEntries(Object.entries(pool.claims).map(([id,c])=>[id,c.equity])));
  }
  if(Object.values(working.claims).some(c=>n(c.equity)<0n))throw Error('SHARED_ACCOUNT_CAPITAL_EXHAUSTED');
  pool.claims=working.claims;pool.checkpoint=snapshot;
}

export class SharedAccounts {
  constructor(execution,{nativeCreate=true,artifact}={}){this.execution=execution;this.nativeCreate=nativeCreate;this.artifact=artifact;}
  account(address){return new Contract(address,sharedAccountAbi,this.execution.wallet);}
  async read(pool,blockTag) {
    const e=this.execution,account=this.account(pool.address),accountId=await account.accountId({blockTag});
    const walletCash=pool.tokenAddress?await new Contract(pool.tokenAddress,['function balanceOf(address) view returns(uint256)'],e.provider).balanceOf(pool.address,{blockTag}):0n;
    if(!accountId)return {accountId:'0',equity:String(walletCash),free:'0',walletCash:String(walletCash),markets:{}};
    const a=await e.exchange.getAccountByAddr(pool.address,{blockTag}),markets={};
    // Include every on-chain market, even if no current book references it.
    const count=Number(await account.marketCount({blockTag}));
    for(let i=0;i<count;i++) {
      const market=Number(await account.tradedMarkets(i,{blockTag}));
      const [info,[p,mark,valid]]=await Promise.all([e.exchange.getPerpetualInfoV2(market,{blockTag}),e.exchange.getPositionV2(market,accountId,{blockTag})]);
      if(!valid&&p.lotLNS>0n)throw Error('STALE_VENUE_PRICE');
      markets[market]={qty:String(p.positionType===0n?p.lotLNS:-p.lotLNS),mark:String(mark||info.markPNS),premium:String(p.premiumPnlCNS),deposit:String(p.depositCNS),deltaPnl:String(p.deltaPnlCNS),info:{markPNS:String(info.markPNS),priceDecimals:String(info.priceDecimals),lotDecimals:String(info.lotDecimals)}};
    }
    const equity=walletCash+a.balanceCNS+a.lockedBalanceCNS+Object.values(markets).reduce((sum,p)=>sum+n(p.deposit)+n(p.deltaPnl)+n(p.premium),0n);
    return {accountId:String(accountId),equity:String(equity),free:String(a.balanceCNS),walletCash:String(walletCash),markets};
  }
  async refresh(state,blockTag,bookId=null) {
    const updates=[];
    for(const pool of Object.values(state.sharedAccounts||{})){if(bookId!==null&&!pool.claims[bookId])continue;const copy=structuredClone(pool);checkpointSharedAccount(copy,await this.read(pool,blockTag));updates.push(copy);}
    for(const pool of updates)Object.assign(state.sharedAccounts[pool.address],pool);
    this.execution.save(state);
  }
  free(state,pool,book) {
    const available={};
    for(const [id,c] of Object.entries(pool.claims)) {
      let reserved=0n;
      for(const [m,q] of Object.entries(c.quantities)) {
        const p=pool.checkpoint?.markets[m];if(!p||!n(q))continue;
        const qty=n(q),notional=value(qty<0n?-qty:qty,n(p.mark),p.info);
        reserved+=notional*11000n/BigInt(state.books[id].policy.maxLeverageBps);
      }
      const amount=n(c.equity)-reserved;available[id]=amount>0n?amount:0n;
    }
    const total=Object.values(available).reduce((sum,a)=>sum+a,0n),actual=n(pool.checkpoint?.free)+n(pool.checkpoint?.walletCash);
    return total>actual&&total?available[book.id]*actual/total:available[book.id]||0n;
  }
  observations(state,book) {
    const observations=[];
    for(const pool of Object.values(state.sharedAccounts||{})) {
      const c=pool.claims[book.id];if(!c)continue;
      const markets=Object.keys(c.quantities).filter(m=>n(c.quantities[m])||book.slots[m]===pool.address),free=this.free(state,pool,book);
      // Account equity and free collateral appear once, avoiding double-counting
      // a shared multi-market account in a strategy's NAV or withdrawal.
      let equityLeft=n(c.equity)-free;
      const weights=Object.fromEntries(markets.map(m=>[m,n(c.quantities[m])<0n?-n(c.quantities[m]):n(c.quantities[m])]));
      const total=Object.values(weights).reduce((sum,w)=>sum+w,0n);
      if(!markets.length){observations.push({address:pool.address,market:0,qty:0n,free,equity:n(c.equity),accountId:n(pool.checkpoint?.accountId),mark:0n,info:{markPNS:0n,priceDecimals:0,lotDecimals:0}});continue;}
      markets.forEach((m,index)=>{
        const p=pool.checkpoint?.markets[m],equity=index===markets.length-1?equityLeft:total?(n(c.equity)-free)*weights[m]/total:0n;equityLeft-=equity;
        observations.push({address:pool.address,market:Number(m),qty:n(c.quantities[m]),free:index===0?free:0n,equity:equity+(index===0?free:0n),accountId:n(pool.checkpoint?.accountId),mark:n(p?.mark),info:{markPNS:n(p?.info.markPNS),priceDecimals:n(p?.info.priceDecimals),lotDecimals:n(p?.info.lotDecimals)}});
      });
    }
    return observations;
  }
  async observeBook(state,book,options) {
    await this.refresh(state,await this.execution.provider.getBlockNumber(),book.id);
    const values=this.observations(state,book);
    markVenueEquity(book,n(book.cash)+values.reduce((sum,p)=>sum+p.equity,0n)-n(book.feesDue),options);
    return values;
  }
  async observation(state,book,market,blockTag) {
    await this.refresh(state,blockTag,book.id);
    const address=book.slots[market],pool=state.sharedAccounts[address];
    const observation=this.observations(state,book).find(p=>p.address===address&&p.market===Number(market));
    if(!observation)throw Error('SHARED_ACCOUNT_RECONCILIATION_REQUIRED');
    observation.info=await this.execution.exchange.getPerpetualInfoV2(market,{blockTag});
    observation.mark=n(pool.checkpoint.markets[market]?.mark||observation.info.markPNS);
    return observation;
  }
  async allocate(state,book,market,target,job) {
    let pool=selectSharedAccount(state,book,market,target);
    if(!pool) {
      const e=this.execution,vault=e.vault(state);
      job.sharedCreations||={};
      let address;
      if(this.nativeCreate){
        if(job.sharedCreations[market]===undefined){job.sharedCreations[market]=Number(await vault.accountCount());e.save(state);}
        const index=job.sharedCreations[market];
        await e.step(state,job,`shared-pool-${market}`,await vault.createSharedAccounts.populateTransaction(1));
        // Persisting the index before creation makes recovery independent of
        // later account creations or a crash before saving the pool mapping.
        const after=Number(await vault.accountCount());
        if(after<=index)throw Error('SHARED_ACCOUNT_CREATION_UNCONFIRMED');
        address=await vault.accounts(index);
      }else{
        const factory=new ContractFactory(this.artifact.abi,this.artifact.bytecode,e.wallet);
        const request=await factory.getDeployTransaction('0x1964C32f0bE608E7D29302AFF5E61268E72080cc',state.config.cashTokenAddress,state.config.vaultAddress,e.wallet.address);
        const step=await e.step(state,job,`shared-pool-${market}`,request);
        const record=e.submitter.lookup(step.id);
        if(record?.nonce===undefined)throw Error('SHARED_ACCOUNT_CREATION_UNCONFIRMED');
        address=getCreateAddress({from:e.wallet.address,nonce:record.nonce});
      }
      pool=state.sharedAccounts[address]||={address,tokenAddress:state.config?.cashTokenAddress,claims:{},checkpoint:{accountId:'0',equity:'0',free:'0',walletCash:'0',markets:{}}};
    }
    claim(pool,book.id).quantities[market]||='0';book.slots[market]=pool.address;this.execution.save(state);return pool.address;
  }
  funding(state,book,market,target,marketInfo) {
    const pool=state.sharedAccounts[book.slots[market]],c=claim(pool,book.id);
    let needed=0n;
    for(const [m,q] of Object.entries(c.quantities)) {
      const p=pool.checkpoint.markets[m];if(!p&&String(m)!==String(market))continue;
      const qty=String(m)===String(market)?target:n(q),info=p?.info||marketInfo;
      if(info)needed+=value(qty<0n?-qty:qty,n(p?.mark||info.markPNS),info)*11000n/BigInt(book.policy.maxLeverageBps);
    }
    return needed>n(c.equity)?needed-n(c.equity):0n;
  }
  async applyEffect(state,effect,result) {
    const e=this.execution,original=state.sharedAccounts[effect.address],pool=structuredClone(original),c=claim(pool,effect.bookId),book=state.books[effect.bookId];
    if(effect.kind==='SHARED_FUND'||effect.kind==='SHARED_RECOVER'||effect.kind==='SHARED_ADMIT_CASH') {
      const amount=n(effect.amount),delta=effect.kind==='SHARED_FUND'?amount:effect.kind==='SHARED_RECOVER'?-amount:0n;
      c.equity=String(n(c.equity)+delta);
      pool.checkpoint.equity=String(n(pool.checkpoint.equity)+delta);pool.checkpoint.free=String(n(pool.checkpoint.free)+delta);
      const receipt=await e.provider.getTransactionReceipt(result.hash);
      if(!receipt||receipt.status!==1)throw Error('PENDING_RECONCILE_REQUIRED');
      checkpointSharedAccount(pool,await this.read(pool,receipt.blockNumber),{actor:book.id});
      Object.assign(original,pool);book.cash=String(n(book.cash)-delta);
      if(delta)ledgerEvent(book,'VENUE',{delta:String(-delta),txHash:result.hash});
      return;
    }
    const receipt=await e.provider.getTransactionReceipt(result.hash);
    if(!receipt||receipt.status!==1)throw Error('PENDING_RECONCILE_REQUIRED');
    const after=await this.read(pool,receipt.blockNumber),before=n(effect.before),qty=n(after.markets[effect.market]?.qty),filled=qty-before;
    if(filled&&(filled>0n)!==(n(effect.delta)>0n)|| (filled<0n?-filled:filled)>(n(effect.delta)<0n?-n(effect.delta):n(effect.delta)))throw Error('SHARED_ACCOUNT_POSITION_MISMATCH');
    checkpointSharedAccount(pool,after,{actor:book.id,market:effect.market});
    claim(pool,book.id).quantities[effect.market]=String(n(effect.ownedBefore)+filled);
    Object.assign(original,pool);
    if(filled)effect.hasFill=true;
  }
  async admitWalletCash(state,book,job,market) {
    if(this.nativeCreate)return;
    const pool=state.sharedAccounts[book.slots[market]],amount=n(pool.checkpoint.walletCash);
    if(!amount)return;
    await this.execution.step(state,job,`admit-cash-${market}`,await this.account(pool.address).fundFromBalance.populateTransaction(amount),{kind:'SHARED_ADMIT_CASH',bookId:book.id,address:pool.address,amount:String(amount)});
  }
  async trade(state,book,job,market,target,label,opaque) {
    const e=this.execution,pool=state.sharedAccounts[book.slots[market]];if(!pool)return;
    await this.refresh(state,await e.provider.getBlockNumber(),book.id);
    const owned=n(claim(pool,book.id).quantities[market]);if(owned===target)return;
    if(Math.floor(Date.now()/1000)>=job.deadline)throw Error('ORDER_EXPIRED');
    if(!compatible(pool,market,book.id,target))throw Error('SHARED_ACCOUNT_DIRECTION_CONFLICT');
    const observed=pool.checkpoint.markets[market];
    const info=observed?.info||await e.exchange.getPerpetualInfoV2(market);
    const before=totalQty(pool,market),delta=target-owned,mark=n(observed?.mark||info.markPNS),buy=delta>0n;
    const price=buy?mark*BigInt(10000+book.policy.slippageBps)/10000n:mark*BigInt(10000-book.policy.slippageBps)/10000n;
    const effect={kind:'SHARED_TRADE',bookId:book.id,address:pool.address,market,before:String(before),ownedBefore:String(owned),delta:String(delta)};
    const result=await e.step(state,job,label,await this.account(pool.address).executeDelta.populateTransaction(opaque(`${job.id}:${label}`),market,before,delta,price,job.deadline,Math.ceil(book.policy.maxLeverageBps/100)),effect);
    if(result.effect?.hasFill)job.hasFill=true;
  }
  async recover(state,book,job,label,opaque) {
    await this.refresh(state,await this.execution.provider.getBlockNumber(),book.id);
    for(const pool of Object.values(state.sharedAccounts)) {
      if(!pool.claims[book.id])continue;
      const amount=this.free(state,pool,book);if(amount<10000n)continue;
      const request=this.nativeCreate?await this.execution.vault(state).recoverSlot.populateTransaction(pool.address,amount,opaque(`${job.id}:${label}:${pool.address}`)):await this.account(pool.address).recoverToVault.populateTransaction(amount);
      await this.execution.step(state,job,`${label}-${pool.address}`,request,{kind:'SHARED_RECOVER',bookId:book.id,address:pool.address,amount:String(amount)});
    }
  }
}
import {ledgerEvent} from './ledger-journal.mjs';
