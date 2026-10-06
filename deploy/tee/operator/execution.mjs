import { SharedAccounts } from './shared-accounts.mjs';
import { ledgerEvent,ledgerValue } from './ledger-journal.mjs';
import { assertInvestmentStateEmpty,assertVaultRetirable } from '../../../src/platform/vault-retirement.js';
import { executionError } from '../../../src/platform/execution-errors.js';
import { Contract, Interface, keccak256, toUtf8Bytes } from 'ethers';
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { SealedStore } from '../../../src/integration/sealed.js';
import { durableSubmitter } from '../../../protocol/cohort/durable-submitter.mjs';
import { targetLots, validateTargets, validatePolicy } from '../../../src/platform/policy.js';
import { newBook, markBook, markVenueEquity, activatePending, publicMetrics, crystallizeFees, burnWithdrawal, managerFeeTotals, SCALE } from './ledger.mjs';

const vaultAbi=['function accountCount() view returns(uint256)','function accounts(uint256) view returns(address)','function createSlots(uint256,uint256)','function executionAccountVersion() view returns(uint256)','function createSharedAccounts(uint256)','function fundSlot(address,uint256,bytes32)','function recoverSlot(address,uint256,bytes32)','function withdraw(address,uint256,bytes32)','function setPaused(bool)'];
const slotAbi=['function market() view returns(uint256)','function accountId() view returns(uint256)','function execute(bytes32,int256,uint256,uint256,uint256)'];
const vaultInterface=new Interface(vaultAbi);
const n=x=>BigInt(x||0);
const opaque=s=>keccak256(toUtf8Bytes(s));
const json=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));

export class PlatformExecution {
  constructor({investments,provider,wallet,secret,storeDir,apiUrl}) {
    Object.assign(this,{investments,provider,wallet,apiUrl});
    this.exchange=new Contract('0x1964C32f0bE608E7D29302AFF5E61268E72080cc',JSON.parse(readFileSync(new URL('../../../protocol/perpl/exchange-abi.json',import.meta.url))),provider);
    this.journal=new SealedStore(`${storeDir}/platform-transactions.json`,secret,'platform-transactions-v1',{maxHexLength:128_000_000});
  }
  async initialize() {
    const initialNonce=await this.provider.getTransactionCount(this.wallet.address,'latest');
    // Platform execution is funded by the operator wallet, not a lifetime
    // experiment allowance. Keep the existing sealed journal and fee history.
    this.submitter=durableSubmitter({provider:this.provider,wallet:this.wallet,store:this.journal,chainId:10143,initialNonce});
    try {await this.submitter.sync();} catch(error) {this.reconciliationError=executionError(error);}
    const state=this.investments.state();
    if(state.config){
      // Open legacy positions keep their existing ownership. v1 vaults fund
      // new shared accounts through their existing operator withdrawal right.
      // v2 vaults additionally support creating and funding registered pools.
      try {if(await this.vault(state).executionAccountVersion()===2n)this.shared=new SharedAccounts(this);}catch(error){
        if(error.code!=='CALL_EXCEPTION'&&error.code!=='BAD_DATA')throw error;
        const artifact=JSON.parse(readFileSync(new URL('../../../artifacts/platform/shared-account.json',import.meta.url)));
        this.shared=new SharedAccounts(this,{nativeCreate:false,artifact});
      }
    }
  }
  save(state) {this.investments.store.write(state);}
  async pauseForRetirement({accessToken}) {
    this.investments.authorizeConfiguration(accessToken);
    return this.investments.serial(async()=>{
      const state=this.investments.state();assertInvestmentStateEmpty(state);
      await assertVaultRetirable({provider:this.provider,...state.config,requirePaused:false,executionAccountAddresses:Object.keys(state.sharedAccounts||{})});
      // One journaled operation, using the existing enclave operator identity.
      state.maintenanceJobs||={};
      const id=opaque(`retire:${state.config.vaultAddress}`),job=state.maintenanceJobs[id]||={id,steps:{}};
      await this.step(state,job,'pause',await this.vault(state).setPaused.populateTransaction(true));
      return await assertVaultRetirable({provider:this.provider,...state.config,executionAccountAddresses:Object.keys(state.sharedAccounts||{})});
    });
  }
  vault(state) {if(!state.config)throw Error('VAULT_UNAVAILABLE');return new Contract(state.config.vaultAddress,vaultAbi,this.wallet);}
  async authorize(input) {
    const response=await fetch(`${this.apiUrl}/v1/strategy-authorization`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${input.sessionToken || input.apiKey}`},body:JSON.stringify({strategyId:input.strategyId}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('STRATEGY_AUTHORIZATION_FAILED');return response.json();
  }
  async accept(input) {
    const strategy=await this.authorize(input);
    return this.investments.serial(()=>{
      const state=this.investments.state(),book=state.books[strategy.id] ||=newBook(strategy);
      book.policyVersion??=strategy.policy_version||1;
      if(input.action==='STATUS')return {sequence:book.sequence,status:book.status,policy:book.policy,policyVersion:book.policyVersion,valuationError:book.valuationError||null,reconciliationError:this.reconciliationError||null,performanceFees:this.performanceFees(book),requests:Object.values(book.requests).map(({id,status,error,sequence,createdAt})=>({id,status,error,sequence,createdAt}))};
      if(input.action==='RESUME') {if(book.status!=='HALTED')throw Error('NOT_HALTED');book.status='ACTIVE';book.baselineNav=book.nav;book.peakNav=book.nav;this.save(state);return {status:book.status};}
      if(input.action!=='TARGET')throw Error('INVALID_ACTION');
      if(!['FUNDING','LIVE'].includes(strategy.status))throw Error('STRATEGY_NOT_ACTIVE');
      if(!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId||''))throw Error('INVALID_REQUEST_ID');
      const targets=validateTargets(input.targets,book.policy);
      const fingerprint=opaque(JSON.stringify({targets,sequence:input.sequence}));
      const prior=book.requests[input.requestId];
      if(prior){if(prior.fingerprint!==fingerprint)throw Error('REQUEST_ID_REUSED');return {id:prior.id,status:prior.status};}
      if(book.status!=='ACTIVE')throw Error('STRATEGY_HALTED');
      if(book.settlement)throw Error('SETTLEMENT_IN_PROGRESS');
      if(!Number.isSafeInteger(input.sequence)||input.sequence!==book.sequence+1)throw Error('SEQUENCE_MISMATCH');
      if(Object.values(book.requests).some(r=>['QUEUED','EXECUTING'].includes(r.status)))throw Error('PREVIOUS_REQUEST_PENDING');
      const now=Math.floor(Date.now()/1000);
      book.requests[input.requestId]={id:input.requestId,fingerprint,targets,sequence:input.sequence,status:'QUEUED',createdAt:now,deadline:now+book.policy.orderTtlSeconds,steps:{}};
      book.sequence=input.sequence;this.save(state);return {id:input.requestId,status:'QUEUED'};
    });
  }
  performanceFees(book) {
    const totals=managerFeeTotals(book),payments=new Map((book.feePayouts||[]).map(payment=>[payment.txHash,{...payment,status:'PAID'}]));
    // Older books did not retain a payout list, but the sealed transaction
    // journal still identifies each fee payment independently of user exits.
    for(let sequence=1;sequence<=(book.feePaymentSequence||0);sequence++) {
      const jobId=opaque(`fee:${book.id}:${sequence}`),stepId=opaque(`${jobId}:pay`),record=this.submitter?.lookup(stepId);
      if(record?.status!==1||payments.has(record.hash))continue;
      try {
        const transaction=vaultInterface.parseTransaction(JSON.parse(record.fingerprint));
        if(transaction?.name!=='withdraw'||transaction.args[0].toLowerCase()!==book.manager.toLowerCase()||transaction.args[2]!==opaque(jobId))continue;
        const awaitingEffect=book.feePayment?.id===jobId&&!book.feePayment.steps?.pay?.applied;
        payments.set(record.hash,{txHash:record.hash,amount:String(transaction.args[1]),blockNumber:record.block||null,paidAt:null,status:awaitingEffect?'CONFIRMING':'PAID'});
      } catch { /* Incomplete legacy metadata cannot be presented as a payout. */ }
    }
    const history=[...payments.values()].sort((a,b)=>(b.blockNumber||0)-(a.blockNumber||0)||(b.paidAt||0)-(a.paidAt||0));
    const confirmed=history.filter(payment=>payment.status==='PAID').reduce((sum,payment)=>sum+n(payment.amount),0n);
    const feeStep=book.feePayment?.steps?.pay;
    const record=feeStep&&!feeStep.applied?this.submitter?.lookup(feeStep.id):null;
    const paymentState=n(totals.outstanding)===0n?'NONE':record?.status===0?'FAILED':record?'CONFIRMING':book.settlement?'SETTLING':book.valuationError||this.reconciliationError?'WAITING_PLATFORM':n(book.cash)<n(totals.outstanding)?'WAITING_CASH':'READY';
    return {...totals,paymentState,historyComplete:totals.paid!==null&&confirmed===n(totals.paid),historyCount:history.length,payments:history.slice(0,20)};
  }
  async applyEffect(state,effect,result) {
    if(!effect)return;
    if(effect.kind.startsWith('SHARED_')){if(!this.shared)throw Error('SHARED_ACCOUNT_UNAVAILABLE');return this.shared.applyEffect(state,effect,result);}
    const book=state.books[effect.bookId];
    if(effect.kind==='CASH'){book.cash=String(n(book.cash)+n(effect.delta));ledgerEvent(book,'VENUE',{delta:String(effect.delta),txHash:result.hash});}
    if(effect.kind==='WITHDRAW'){const w=book.withdrawals[effect.withdrawalId];burnWithdrawal(book,w,n(effect.amount));w.txHash=result.hash;delete w.error;}
    if(effect.kind==='FEE'){
      book.feePayouts||=[];
      if(book.feePayouts.some(payment=>payment.txHash===result.hash))return;
      book.cash=String(n(book.cash)-n(effect.amount));book.feesDue=String(n(book.feesDue)-n(effect.amount));
      book.feePayouts.push({txHash:result.hash,amount:String(effect.amount),blockNumber:result.block||null,paidAt:Math.floor(Date.now()/1000)});
      ledgerEvent(book,'FEE_PAY',{amount:String(effect.amount),txHash:result.hash});
    }
    if(effect.kind==='PENDING_WITHDRAW'){const w=book.withdrawals[effect.withdrawalId],p=book.investors[w.wallet.toLowerCase()];p.pending=String(n(p.pending)-n(effect.amount));p.paid=String(n(p.paid)+n(effect.amount));w.status='PAID';w.txHash=result.hash;delete w.error;ledgerEvent(book,'PENDING_PAY',{wallet:p.wallet,amount:String(effect.amount),txHash:result.hash});}
  }
  async step(state,job,label,request,effect=null) {
    if(job.steps[label]?.applied)return job.steps[label];
    const id=opaque(`${job.id}:${label}`);
    // Persist exact calldata before broadcast; retries never regenerate an ambiguous tx.
    if(!job.steps[label]){job.steps[label]={request:json(request),id,effect};this.save(state);}
    const step=job.steps[label];const prior=this.submitter.lookup(id);
    if(!prior&&job.deadline!==undefined&&Math.floor(Date.now()/1000)>=job.deadline)throw Error('ORDER_EXPIRED');
    const result=prior?.status===1?prior:await this.submitter.submit(id,step.request);
    await this.applyEffect(state,step.effect,result);step.applied=true;step.hash=result.hash;this.save(state);return step;
  }
  async observation(address,blockTag,requestedMarket,book,state) {
    if(book?.executionMode==='SHARED')return this.shared.observation(state,book,Number(requestedMarket),blockTag);
    const slot=new Contract(address,slotAbi,this.provider),market=await slot.market({blockTag}),accountId=await slot.accountId({blockTag});
    const info=await this.exchange.getPerpetualInfoV2(market,{blockTag});
    if(!accountId)return {address,market:Number(market),qty:0n,free:0n,equity:0n,accountId,info};
    const [a,[p,mark,valid]]=await Promise.all([this.exchange.getAccountByAddr(address,{blockTag}),this.exchange.getPositionV2(market,accountId,{blockTag})]);
    if(!valid&&p.lotLNS>0n)throw Error('STALE_VENUE_PRICE');
    return {address,market:Number(market),qty:p.positionType===0n?p.lotLNS:-p.lotLNS,free:a.balanceCNS,equity:a.balanceCNS+a.lockedBalanceCNS+p.depositCNS+p.deltaPnlCNS+p.premiumPnlCNS,accountId,info,mark};
  }
  async observeBook(book, options, state) {
    if(book.executionMode==='SHARED')return this.shared.observeBook(state,book,options);
    const block=await this.provider.getBlockNumber();const values=[];
    for(const address of Object.values(book.slots))values.push(await this.observation(address,block));
    const equity=n(book.cash)+values.reduce((a,s)=>a+s.equity,0n)-n(book.feesDue);
    markVenueEquity(book,equity,options);return values;
  }
  async allocateSlot(state,book,market,job,target=0n) {
    if(book.executionMode==='SHARED')return this.shared.allocate(state,book,market,target,job);
    if(book.slots[market])return book.slots[market];
    const vault=this.vault(state),occupied=new Set([...Object.values(state.books).flatMap(b=>Object.values(b.slots)),...Object.keys(state.sharedAccounts||{})]),count=Number(await vault.accountCount()),free=[];
    for(let i=0;i<count;i++){const address=await vault.accounts(i);if(!occupied.has(address)&&Number(await new Contract(address,slotAbi,this.provider).market())===market)free.push(address);}
    if(!free.length){await this.step(state,job,`pool-${market}`,await vault.createSlots.populateTransaction(market,2));return this.allocateSlot(state,book,market,job);}
    book.slots[market]=free[randomInt(free.length)];this.save(state);return book.slots[market];
  }
  async trade(state,book,job,market,target,label) {
    if(book.executionMode==='SHARED')return this.shared.trade(state,book,job,market,target,label,opaque);
    const address=book.slots[market];if(!address)return;
    const o=await this.observation(address,await this.provider.getBlockNumber(),market,book,state);
    const started=job.tradeStarts?.[label];
    if(started&&n(started.qty)!==o.qty){job.hasFill=true;this.save(state);}
    if(o.qty===target)return;
    if(Math.floor(Date.now()/1000)>=job.deadline)throw Error('ORDER_EXPIRED');
    const slot=new Contract(address,slotAbi,this.wallet),buy=target>o.qty;
    const mark=o.mark||o.info.markPNS;const price=buy?mark*BigInt(10000+book.policy.slippageBps)/10000n:mark*BigInt(10000-book.policy.slippageBps)/10000n;
    job.tradeStarts||={};if(!job.tradeStarts[label]){job.tradeStarts[label]={qty:String(o.qty)};this.save(state);}
    await this.step(state,job,label,await slot.execute.populateTransaction(opaque(`${job.id}:${label}`),target,price,job.deadline,Math.ceil(book.policy.maxLeverageBps/100)));
    const after=await this.observation(address,await this.provider.getBlockNumber(),market,book,state);
    if(after.qty!==o.qty){job.hasFill=true;this.save(state);}
  }
  async execute(state,book,job) {
    if(this.shared&&book.executionMode!=='SHARED'&&!job.plan&&!Object.keys(job.steps).length){
      const legacy=await this.observeBook(book,undefined,state);
      if(legacy.every(p=>p.qty===0n&&p.equity===0n)){book.slots={};book.executionMode='SHARED';state.sharedAccounts||={};}
    }
    job.status='EXECUTING';this.save(state);
    if(!job.plan) {
      if(Math.floor(Date.now()/1000)>=job.deadline)throw Error('ORDER_EXPIRED');
      await this.observeBook(book,undefined,state);
      if(book.status!=='ACTIVE')throw Error('STRATEGY_HALTED');
      // Verify every requested market before admitting pending capital.
      const infos={};for(const t of job.targets)infos[t.market]=await this.exchange.getPerpetualInfoV2(t.market);
      activatePending(book);
      job.plan=Object.fromEntries(job.targets.map(t=>[t.market,String(targetLots(book.equity,t.weightBps,infos[t.market].markPNS,Number(infos[t.market].priceDecimals),Number(infos[t.market].lotDecimals)))]));
      for(const market of Object.keys(book.slots))job.plan[market] ||= '0';
      this.save(state);
    }
    // First release omitted positions and flatten sign reversals. Actual fills
    // govern whether the opposite side may be opened.
    let releasedCash=false;
    for(const [m,qty] of Object.entries(job.plan)) {
      if(!book.slots[m])continue;
      const o=await this.observation(book.slots[m],await this.provider.getBlockNumber(),m,book,state);
      if(o.qty && (n(qty)===0n || (o.qty>0n)!==(n(qty)>0n))) {
        releasedCash=true;
        await this.trade(state,book,job,Number(m),0n,`flatten-${m}-${job.attempt||0}`);
        const after=await this.observation(book.slots[m],await this.provider.getBlockNumber(),m,book,state);
        if(after.qty!==0n)throw Error('PARTIAL_FILL_RETRY');
      }
      const current=await this.observation(book.slots[m],await this.provider.getBlockNumber(),m,book,state);
      if(book.executionMode!=='SHARED'&&n(qty)===0n&&current.qty===0n&&current.free>=10000n) {
        const vault=this.vault(state);await this.step(state,job,`recover-${m}`,await vault.recoverSlot.populateTransaction(current.address,current.free,opaque(`${job.id}:recover-${m}`)),{bookId:book.id,kind:'CASH',delta:String(current.free)});
      }
    }
    if(book.executionMode==='SHARED'&&(releasedCash||Object.values(job.plan).some(q=>n(q)===0n)))await this.shared.recover(state,book,job,'target-recover',opaque);
    const active=Object.entries(job.plan).filter(([,q])=>n(q)!==0n);
    for(const [m,qty] of active) {
      const market=Number(m),address=await this.allocateSlot(state,book,market,job,n(qty)),o=await this.observation(address,await this.provider.getBlockNumber(),market,book,state);
      {
        const notional=(n(qty)<0n?-n(qty):n(qty))*o.info.markPNS*1000000n/10n**(o.info.priceDecimals+o.info.lotDecimals);
        let amount=book.executionMode==='SHARED'?this.shared.funding(state,book,market,n(qty),o.info):notional*11000n/BigInt(book.policy.maxLeverageBps);
        const firstAccountMinimum=book.executionMode==='SHARED'?100000000n-n(state.sharedAccounts[address].checkpoint.walletCash):100000000n;
        if(!o.accountId&&amount<firstAccountMinimum)amount=firstAccountMinimum;
        if(book.executionMode!=='SHARED')amount=amount>o.equity?amount-o.equity:0n;
        if(amount>0n){if(amount<10000000n)amount=10000000n;if(amount>n(book.cash)-n(book.feesDue))throw Error(book.executionMode==='SHARED'?'INSUFFICIENT_SHARED_ACCOUNT_CASH':'INSUFFICIENT_STRATEGY_CASH_MIN_ACCOUNT_100_AUSD');
          const request=book.executionMode==='SHARED'&&!this.shared.nativeCreate?await this.vault(state).withdraw.populateTransaction(address,amount,opaque(`${job.id}:fund-${m}`)):await this.vault(state).fundSlot.populateTransaction(address,amount,opaque(`${job.id}:fund-${m}`));
          await this.step(state,job,`fund-${m}`,request,book.executionMode==='SHARED'?{bookId:book.id,kind:'SHARED_FUND',address,amount:String(amount)}:{bookId:book.id,kind:'CASH',delta:String(-amount)});}
      }
      if(book.executionMode==='SHARED')await this.shared.admitWalletCash(state,book,job,market,opaque);
      await this.trade(state,book,job,market,n(qty),`target-${m}-${job.attempt||0}`);
    }
    const observed=await this.observeBook(book,undefined,state);
    if(Object.entries(job.plan).some(([market,q])=>(observed.find(o=>o.market===Number(market))?.qty||0n)!==n(q)))throw Error('PARTIAL_FILL_RETRY');
    job.status='EXECUTED';job.completedAt=Math.floor(Date.now()/1000);delete job.error;this.save(state);
  }
  async riskExit(state,book) {
    if(!book.riskJob||book.riskJob.deadline<=Math.floor(Date.now()/1000)) {
      book.riskAttempt=(book.riskAttempt||0)+1;
      book.riskJob={id:opaque(`risk:${book.id}:${book.riskAttempt}`),deadline:Math.floor(Date.now()/1000)+120,steps:{}};this.save(state);
    }
    let flat=true;
    for(const [market,address] of Object.entries(book.slots)){
      await this.trade(state,book,book.riskJob,Number(market),0n,`risk-close-${market}`);
      const o=await this.observation(address,await this.provider.getBlockNumber(),market,book,state);if(o.qty)flat=false;
    }
    if(flat){book.status='HALTED';this.save(state);}
  }
  async settle(state,book,now) {
    for(const w of Object.values(book.withdrawals).filter(w=>w.kind==='PENDING'&&['REQUESTED','SETTLING'].includes(w.status)&&w.settlementAt<=now)){
      w.status='SETTLING';w.job ||= {id:opaque(`pending-withdraw:${w.id}`),steps:{}};this.save(state);
      await this.step(state,w.job,'pay',await this.vault(state).withdraw.populateTransaction(w.wallet,n(w.amount),opaque(w.job.id)),{bookId:book.id,kind:'PENDING_WITHDRAW',withdrawalId:w.id,amount:w.amount});
    }
    const period=book.policy.settlementPeriodSeconds,offset=book.policy.settlementOffsetSeconds;
    const cutoff=Math.floor((now-offset)/period)*period+offset;
    if(!book.lastSettlement){book.lastSettlement=cutoff;this.save(state);}
    const due=Object.values(book.withdrawals).filter(w=>w.kind!=='PENDING'&&w.status==='REQUESTED'&&w.settlementAt<=now);
    if(!book.settlement&&(due.length||cutoff>book.lastSettlement)) {
      await this.observeBook(book,undefined,state);if(!due.length)crystallizeFees(book);book.lastSettlement=cutoff;
      if(due.length){
        const units=due.reduce((a,w)=>a+n(w.units),0n),total=n(book.totalUnits),obs=await this.observeBook(book,undefined,state);
        const claim=total?n(book.equity)*units/total:0n;
        const free=n(book.cash)-n(book.feesDue)+obs.reduce((a,o)=>a+o.free,0n);
        const positionEquity=obs.reduce((a,o)=>a+o.equity-o.free,0n);
        const needed=claim>free?claim-free:0n;
        let remainingBps=positionEquity>0n?(positionEquity-needed)*10000n/positionEquity:10000n;
        if(remainingBps<0n)remainingBps=0n;if(remainingBps>10000n)remainingBps=10000n;
        // Cash-first redemption must also leave remaining investors within the
        // registered leverage cap.
        const grossExposure=obs.reduce((a,o)=>a+(o.qty<0n?-o.qty:o.qty)*o.info.markPNS*1000000n/10n**(o.info.priceDecimals+o.info.lotDecimals),0n);
        const remainingEquity=n(book.equity)-claim;
        const leverageBps=grossExposure?remainingEquity*BigInt(book.policy.maxLeverageBps)/grossExposure:10000n;
        if(leverageBps<remainingBps)remainingBps=leverageBps;
        book.settlement={id:opaque(`settle:${book.id}:${cutoff}`),withdrawalIds:due.map(w=>w.id),units:String(units),total:String(total),cost:'0',targets:Object.fromEntries(obs.filter(o=>o.market>0).map(o=>[o.market,String(o.qty*remainingBps/10000n)])),attempt:0,steps:{}};
        for(const w of due)w.status='SETTLING';
      }this.save(state);
    }
    const settlement=book.settlement;if(!settlement)return;
    if(!settlement.job||settlement.job.deadline<=now){settlement.attempt++;settlement.job={id:opaque(`${settlement.id}:${settlement.attempt}`),deadline:now+120,steps:{}};this.save(state);}
    const job=settlement.job;
    if(!settlement.payouts) {
      for(const [m,target] of Object.entries(settlement.targets)) {
        const before=await this.observation(book.slots[m],await this.provider.getBlockNumber(),m,book,state);
        if(before.qty===n(target)&&(!job.costBases?.[m]||job.costApplied?.[m]))continue;
        const label=`withdraw-close-${m}`;
        if(!job.costBases)job.costBases={};
        if(!job.costBases[m]){const observations=await this.observeBook(book,undefined,state);job.costBases[m]={equity:book.equity,positions:json(observations)};this.save(state);}
        await this.trade(state,book,job,Number(m),n(target),label);
        const after=await this.observation(book.slots[m],await this.provider.getBlockNumber(),m,book,state);
        if(!job.costApplied)job.costApplied={};
        if(!job.costApplied[m]){
          const base=job.costBases[m];
          const observations=await this.observeBook(book,{assessRisk:false},state);
          let afterAtPriorMark;
          if(base.positions)afterAtPriorMark=n(book.equity)+observations.reduce((sum,o)=>{const prior=base.positions.find(p=>p.market===o.market);return sum+(prior?o.qty*(n(prior.mark)-n(o.mark))*1000000n/10n**(n(o.info.priceDecimals)+n(o.info.lotDecimals)):0n);},0n);
          else {
            // A v1 settlement may already have a persisted market cost basis.
            const o=observations.find(o=>o.market===Number(m));
            afterAtPriorMark=o.equity+o.qty*(n(base.mark)-n(o.mark))*1000000n/10n**(n(o.info.priceDecimals)+n(o.info.lotDecimals));
          }
          const cost=n(base.equity)-afterAtPriorMark;
          settlement.cost=String(n(settlement.cost)+cost);job.costApplied[m]=true;this.save(state);
        }
        if(after.qty!==n(target))throw Error('WITHDRAWAL_PARTIAL_FILL_RETRY');
      }
      if(book.executionMode==='SHARED')await this.shared.recover(state,book,job,'withdraw-recover',opaque);
      else for(const [m,address] of Object.entries(book.slots)){
        const o=await this.observation(address,await this.provider.getBlockNumber(),m,book,state);
        if(o.free>=10000n)await this.step(state,job,`withdraw-recover-${m}`,await this.vault(state).recoverSlot.populateTransaction(address,o.free,opaque(`${job.id}:withdraw-recover-${m}`)),{bookId:book.id,kind:'CASH',delta:String(o.free)});
      }
      await this.observeBook(book,{assessRisk:false},state);
      const cost=n(settlement.cost);
      const exitCosts={};for(const id of settlement.withdrawalIds){const w=book.withdrawals[id];exitCosts[w.wallet.toLowerCase()]=String(n(exitCosts[w.wallet.toLowerCase()])+cost*n(w.units)/n(settlement.units));}
      // Value non-redeeming shares before exit costs, then charge performance
      // fees on each investor's gains net of their own redemption costs.
      markBook(book,n(book.equity)+cost,Date.now(),{assessRisk:false});
      crystallizeFees(book,exitCosts);
      settlement.units=String(settlement.withdrawalIds.reduce((a,id)=>a+n(book.withdrawals[id].units),0n));
      settlement.total=book.totalUnits;
      settlement.referenceNav=book.nav;
      const gross=n(book.equity)*n(settlement.units)/n(settlement.total);
      book.equity=String(n(book.equity)-cost);
      ledgerValue(book);
      const payout=gross-n(settlement.cost);if(payout<0n)throw Error('WITHDRAWAL_COST_EXCEEDS_VALUE');
      let left=payout;settlement.payouts={};
      settlement.withdrawalIds.forEach((id,i)=>{const w=book.withdrawals[id],amount=i===settlement.withdrawalIds.length-1?left:payout*n(w.units)/n(settlement.units);left-=amount;settlement.payouts[id]=String(amount);});this.save(state);
    }
    const unpaid=settlement.withdrawalIds.filter(id=>book.withdrawals[id].status!=='PAID').reduce((a,id)=>a+n(settlement.payouts[id]),0n);
    if(n(book.cash)-n(book.feesDue)<unpaid)throw Error('WITHDRAWAL_LIQUIDITY_PENDING');
    for(const id of settlement.withdrawalIds){
      const w=book.withdrawals[id];if(w.status==='PAID')continue;
      const amount=n(settlement.payouts[id]);
      if(amount===0n){burnWithdrawal(book,w,0n);this.save(state);continue;}
      await this.step(state,settlement,`pay-${id}`,await this.vault(state).withdraw.populateTransaction(w.wallet,amount,opaque(`${settlement.id}:pay-${id}`)),{bookId:book.id,kind:'WITHDRAW',withdrawalId:id,amount:String(amount)});
    }
    delete book.settlement;this.save(state);
  }
  async payFees(state,book) {
    if(book.feePayment?.steps?.pay?.applied){delete book.feePayment;this.save(state);}
    if(book.settlement||n(book.feesDue)===0n||n(book.cash)<n(book.feesDue))return;
    if(!book.feePayment){book.feePaymentSequence=(book.feePaymentSequence||0)+1;book.feePayment={id:opaque(`fee:${book.id}:${book.feePaymentSequence}`),amount:book.feesDue,steps:{}};this.save(state);}
    const job=book.feePayment,amount=n(job.amount);
    await this.step(state,job,'pay',await this.vault(state).withdraw.populateTransaction(book.manager,amount,opaque(job.id)),{bookId:book.id,kind:'FEE',amount:String(amount)});
    delete book.feePayment;this.save(state);
  }
  async tick() {
    if(!this.submitter)return;
    return this.investments.serial(async()=>{
      const state=this.investments.state();if(!state.config)return;
      try {await this.submitter.sync();this.reconciliationError=null;} catch(error) {
        this.reconciliationError=executionError(error);
        for(const book of Object.values(state.books))for(const job of Object.values(book.requests)) {
          if(!['QUEUED','EXECUTING'].includes(job.status))continue;
          if(Object.values(job.steps||{}).some(step=>this.submitter.lookup(step.id)?.status===undefined&&this.submitter.lookup(step.id)))job.error=this.reconciliationError;
        }
        this.save(state);return;
      }
      if(!this.catalogAt||Date.now()-this.catalogAt>60000){try{const r=await fetch(`${this.apiUrl}/v1/strategies`,{signal:AbortSignal.timeout(5000)});if(r.ok){this.catalog=(await r.json()).strategies;this.catalogAt=Date.now();}}catch{}}
      for(const book of Object.values(state.books)) {
        // Chain confirmation can precede a process crash. Apply saved monetary
        // effects before reading venue state or skipping already-completed steps.
        const jobs=[...Object.values(book.requests),...Object.values(book.withdrawals).map(w=>w.job),book.settlement,book.settlement?.job,book.riskJob,book.feePayment].filter(Boolean);
        for(const job of jobs)for(const step of Object.values(job.steps||{}))if(!step.applied){const result=this.submitter.lookup(step.id);if(result?.status===1){await this.applyEffect(state,step.effect,result);if(step.effect?.hasFill)job.hasFill=true;step.applied=true;step.hash=result.hash;this.save(state);}}
        for(const job of Object.values(book.requests).filter(r=>['QUEUED','EXECUTING'].includes(r.status))) {
          try {await this.execute(state,book,job);}catch(e){
            job.error=executionError(e);
            const pending=Object.values(this.submitter.publicState().records).some(r=>r.status===undefined)||Object.values(job.steps).some(step=>!step.applied&&this.submitter.lookup(step.id)?.status===1);
            if(pending)job.status='EXECUTING';
            else if(job.error==='OPERATOR_GAS_INSUFFICIENT'){
              // Wallet refills are operational recovery, not a new strategist
              // request. Retain its exact steps and retry only within its TTL.
              if(Math.floor(Date.now()/1000)<job.deadline)job.status='EXECUTING';
              else {job.status=job.hasFill?'PARTIALLY_FILLED':'EXPIRED';job.error='ORDER_EXPIRED';}
            }
            else if(job.error==='PARTIAL_FILL_RETRY'&&Math.floor(Date.now()/1000)<job.deadline){job.status='EXECUTING';job.attempt=(job.attempt||0)+1;}
            else job.status=job.hasFill?'PARTIALLY_FILLED':['ORDER_EXPIRED','PARTIAL_FILL_RETRY'].includes(job.error)?'EXPIRED':'FAILED';
            this.save(state);
          }
        }
        try {
          await this.observeBook(book,undefined,state);delete book.valuationError;this.save(state);
          if(book.status==='RISK_EXIT')await this.riskExit(state,book);
          await this.settle(state,book,Math.floor(Date.now()/1000));
          await this.payFees(state,book);
          if(n(book.totalUnits)===0n&&!book.settlement&&!Object.values(book.requests).some(r=>['QUEUED','EXECUTING'].includes(r.status))){
            for(const [market,address] of Object.entries(book.slots)){const o=await this.observation(address,await this.provider.getBlockNumber(),market,book,state);if(o.qty===0n&&o.equity===0n)delete book.slots[market];}this.save(state);
          }
          const proposal=this.catalog?.find(s=>s.id===book.id)?.pending_policy;
          if(proposal&&proposal.version>(book.policyVersion||1)&&proposal.effectiveAfter<=Math.floor(Date.now()/1000)&&!book.settlement&&!Object.values(book.requests).some(r=>['QUEUED','EXECUTING'].includes(r.status))&&!Object.values(book.withdrawals).some(w=>['REQUESTED','SETTLING'].includes(w.status)&&w.settlementAt<=proposal.effectiveAfter)){
            crystallizeFees(book);book.policy=validatePolicy(proposal.policy);book.feeBps=proposal.feeBps;ledgerEvent(book,'POLICY',{feeBps:book.feeBps});book.policyVersion=proposal.version;this.save(state);
          }
        }catch(e){book.valuationError=executionError(e);if(book.settlement)for(const id of book.settlement.withdrawalIds)if(book.withdrawals[id].status!=='PAID')book.withdrawals[id].error=book.valuationError;this.save(state);}
      }
    });
  }
  metrics() {return {strategies:Object.values(this.investments.state().books).filter(b=>!b.valuationError).map(b=>({strategyId:b.id,...publicMetrics(b)}))};}
  async publish() {
    const observedAt=Math.floor(Date.now()/60000)*60000;
    if(this.lastPublished===observedAt)return;
    const payload={observedAt,...this.metrics()};if(!payload.strategies.length)return;
    const signature=await this.wallet.signMessage(`MMQ_PUBLIC_METRICS_V1\n${JSON.stringify(payload)}`);
    const response=await fetch(`${this.apiUrl}/v1/tee-metrics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),signal:AbortSignal.timeout(10000)});
    if(response.ok)this.lastPublished=observedAt;
  }
}
