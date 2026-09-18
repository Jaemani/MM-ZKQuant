import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Interface, Wallet, verifyMessage, ZeroHash, getAddress } from 'ethers';
import { atomicJson } from '../pilot/chain.js';
import { digest } from '../pilot/policy.js';
import { canonicalJson } from '../shared/protocol.js';
import { SleeveLedger, money, SCALE } from './ledger.js';
import { durableLocalChain } from './chain.js';

export const ASSETS=['BTC','ETH','MON','SOL'];
export const SIDE=['BUY','SELL','SHORT_OPEN','SHORT_CLOSE'];
const json=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));
const must=(ok,message)=>{if(!ok)throw new Error(message);};
const flat=s=>Object.values(s.positions).every(p=>BigInt(p.quantity)===0n)&&Object.keys(s.shorts).length===0;
export const localWallet=i=>new Wallet('0x'+(0x51+i).toString(16).repeat(32));
export async function signCommand(runtime,wallet,type,strategyId,data={}) {
  const payload={domain:'CONFIDENTIAL_ALPHA_V02',chainId:runtime.chain.chainId,vault:runtime.vault.address,signer:wallet.address,type,strategyId,data,nonce:'0x'+randomBytes(32).toString('hex'),expiresAt:Math.floor(Date.now()/1000)+300};
  return {payload,signature:await wallet.signMessage(canonicalJson(payload))};
}
export class OmnibusRuntime {
  static async local(directory) {return this.create(await durableLocalChain(directory&&join(directory,'evm-journal.json')),directory);}
  static async create(chain,directory) {
    const r=new OmnibusRuntime();r.chain=chain;r.directory=directory;r.path=directory&&join(directory,'private-ledger.json');r.queue=Promise.resolve();
    r.cash=await chain.deploy('sleeve-cash','SleeveToken',['Test USD','tUSD']);r.tokens=[];
    for(const asset of ASSETS)r.tokens.push(await chain.deploy('sleeve-token-'+asset,'SleeveToken',['Test '+asset,'t'+asset]));
    r.venue=await chain.deploy('sleeve-venue','SleeveVenue',[r.cash.address,r.tokens.map(t=>t.address)]);
    r.vault=await chain.deploy('sleeve-vault','OmnibusVault',[r.cash.address,r.venue.address,r.tokens.map(t=>t.address)]);
    const tx=(tag,h,m,a,account=0)=>chain.tx(tag,h,m,a,account);
    await tx('seed-cash',r.cash,'mint',[chain.accounts[0],money(100000000)]);
    await tx('seed-cash-approval',r.cash,'approve',[r.venue.address,money(100000000)]);
    for(let i=0;i<4;i++){
      await tx('seed-token-'+i,r.tokens[i],'mint',[chain.accounts[0],money(2000000)]);
      await tx('seed-token-approval-'+i,r.tokens[i],'approve',[r.venue.address,money(2000000)]);
      await tx('seed-pool-'+i,r.venue,'seed',[i,money(10000000),money(100000)]);
      await tx('seed-lending-'+i,r.venue,'seedLending',[i,money(100000)]);
    }
    const investors=chain.environment==='LOCAL_EVM'?[1,2]:[0];
    for(const i of investors){await tx('investor-faucet-'+i,r.cash,'mint',[chain.accounts[i],money(200000)]);await tx('investor-approval-'+i,r.cash,'approve',[r.vault.address,money(200000)],i);}
    r.state=r.path&&existsSync(r.path)?JSON.parse(readFileSync(r.path)):null;
    if(!r.state){
      const ledger=new SleeveLedger();
      ledger.create({id:'btc-trend',provider:localWallet(3).address,name:'BTC 상승 전략',description:'해당 전략 자본만 사용하는 BTC 매수 전략'});
      ledger.create({id:'btc-hedge',provider:localWallet(4).address,name:'BTC 하락 전략',description:'해당 전략 담보로만 BTC를 차입·매도하는 전략'});
      ledger.create({id:'cash-reserve',provider:localWallet(3).address,name:'현금 유지 전략',description:'같은 제공자의 별도 현금 전략'});
      r.state={version:3,vault:r.vault.address,ledger:ledger.state,used:[],pending:null,receipts:[],track:[],frozen:null};r.save();
    }
    must(r.state.vault.toLowerCase()===r.vault.address.toLowerCase(),'Persisted vault mismatch');
    if(r.state.pending&&(!r.state.pending.externalAwait||r.state.pending.externalHash))await r.process(r.state.pending);
    if(!r.state.pending?.externalAwait)await r.reconcile();return r;
  }
  save(){if(this.path)atomicJson(this.path,this.state);}
  async marks(){const m={};for(let i=0;i<4;i++){const [cash]=await this.chain.read(this.venue,'cashReserves',[i]);const [qty]=await this.chain.read(this.venue,'assetReserves',[i]);m[ASSETS[i]]=cash*SCALE/qty;}return m;}
  async custody(ledger=this.state.ledger){
    const [cash]=await this.chain.read(this.cash,'balanceOf',[this.vault.address]);const positions={},shorts={};
    for(let i=0;i<4;i++)positions[ASSETS[i]]=String((await this.chain.read(this.tokens[i],'balanceOf',[this.vault.address]))[0]);
    for(const s of ledger.strategies)for(const [id,lot] of Object.entries(s.shorts))shorts[id]={asset:lot.asset,debt:String((await this.chain.read(this.venue,'shortDebt',[this.vault.address,id]))[0]),escrow:String((await this.chain.read(this.venue,'shortCollateral',[this.vault.address,id]))[0])};
    return {cash:String(cash),positions,shorts};
  }
  async reconcile(ledger=this.state.ledger){return new SleeveLedger(ledger).reconcile(await this.custody(ledger),await this.marks());}
  authenticate(envelope){
    const {payload:p,signature}=envelope||{};
    must(p&&p.domain==='CONFIDENTIAL_ALPHA_V02'&&p.chainId===this.chain.chainId&&p.vault?.toLowerCase()===this.vault.address.toLowerCase(),'Signature domain mismatch');
    must(Number.isInteger(p.expiresAt)&&p.expiresAt>=Math.floor(Date.now()/1000)&&p.expiresAt<=Math.floor(Date.now()/1000)+900,'Signature expired or excessive lifetime');
    must(/^0x[0-9a-f]{64}$/i.test(p.nonce),'Invalid nonce');
    must(verifyMessage(canonicalJson(p),signature).toLowerCase()===p.signer.toLowerCase(),'Invalid signature');
    return {...p,signer:getAddress(p.signer)};
  }
  submit(envelope){const work=this.queue.then(()=>this.submitLocked(envelope));this.queue=work.catch(()=>{});return work;}
  prepare(envelope){const work=this.queue.then(()=>this.submitLocked(envelope,true));this.queue=work.catch(()=>{});return work;}
  complete(envelope,transactionHash){
    const work=this.queue.then(async()=>{
      const plan=this.state.pending;must(plan?.externalAwait&&plan.hash===digest(envelope),'No matching pending deposit');
      must(/^0x[0-9a-f]{64}$/i.test(transactionHash),'Invalid deposit transaction');
      if(plan.externalHash)must(plan.externalHash===transactionHash,'Deposit hash cannot be replaced');
      const candidate={...plan,externalHash:transactionHash};
      await this.externalDeposit(candidate);this.state.pending=candidate;this.save();return this.process(candidate);
    });this.queue=work.catch(()=>{});return work;
  }
  async submitLocked(envelope,prepareOnly=false){
    const p=this.authenticate(envelope);if(prepareOnly)must(p.type==='ALLOCATE'&&!p.data.transactionHash,'Only new deposits can be prepared');
    const id=digest({signer:p.signer,nonce:p.nonce}),hash=digest(envelope);
    if(this.state.pending){must(this.state.pending.id===id&&this.state.pending.hash===hash,'Recovery pending: retry the original signed command');return this.process(this.state.pending);}
    must(!this.state.used.includes(id),'Replayed command');
    if(p.type==='ALLOCATE'&&p.data.transactionHash){
      const amount=money(p.data.amount),receipt=await this.externalDeposit({externalHash:p.data.transactionHash,p,id,amount:String(amount)}),event=this.event(receipt,'Deposit',id);
      must(event.investor===p.signer&&event.amount===amount,'Deposit attribution mismatch');
      const before=await this.custody();before.cash=String(BigInt(before.cash)-amount);
      new SleeveLedger(this.state.ledger).reconcile(before,await this.marks());
    }else await this.reconcile();
    if(p.type==='REGISTER'){
      must(/^[a-z][a-z0-9-]{2,63}$/.test(p.strategyId),'Invalid strategy ID');
      must(typeof p.data.name==='string'&&p.data.name.trim().length>0&&p.data.name.length<=100,'Invalid strategy name');
      must(typeof p.data.description==='string'&&p.data.description.length<=500,'Invalid description');
      const next=new SleeveLedger(structuredClone(this.state.ledger));next.create({id:p.strategyId,provider:p.signer,name:p.data.name,description:p.data.description});
      this.state.ledger=next.state;this.state.used.push(id);(this.state.registrations||=[]).push(envelope);this.save();return {id,registered:true};
    }
    const l=new SleeveLedger(structuredClone(this.state.ledger)),s=l.sleeve(p.strategyId),marks=await this.marks();
    const plan={id,hash,envelope,p,marks:json(marks),kind:p.type};
    if(p.type==='ALLOCATE'){
      const amount=money(p.data.amount);l.allocate({strategyId:s.id,investor:p.signer,amount,requestId:id},marks);
      const account=this.chain.accounts.findIndex(a=>a.toLowerCase()===p.signer.toLowerCase());
      if(p.data.transactionHash){must(this.chain.rpc&&/^0x[0-9a-f]{64}$/i.test(p.data.transactionHash),'External deposit requires a valid RPC transaction hash');plan.externalHash=p.data.transactionHash;}
      else if(prepareOnly){must(this.chain.rpc,'External wallets require Monad testnet');plan.externalAwait=true;}
      else must(account>=0,'Investor must broadcast their deposit from their own wallet');
      Object.assign(plan,{amount:String(amount),account});
    }else if(p.type==='REDEEM'){
      const result=l.redeem({strategyId:s.id,investor:p.signer,units:s.investors[p.signer]||'0',requestId:id},marks);plan.amount=result.amount;
    }else if(p.type==='PAY_PROVIDER'){
      must(p.signer===s.provider,'Wrong provider');plan.amount=l.payProvider(s.id,id);must(BigInt(plan.amount)>0n,'No provider accrual');
    }else if(p.type==='ORDER'){
      must(p.signer===s.provider,'Wrong provider');must(s.id!=='cash-reserve','Cash strategy does not trade');
      const {side,asset='BTC'}=p.data,index=ASSETS.indexOf(asset);must(index>=0&&SIDE.includes(side),'Invalid order');
      const available=BigInt(s.cash)-BigInt(s.providerAccrual);let amount,limit,collateral=0n,lot=ZeroHash;
      if(side==='BUY'){
        must(BigInt(s.positions[asset]?.quantity||0)===0n&&!Object.values(s.shorts).some(x=>x.asset===asset),'Asset already active in strategy');amount=money(p.data.amount);must(amount>0n&&amount<=l.investorPool(s,marks)/4n&&amount<=available,'Strategy capital cap');
        limit=(await this.chain.read(this.venue,'quote',[index,true,amount]))[0]*98n/100n;must(limit>0n,'Dust order');
      }else if(side==='SELL'){
        amount=BigInt(s.positions[asset]?.quantity||0);must(amount>0n,'No position in selected strategy');limit=(await this.chain.read(this.venue,'quote',[index,false,amount]))[0]*98n/100n;
      }else if(side==='SHORT_OPEN'){
        must(BigInt(s.positions[asset]?.quantity||0)===0n&&!Object.values(s.shorts).some(x=>x.asset===asset),'Asset already active in strategy');collateral=money(p.data.amount);must(collateral>0n&&collateral<=l.investorPool(s,marks)/4n&&collateral<=available,'Strategy collateral cap');
        amount=collateral*SCALE/marks[asset];limit=(await this.chain.read(this.venue,'quote',[index,false,amount]))[0]*98n/100n;lot=digest({id,lot:true});must(amount>0n&&limit>0n,'Dust order');
      }else{
        const entries=Object.entries(s.shorts).filter(([,x])=>x.asset===asset);must(entries.length===1,'No unique strategy debt');[lot]=entries[0];const loan=entries[0][1];amount=BigInt(loan.debt);
        const [c]=await this.chain.read(this.venue,'cashReserves',[index]),[q]=await this.chain.read(this.venue,'assetReserves',[index]);
        must(amount<q,'Insufficient venue liquidity');const cost=(c*amount*10000n+(q-amount)*9999n-1n)/((q-amount)*9999n);
        const own=BigInt(loan.escrow)+available;must(cost<=own,'Insolvent strategy: cannot use another strategy capital');limit=cost*102n/100n;if(limit>own)limit=own;
      }
      Object.assign(plan,{side,asset,index,amount:String(amount),limit:String(limit),collateral:String(collateral),lot,deadline:await this.chain.now()+300,commitment:digest(envelope)});
    }else throw new Error('Unsupported signed operation');
    this.state.pending=plan;this.save();return this.process(plan);
  }
  event(receipt,name,id){
    must(receipt.status===1,'Unsuccessful receipt');const iface=new Interface(this.vault.abi);
    const events=receipt.logs.filter(x=>x.address.toLowerCase()===this.vault.address.toLowerCase()).map(x=>{try{return iface.parseLog(x);}catch{return null;}}).filter(x=>x?.name===name&&x.args.id===id);
    must(events.length===1,'Receipt event mismatch');return events[0].args;
  }
  async externalDeposit(plan){
    const rpc=this.chain.rpc,receipt=await rpc.getTransactionReceipt(plan.externalHash),tx=await rpc.getTransaction(plan.externalHash);
    must(receipt&&tx&&receipt.status===1,'Deposit is not confirmed');
    must(tx.from.toLowerCase()===plan.p.signer.toLowerCase()&&tx.to?.toLowerCase()===this.vault.address.toLowerCase(),'Deposit sender or vault mismatch');
    const call=new Interface(this.vault.abi).parseTransaction({data:tx.data});
    must(call.name==='deposit'&&String(call.args[0])===plan.amount&&call.args[1]===plan.id,'Deposit intent mismatch');
    const block=await rpc.getBlock(receipt.blockNumber);
    return {transactionHash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,blockTimestamp:block.timestamp,status:1,environment:this.chain.environment,gasUsed:String(receipt.gasUsed),logs:receipt.logs.map(x=>({address:x.address,topics:[...x.topics],data:x.data}))};
  }
  async process(plan){
    if(plan.externalAwait&&!plan.externalHash)return {depositRequired:true,id:plan.id,vault:this.vault.address,cash:this.cash.address,amount:plan.amount};
    must(digest(plan.envelope)===plan.hash&&verifyMessage(canonicalJson(plan.envelope.payload),plan.envelope.signature).toLowerCase()===plan.p.signer.toLowerCase(),'Persisted authorization mismatch');
    const {p,id}=plan,l=new SleeveLedger(structuredClone(this.state.ledger)),s=l.sleeve(p.strategyId),marks=Object.fromEntries(Object.entries(plan.marks).map(([k,v])=>[k,BigInt(v)]));
    let receipt,anchor;
    if(plan.kind==='ALLOCATE'){
      receipt=plan.externalHash?await this.externalDeposit(plan):await this.chain.tx(id,this.vault,'deposit',[plan.amount,id],plan.account);const e=this.event(receipt,'Deposit',id);
      must(e.investor===p.signer&&String(e.amount)===plan.amount,'Deposit attribution mismatch');l.allocate({strategyId:s.id,investor:p.signer,amount:e.amount,requestId:id},marks);
    }else if(plan.kind==='REDEEM'||plan.kind==='PAY_PROVIDER'){
      const amount=plan.kind==='REDEEM'?l.redeem({strategyId:s.id,investor:p.signer,units:s.investors[p.signer]||0,requestId:id},marks).amount:l.payProvider(s.id,id);
      must(amount===plan.amount,'Withdrawal changed');receipt=await this.chain.tx(id,this.vault,'withdraw',[p.signer,amount,id]);const e=this.event(receipt,'Withdrawal',id);must(e.investor===p.signer&&String(e.amount)===amount,'Withdrawal attribution mismatch');
    }else{
      anchor=await this.chain.tx(id+'-commit',this.vault,'commit',[id,plan.commitment]);const committed=this.event(anchor,'Committed',id);must(committed.commitment===plan.commitment,'Commitment mismatch');
      receipt=await this.chain.tx(id,this.vault,'execute',[id,SIDE.indexOf(plan.side),plan.index,plan.amount,plan.limit,plan.collateral,plan.lot,plan.deadline]);
      const e=this.event(receipt,'Fill',id);must(receipt.blockNumber>anchor.blockNumber&&Number(e.side)===SIDE.indexOf(plan.side)&&Number(e.asset)===plan.index&&e.lot===plan.lot,'Fill attribution mismatch');
      must((plan.side==='BUY'?String(e.cashAmount)===plan.amount:String(e.quantity)===plan.amount),'Fill amount mismatch');
      must(plan.side==='BUY'?e.quantity>=BigInt(plan.limit):plan.side==='SELL'?e.cashAmount>=BigInt(plan.limit):plan.side==='SHORT_CLOSE'?e.cashAmount<=BigInt(plan.limit):e.cashAmount===BigInt(plan.collateral),'Fill limit mismatch');
      const f={strategyId:s.id,orderId:id,asset:plan.asset,side:plan.side,quantity:e.quantity,quote:e.cashAmount,fee:0n,lotId:plan.lot};
      if(plan.side==='SHORT_OPEN'){f.collateral=e.cashAmount;f.escrow=e.escrow;f.quote=e.escrow-e.cashAmount;}
      l.recordFill(f);
      const venueInterface=new Interface(this.venue.abi);
      const swaps=receipt.logs.filter(x=>x.address.toLowerCase()===this.venue.address.toLowerCase()).map(x=>{try{return venueInterface.parseLog(x);}catch{return null;}}).filter(x=>x?.name==='Swap'&&x.args.trader.toLowerCase()===this.vault.address.toLowerCase());
      must(swaps.length===1&&Number(swaps[0].args.asset)===plan.index,'Missing attributable venue fill');
      // AMM fees are already reflected in cash/quantity. Preserve the original
      // fee denomination separately; never subtract them from NAV a second time.
      (s.venueFees||=[]).push({orderId:id,asset:swaps[0].args.buy?'tUSD':plan.asset,amount:String(swaps[0].args.fee),includedInFill:true});
      if((plan.side==='SELL'||plan.side==='SHORT_CLOSE')&&flat(s))l.crystallize(s.id,await this.marks());
    }
    if(this.chain.assertFinalized)await this.chain.assertFinalized(receipt);
    const reconciliation=await this.reconcile(l.state);
    const row={id,type:plan.kind,strategyId:s.id,investor:p.signer,receipt,anchor:anchor||null,signatureHash:plan.hash,reconciliation:json(reconciliation)};
    this.state.ledger=l.state;this.state.used.push(id);this.state.receipts.push(row);
    if(plan.kind==='ORDER'&&(plan.side==='SELL'||plan.side==='SHORT_CLOSE')&&flat(s))this.state.track.push({strategyId:s.id,unitPrice:s.history.at(-1).unitPrice,transactionHash:receipt.transactionHash,blockNumber:receipt.blockNumber,source:this.chain.environment});
    this.state.pending=null;this.save();return {id,transactionHash:receipt.transactionHash,reconciled:true};
  }
  inspectLocalDomains(){
    const work=this.queue.then(async()=>{
      must(this.chain.environment==='LOCAL_EVM','Domain inspection is restricted to local test fixtures');
      return json({mode:this.chain.environment,fixtureOnly:true,vault:this.vault.address,venue:this.venue.address,cashToken:this.cash.address,
        ledger:this.state.ledger,custody:await this.custody(),marks:await this.marks(),reconciliation:await this.reconcile(),completedRequests:this.state.used.length,
        registrations:(this.state.registrations||[]).map(e=>({strategyId:e.payload.strategyId,signer:e.payload.signer,signatureHash:digest(e)})),
        pending:this.state.pending?{id:this.state.pending.id,kind:this.state.pending.kind,strategyId:this.state.pending.p.strategyId,externalAwait:Boolean(this.state.pending.externalAwait)}:null,
        trace:this.state.receipts.map(x=>({id:x.id,type:x.type,strategyId:x.strategyId,signer:x.investor,signatureHash:x.signatureHash,
          transactionHash:x.receipt.transactionHash,blockNumber:x.receipt.blockNumber,commitmentHash:x.anchor?.transactionHash||null,
          events:x.receipt.logs.filter(log=>log.address.toLowerCase()===this.vault.address.toLowerCase()).map(log=>{
            const event=new Interface(this.vault.abi).parseLog(log);return {name:event.name,values:Object.fromEntries(event.fragment.inputs.map((input,i)=>[input.name,String(event.args[i])]))};
          }),reconciliation:x.reconciliation})),track:this.state.track});
    });this.queue=work.catch(()=>{});return work;
  }
  view(envelope){const work=this.queue.then(()=>this.viewLocked(envelope));this.queue=work.catch(()=>{});return work;}
  async viewLocked(envelope){
    // Portfolio is only returned to the signer, never by a query-string role.
    const p=envelope?this.authenticate(envelope):null;if(p)must(p.type==='VIEW','Expected signed VIEW');
    const l=new SleeveLedger(this.state.ledger),marks=await this.marks();let r;try{r=await this.reconcile();}catch(error){if(!this.state.pending?.externalAwait)throw error;r={balanced:false,reconciliationPending:true,vaultEquity:null,strategyEquity:null,protocolAccrual:null};}
    const catalog=l.state.strategies.map(s=>({id:s.id,name:s.name,provider:s.provider,description:s.description,feeBps:s.feeBps,units:s.units,investorEquity:String(l.investorPool(s,marks)),unitPrice:String(BigInt(s.units)?l.investorPool(s,marks)*SCALE/BigInt(s.units):SCALE),providerAccrual:s.providerAccrual,settledRounds:this.state.track.filter(x=>x.strategyId===s.id).length}));
    const portfolio=p?l.state.strategies.filter(s=>BigInt(s.investors[p.signer]||0)>0n).map(s=>({strategyId:s.id,name:s.name,units:s.investors[p.signer],claim:l.claims(s,marks)[p.signer],canRedeem:Object.values(s.positions).every(x=>BigInt(x.quantity)===0n)&&!Object.keys(s.shorts).length})):[];
    const {equities,...total}=r;
    const receipts=this.state.receipts.filter(x=>p&&(x.investor===p.signer||l.sleeve(x.strategyId).provider===p.signer)).map(x=>({type:x.type,strategyId:x.strategyId,hash:x.receipt.transactionHash,block:x.receipt.blockNumber,gas:x.receipt.gasUsed}));
    return {mode:this.chain.environment,chainId:this.chain.chainId,chainConnected:true,tee:false,vault:{address:this.vault.address,...total},venue:this.venue.address,cash:this.cash.address,catalog,portfolio,receipts,investor:p?.signer||null,wallet:p?String((await this.chain.read(this.cash,'balanceOf',[p.signer]))[0]):null,pending:Boolean(this.state.pending),testAssetsOnly:true,operatorTrusted:true};
  }
}
