import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import { Contract, Interface, getAddress, isAddress, verifyMessage } from 'ethers';
import { SealedStore } from '../../../src/integration/sealed.js';
import { investmentMessage } from '../../../src/platform/investment-message.js';
import { assertInvestmentStateEmpty,assertVaultRetirable } from '../../../src/platform/vault-retirement.js';
import {cashBook,cashBalance,allocateCash} from './cash-ledger.mjs';
import { newBook, investor, depositPending, portfolio, requestWithdrawal, requestPendingWithdrawal, cancelWithdrawal } from './ledger.mjs';

const depositEvents = new Interface(['event Deposit(bytes32 indexed id,address indexed investor,uint256 amount)']);
const vaultAbi = ['function operator() view returns (address)', 'function cash() view returns (address)'];
const decimalAmount = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value);
const hex32 = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

export class PrivateInvestments {
  constructor({ secret, storeDir, provider, operator, accessHash, catalogUrl, contract, wallet }) {
    this.store = new SealedStore(`${storeDir}/investments.json`, secret, 'private-investments-v1',{maxHexLength:128_000_000});
    this.provider = provider;
    this.contract=contract||((address,abi)=>new Contract(address,abi,this.provider));
    this.operator = getAddress(operator);
    this.accessHash = accessHash;
    this.catalogUrl = catalogUrl;
    this.apiUrl=catalogUrl.replace(/\/v1\/strategies$/, '');
    this.signingWallet=wallet;
    this.queue = Promise.resolve();
  }

  state() { const state = this.store.read() || { version: 2, config: null, usedNonces: {}, intents: {}, units: {} }; state.books ||= {}; for(const b of Object.values(state.books)){b.referenceUnits??='1000000000000000000';b.referenceHwm??='1000000000000000000';} return state; }
  mutate(fn) { const state = this.state(), result = fn(state); this.store.write(state); return result; }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }

  authorizeConfiguration(accessToken) {
    const supplied = createHash('sha256').update(String(accessToken || '')).digest('hex');
    if (!this.accessHash || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(this.accessHash, 'hex'))) throw Error('CONFIGURATION_FORBIDDEN');
  }

  async configure({ vaultAddress, cashTokenAddress, accessToken }) {
    this.authorizeConfiguration(accessToken);
    return this.pin({ vaultAddress, cashTokenAddress });
  }

  async retirementCheck({accessToken}) {
    this.authorizeConfiguration(accessToken);
    return this.serial(async()=>{
      const state=this.state();
      try {assertInvestmentStateEmpty(state);return await assertVaultRetirable({provider:this.provider,...state.config,requirePaused:false,contract:this.contract,executionAccountAddresses:Object.keys(state.sharedAccounts||{})});}
      catch(error){return {ready:false,error:error.message};}
    });
  }

  async pin({ vaultAddress, cashTokenAddress }) {
    if (!isAddress(vaultAddress) || !isAddress(cashTokenAddress)) throw Error('INVALID_ADDRESS');
    const vault = this.contract(vaultAddress,vaultAbi);
    if (getAddress(await vault.operator()) !== this.operator || getAddress(await vault.cash()) !== getAddress(cashTokenAddress)) throw Error('VAULT_CONFIGURATION_MISMATCH');
    return this.serial(async () => {
      const state=this.state();
      const config = { vaultAddress: getAddress(vaultAddress), cashTokenAddress: getAddress(cashTokenAddress) };
      if (state.config && JSON.stringify(state.config) !== JSON.stringify(config)) {
        if(state.config.cashTokenAddress!==config.cashTokenAddress)throw Error('VAULT_CASH_TOKEN_CHANGE_FORBIDDEN');
        assertInvestmentStateEmpty(state);
        await assertVaultRetirable({provider:this.provider,...state.config,contract:this.contract,executionAccountAddresses:Object.keys(state.sharedAccounts||{})});
        for(const b of Object.values(state.books)) {b.slots={};delete b.executionMode;}
        state.sharedAccounts={};
        for(const intent of Object.values(state.intents))if(intent.status==='PREPARED')intent.status='RETIRED';
        state.retiredVaults||=[];state.retiredVaults.push({...state.config,retiredAt:new Date().toISOString()});
      }
      state.config = config;
      this.store.write(state);
      return { configured: true, vaultAddress: config.vaultAddress };
    });
  }

  authenticated(state, input, expectedAction) {
    if (input.action !== expectedAction || !isAddress(input.wallet) || !hex32(input.nonce) || typeof input.signature !== 'string') throw Error('INVALID_REQUEST');
    const wallet = getAddress(input.wallet);
    if (state.usedNonces[`${wallet}:${input.nonce.toLowerCase()}`]) throw Error('NONCE_REPLAY');
    const signed = { ...input, wallet };
    let recovered;
    try { recovered = verifyMessage(investmentMessage(signed), input.signature); }
    catch { throw Error('INVALID_SIGNATURE'); }
    if (recovered !== wallet) throw Error('INVALID_SIGNATURE');
    state.usedNonces[`${wallet}:${input.nonce.toLowerCase()}`] = true;
    return wallet;
  }

  async prepare(input) {
    const state = this.state();
    if (!state.config) throw Error('VAULT_UNAVAILABLE');
    if (!/^[0-9a-f-]{36}$/i.test(input.strategyId || '') || !decimalAmount(input.amount)) throw Error('INVALID_ALLOCATION');
    const catalogResponse = await fetch(this.catalogUrl, { signal: AbortSignal.timeout(10_000) });
    if (!catalogResponse.ok) throw Error('CATALOG_UNAVAILABLE');
    const catalog = (await catalogResponse.json()).strategies || [];
    const strategy = catalog.find(strategy => strategy.id === input.strategyId && ['FUNDING','LIVE'].includes(strategy.status));
    if (!strategy) throw Error('STRATEGY_NOT_FUNDING');
    return this.serial(() => this.mutate(current => {
      const wallet = this.authenticated(current, input, 'PREPARE');
      current.books[input.strategyId] ||= newBook(strategy);
      const depositId = `0x${randomBytes(32).toString('hex')}`;
      current.intents[depositId] = { depositId, wallet, strategyId: input.strategyId, amount: input.amount, status: 'PREPARED', createdAt: new Date().toISOString() };
      return { depositId, vaultAddress: current.config.vaultAddress, cashTokenAddress: current.config.cashTokenAddress, amount: input.amount };
    }));
  }

  async complete(input) {
    if (!hex32(input.depositId) || !hex32(input.txHash)) throw Error('INVALID_DEPOSIT');
    return this.serial(async () => {
      const state = this.state(), intent = state.intents[input.depositId];
      if (!intent) throw Error('DEPOSIT_NOT_FOUND');
      if(intent.status==='RETIRED')throw Error('DEPOSIT_RETIRED');
      const wallet = this.authenticated(state, input, 'COMPLETE');
      if (wallet !== intent.wallet) throw Error('INVESTOR_MISMATCH');
      if (intent.status === 'CONFIRMED') return { ...intent };
      const [receipt, transaction] = await Promise.all([this.provider.getTransactionReceipt(input.txHash), this.provider.getTransaction(input.txHash)]);
      if (!receipt || receipt.status !== 1 || !transaction || getAddress(transaction.from) !== wallet || getAddress(transaction.to) !== state.config.vaultAddress) throw Error('DEPOSIT_RECEIPT_INVALID');
      const found = receipt.logs.some(log => {
        if (getAddress(log.address) !== state.config.vaultAddress) return false;
        try {
          const event = depositEvents.parseLog(log);
          return event?.name === 'Deposit' && event.args.id.toLowerCase() === input.depositId.toLowerCase() && getAddress(event.args.investor) === wallet && event.args.amount === BigInt(intent.amount);
        } catch { return false; }
      });
      if (!found) throw Error('DEPOSIT_EVENT_MISMATCH');
      intent.status = 'CONFIRMED';
      intent.txHash = input.txHash;
      intent.blockNumber = receipt.blockNumber;
      intent.confirmedAt = new Date().toISOString();
      const book = state.books[intent.strategyId];
      if (!book) throw Error('STRATEGY_BOOK_MISSING');
      depositPending(book, wallet, intent.amount);
      this.store.write(state);
      return { ...intent, units: '0', pending: intent.amount };
    });
  }

  async portfolio(input) {
    return this.serial(() => this.mutate(state => {
      const wallet = this.authenticated(state, input, 'PORTFOLIO');
      const positions = Object.values(state.books).filter(book => book.kind!=='CASH_ACCOUNT'&&book.investors[wallet.toLowerCase()]).map(book => portfolio(book,wallet));
      const deposits = Object.values(state.intents).filter(intent => intent.wallet === wallet).map(({ depositId, strategyId, amount, status, txHash, createdAt, confirmedAt }) => ({ depositId, strategyId, amount, status, txHash, createdAt, confirmedAt }));
      return { wallet, positions, deposits };
    }));
  }

  async withdrawal(input) {
    return this.serial(() => this.mutate(state => {
      const wallet = this.authenticated(state,input,input.action);
      const book = state.books[input.strategyId]; if (!book) throw Error('STRATEGY_NOT_FOUND');
      const now = Math.floor(Date.now()/1000);
      if(input.action==='WITHDRAW') return requestWithdrawal(book,wallet,input.amount,input.nonce,now);
      if(input.action==='WITHDRAW_PENDING') return requestPendingWithdrawal(book,wallet,input.amount,input.nonce,now);
      if(input.action==='CANCEL_WITHDRAWAL') return cancelWithdrawal(book,wallet,input.depositId,now);
      throw Error('INVALID_ACTION');
    }));
  }

  async account(input) {
    const body=input.action==='PREPARE_TOPUP'?{wallet:input.wallet}:{};
    const response=await fetch(`${this.apiUrl}/v1/account-authorization`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${input.sessionToken}`},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok){const failure=await response.json().catch(()=>({}));throw Error(failure.error||'ACCOUNT_AUTHORIZATION_FAILED');}
    const account=await response.json();
    if(!/^[0-9a-f-]{36}$/i.test(account.userId||''))throw Error('ACCOUNT_AUTHORIZATION_FAILED');
    if(account.wallet)account.wallet=getAddress(account.wallet);
    return account;
  }

  async bindAccount(userId,wallet) {
    if(!this.signingWallet)throw Error('WALLET_BINDING_UNAVAILABLE');
    const payload={userId,wallet,observedAt:Date.now()},signature=await this.signingWallet.signMessage(`VEILVEST_ACCOUNT_WALLET_V1\n${JSON.stringify(payload)}`);
    const response=await fetch(`${this.apiUrl}/v1/tee-wallet-binding`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),signal:AbortSignal.timeout(10000)});
    if(!response.ok){const failure=await response.json().catch(()=>({}));throw Error(failure.error||'WALLET_BINDING_FAILED');}
  }

  accountPortfolio(state,account) {
    const wallet=account.wallet;
    const positions=wallet?Object.values(state.books).filter(b=>b.kind!=='CASH_ACCOUNT'&&b.investors[wallet.toLowerCase()]).map(b=>portfolio(b,wallet)):[];
    const deposits=Object.values(state.intents).filter(i=>i.userId===account.userId||(wallet&&i.wallet===wallet)).map(({depositId,strategyId,amount,status,txHash,createdAt,confirmedAt})=>({depositId,strategyId,amount,status,txHash,createdAt,confirmedAt}));
    const cash=cashBalance(state,wallet);cash.withdrawals=cash.withdrawals.map(({job,...w})=>({...w,cancellable:w.status==='REQUESTED'&&!job?.steps?.pay}));
    const externalDeposited=deposits.filter(i=>i.status==='CONFIRMED').reduce((sum,i)=>sum+BigInt(i.amount),0n);
    const legacyPaid=positions.reduce((sum,p)=>sum+p.withdrawals.filter(w=>w.status==='PAID'&&w.destination!=='BALANCE').reduce((a,w)=>a+BigInt(w.amount||0),0n),0n);
    const cashPaid=cash.withdrawals.filter(w=>w.status==='PAID').reduce((sum,w)=>sum+BigInt(w.amount),0n);
    const completedRequestIds=Object.keys(state.accountRequests||{}).filter(key=>key.startsWith(`${account.userId}:`)).slice(-100).map(key=>key.slice(account.userId.length+1));
    return {userId:account.userId,wallet,positions,deposits,cash,completedRequestIds,externalDeposited:String(externalDeposited),externalWithdrawn:String(legacyPaid+cashPaid)};
  }

  async accountRequest(input) {
    const account=await this.account(input);
    // Session reads use the last atomically committed snapshot and never queue behind venue transactions.
    if(input.action==='PORTFOLIO')return this.accountPortfolio(this.state(),account);
    const id=input.requestId||input.nonce;
    if(!hex32(id))throw Error('INVALID_REQUEST_ID');
    let strategy;
    if(input.action==='ALLOCATE'){
      if(!decimalAmount(input.amount))throw Error('INVALID_ALLOCATION');
      const response=await fetch(this.catalogUrl,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('CATALOG_UNAVAILABLE');
      strategy=(await response.json()).strategies.find(s=>s.id===input.strategyId&&['FUNDING','LIVE'].includes(s.status)&&isAddress(s.strategist_wallet));
      if(!strategy)throw Error('STRATEGY_NOT_FUNDING');
    }
    return this.serial(async()=>{
      const state=this.state();if(!state.config)throw Error('VAULT_UNAVAILABLE');
      state.accountRequests||={};
      const key=`${account.userId}:${id}`,fields=[input.action,input.strategyId,input.amount,input.depositId,input.txHash,input.wallet];
      if(input.percentage!==undefined)fields.push({percentage:input.percentage});
      const fingerprint=createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      const prior=state.accountRequests[key];
      if(prior){if(prior.fingerprint!==fingerprint)throw Error('REQUEST_ID_REUSED');return prior.result;}
      let wallet=account.wallet,result;
      if(input.action==='PREPARE_TOPUP'){
        if(!isAddress(input.wallet)||!decimalAmount(input.amount))throw Error('INVALID_DEPOSIT');
        wallet=getAddress(input.wallet);
        if(account.wallet&&account.wallet!==wallet)throw Error('FUNDING_WALLET_MISMATCH');
        const depositId=`0x${randomBytes(32).toString('hex')}`;
        state.intents[depositId]={depositId,userId:account.userId,wallet,strategyId:null,amount:input.amount,status:'PREPARED',createdAt:new Date().toISOString()};
        result={depositId,vaultAddress:state.config.vaultAddress,cashTokenAddress:state.config.cashTokenAddress,amount:input.amount};
      }else if(input.action==='COMPLETE_TOPUP'||input.action==='COMPLETE'){
        if(!hex32(input.depositId)||!hex32(input.txHash))throw Error('INVALID_DEPOSIT');
        const intent=state.intents[input.depositId];
        if(!intent||!(intent.userId===account.userId||(!intent.userId&&wallet===intent.wallet)))throw Error('DEPOSIT_NOT_FOUND');
        if(intent.status==='RETIRED')throw Error('DEPOSIT_RETIRED');
        if(wallet&&wallet!==intent.wallet)throw Error('FUNDING_WALLET_MISMATCH');
        if(intent.status==='CONFIRMED')return {status:'CONFIRMED',depositId:intent.depositId,wallet:intent.wallet};
        const [receipt,tx]=await Promise.all([this.provider.getTransactionReceipt(input.txHash),this.provider.getTransaction(input.txHash)]);
        if(!receipt||receipt.status!==1||!tx||!tx.to||getAddress(tx.from)!==intent.wallet||getAddress(tx.to)!==state.config.vaultAddress)throw Error('DEPOSIT_RECEIPT_INVALID');
        const found=receipt.logs.some(log=>{try{if(getAddress(log.address)!==state.config.vaultAddress)return false;const e=depositEvents.parseLog(log);return e?.name==='Deposit'&&e.args.id.toLowerCase()===intent.depositId.toLowerCase()&&getAddress(e.args.investor)===intent.wallet&&e.args.amount===BigInt(intent.amount);}catch{return false;}});
        if(!found)throw Error('DEPOSIT_EVENT_MISMATCH');
        if(!account.wallet)await this.bindAccount(account.userId,intent.wallet);
        wallet=intent.wallet;
        const book=intent.strategyId?state.books[intent.strategyId]:cashBook(state,wallet);
        if(!book)throw Error('STRATEGY_BOOK_MISSING');
        depositPending(book,wallet,intent.amount);
        Object.assign(intent,{status:'CONFIRMED',txHash:input.txHash,blockNumber:receipt.blockNumber,confirmedAt:new Date().toISOString()});
        result={status:'CONFIRMED',depositId:intent.depositId,wallet};
      }else{
        if(!wallet)throw Error('ADD_FUNDS_FIRST');
        if(input.action==='ALLOCATE')result=allocateCash(state,strategy,wallet,input.amount,`allocate:${key}`);
        else if(['REDEEM','RETURN_PENDING','CANCEL_REDEMPTION'].includes(input.action)){
          const book=state.books[input.strategyId];if(!book||book.kind==='CASH_ACCOUNT')throw Error('STRATEGY_NOT_FOUND');
          const now=Math.floor(Date.now()/1000);
          if(input.action==='CANCEL_REDEMPTION')result=cancelWithdrawal(book,wallet,input.depositId,now);
          else{
            let amount=input.amount;
            if(input.action==='REDEEM'&&input.percentage!==undefined){
              if(!Number.isInteger(input.percentage)||input.percentage<1||input.percentage>100)throw Error('INVALID_REDEMPTION_PERCENTAGE');
              const reserved=Object.values(book.withdrawals).filter(w=>w.wallet.toLowerCase()===wallet.toLowerCase()&&w.kind!=='PENDING'&&['REQUESTED','SETTLING'].includes(w.status)).reduce((sum,w)=>sum+BigInt(w.units),0n);
              amount=String((BigInt(investor(book,wallet).units)-reserved)*BigInt(input.percentage)/100n);
            }
            result=input.action==='REDEEM'?requestWithdrawal(book,wallet,amount,id,now):requestPendingWithdrawal(book,wallet,input.amount,id,now);
            result.destination='BALANCE';
          }
        }else if(input.action==='WITHDRAW_CASH'){
          if(!decimalAmount(input.amount)||BigInt(input.amount)>BigInt(cashBalance(state,wallet).available))throw Error('INSUFFICIENT_PLATFORM_BALANCE');
          result=cashBook(state,wallet).withdrawals[id]={id,wallet,amount:input.amount,status:'REQUESTED',createdAt:Math.floor(Date.now()/1000)};
        }else if(input.action==='CANCEL_CASH_WITHDRAWAL'){
          const w=cashBook(state,wallet).withdrawals[input.depositId];
          if(!w||w.status!=='REQUESTED'||w.job?.steps?.pay)throw Error('CANNOT_CANCEL');
          w.status='CANCELLED';result=w;
        }else throw Error('INVALID_ACTION');
      }
      state.accountRequests[key]={fingerprint,result:JSON.parse(JSON.stringify(result))};
      this.store.write(state);return result;
    });
  }

  status() { const state = this.state(); return { available: Boolean(state.config), vaultAddress: state.config?.vaultAddress || null }; }
}
