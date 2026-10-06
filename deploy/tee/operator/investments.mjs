import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import { Contract, Interface, getAddress, isAddress, verifyMessage } from 'ethers';
import { SealedStore } from '../../../src/integration/sealed.js';
import { investmentMessage } from '../../../src/platform/investment-message.js';
import { assertInvestmentStateEmpty,assertVaultRetirable } from '../../../src/platform/vault-retirement.js';
import { newBook, depositPending, portfolio, requestWithdrawal, requestPendingWithdrawal, cancelWithdrawal } from './ledger.mjs';

const depositEvents = new Interface(['event Deposit(bytes32 indexed id,address indexed investor,uint256 amount)']);
const vaultAbi = ['function operator() view returns (address)', 'function cash() view returns (address)'];
const decimalAmount = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value);
const hex32 = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

export class PrivateInvestments {
  constructor({ secret, storeDir, provider, operator, accessHash, catalogUrl, contract }) {
    this.store = new SealedStore(`${storeDir}/investments.json`, secret, 'private-investments-v1',{maxHexLength:128_000_000});
    this.provider = provider;
    this.contract=contract||((address,abi)=>new Contract(address,abi,this.provider));
    this.operator = getAddress(operator);
    this.accessHash = accessHash;
    this.catalogUrl = catalogUrl;
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
      const positions = Object.values(state.books).filter(book => book.investors[wallet.toLowerCase()]).map(book => portfolio(book,wallet));
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

  status() { const state = this.state(); return { available: Boolean(state.config), vaultAddress: state.config?.vaultAddress || null }; }
}
