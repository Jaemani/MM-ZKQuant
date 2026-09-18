import { randomUUID } from 'node:crypto';

// Integer quote/token units, six decimals. This module owns attribution, never
// an aggregate investment target. The execution adapter owns physical balances.
export const SCALE=1000000n;
const UNIT_PRICE_SCALE=10n**24n;
const n=x=>BigInt(x),str=x=>String(x),sum=xs=>xs.reduce((a,b)=>a+n(b),0n);
const requireThat=(ok,message)=>{if(!ok)throw new Error(message);};
export const money=value=>{
  requireThat(/^\d+(\.\d{1,6})?$/.test(String(value)),'금액은 소수점 6자리 이내의 양수여야 합니다.');
  const [whole,fraction='']=String(value).split('.');return n(whole)*SCALE+n(fraction.padEnd(6,'0'));
};
export function newLedger(){return {schema:'PRIVATE_STRATEGY_LEDGER_V02',strategies:[],flows:[],orders:[],protocolAccrual:'0'};}
export class SleeveLedger {
  constructor(state=newLedger()){this.state=state;}
  sleeve(id){const s=this.state.strategies.find(s=>s.id===id);requireThat(s,'전략을 찾을 수 없습니다.');return s;}
  create({id=randomUUID(),provider,name,description,feeBps=1000}){
    requireThat(!this.state.strategies.some(s=>s.id===id)&&provider&&name,'유효하고 고유한 전략이 필요합니다.');
    requireThat(Number.isInteger(feeBps)&&feeBps>=0&&feeBps<=3000,'보수 한도 초과');
    const s={id,provider,name,description,feeBps,cash:'0',positions:{},shorts:{},units:'0',investors:{},providerAccrual:'0',highWater:UNIT_PRICE_SCALE.toString(),history:[],realizedPnl:'0',executionFees:'0'};
    this.state.strategies.push(s);return s;
  }
  equity(s,marks){
    let total=n(s.cash);
    for(const [asset,p] of Object.entries(s.positions)){requireThat(marks[asset]>0n,'평가 가격 누락');total+=n(p.quantity)*marks[asset]/SCALE;}
    for(const lot of Object.values(s.shorts)){requireThat(marks[lot.asset]>0n,'평가 가격 누락');total+=n(lot.escrow)-n(lot.debt)*marks[lot.asset]/SCALE;}
    return total;
  }
  investorPool(s,marks){return this.equity(s,marks)-n(s.providerAccrual);}
  // Largest remainders assign the last integer units explicitly. Displayed
  // claims therefore sum exactly to investor equity, including tiny balances.
  claims(s,marks){
    const equity=this.investorPool(s,marks),total=n(s.units);requireThat(equity>=0n,'전략 지급불능: 다른 전략에 손실을 전가할 수 없습니다.');
    const owners=Object.entries(s.investors).filter(([,u])=>n(u)>0n);
    if(!total){requireThat(equity===0n,'소유자 없는 전략 자본');return {};}
    const rows=owners.map(([owner,u])=>({owner,amount:equity*n(u)/total,remainder:equity*n(u)%total}));
    let dust=equity-sum(rows.map(r=>r.amount));
    rows.sort((a,b)=>a.remainder===b.remainder?a.owner.localeCompare(b.owner):a.remainder>b.remainder?-1:1);
    for(const row of rows)if(dust>0n){row.amount++;dust--;}
    return Object.fromEntries(rows.map(r=>[r.owner,str(r.amount)]));
  }
  idle(s){requireThat(Object.values(s.positions).every(p=>n(p.quantity)===0n)&&Object.keys(s.shorts).length===0,'해당 전략의 포지션 정산 후 자본을 이동할 수 있습니다.');}
  flow(id){requireThat(typeof id==='string'&&id.length>0&&!this.state.flows.includes(id),'중복 또는 잘못된 자본 이동 요청');}
  allocate({strategyId,investor,amount,requestId},marks){
    const s=this.sleeve(strategyId);this.idle(s);this.flow(requestId);amount=n(amount);requireThat(investor&&amount>0n,'투자자와 양수 금액 필요');
    const pool=this.investorPool(s,marks),supply=n(s.units);
    requireThat(supply===0n||pool>0n,'지급불능 전략에 지분 발행 불가');
    const units=supply===0n?amount:amount*supply/pool;requireThat(units>0n,'발행 단위보다 작은 금액');
    s.cash=str(n(s.cash)+amount);s.units=str(supply+units);s.investors[investor]=str(n(s.investors[investor]||0)+units);
    this.state.flows.push(requestId);return {units:str(units),amount:str(amount)};
  }
  redeem({strategyId,investor,units,requestId},marks){
    const s=this.sleeve(strategyId);this.idle(s);this.flow(requestId);units=n(units);const owned=n(s.investors[investor]||0);
    requireThat(units>0n&&units<=owned,'선택한 전략의 보유 지분을 초과했습니다.');
    const amount=n(this.claims(s,marks)[investor])*units/owned;
    requireThat(amount<=n(s.cash)-n(s.providerAccrual),'해당 전략의 출금 가능 현금 부족');
    s.cash=str(n(s.cash)-amount);s.units=str(n(s.units)-units);s.investors[investor]=str(owned-units);
    if(n(s.units)===0n)s.highWater=UNIT_PRICE_SCALE.toString();
    this.state.flows.push(requestId);return {amount:str(amount),units:str(units)};
  }
  recordFill({strategyId,orderId,asset,side,quantity,quote,fee,lotId}){
    const s=this.sleeve(strategyId);quantity=n(quantity);quote=n(quote);fee=n(fee);
    requireThat(orderId&&['BTC','ETH','MON','SOL'].includes(asset)&&quantity>0n&&quote>0n&&fee>=0n&&fee<quote,'체결 값 오류');
    requireThat(!this.state.orders.some(o=>o.orderId===orderId),'중복 체결');
    const available=n(s.cash)-n(s.providerAccrual),p=s.positions[asset]||{quantity:'0',cost:'0'};
    if(side==='BUY'){
      requireThat(quote+fee<=available,'다른 전략의 현금으로 매수할 수 없습니다.');
      s.cash=str(n(s.cash)-quote-fee);s.positions[asset]={quantity:str(n(p.quantity)+quantity),cost:str(n(p.cost)+quote+fee)};
    }else if(side==='SELL'){
      requireThat(quantity<=n(p.quantity),'다른 전략의 자산을 매도할 수 없습니다.');
      const basis=n(p.cost)*quantity/n(p.quantity);s.cash=str(n(s.cash)+quote-fee);
      s.positions[asset]={quantity:str(n(p.quantity)-quantity),cost:str(n(p.cost)-basis)};s.realizedPnl=str(n(s.realizedPnl)+quote-fee-basis);
    }else if(side==='SHORT_OPEN'){
      requireThat(lotId&&!s.shorts[lotId]&&quote<=available&&fee<quote,'해당 전략의 숏 담보 부족 또는 중복 차입');
      s.cash=str(n(s.cash)-quote);s.shorts[lotId]={asset,debt:str(quantity),escrow:str(2n*quote-fee),collateral:str(quote),entryProceeds:str(quote-fee)};
    }else if(side==='SHORT_CLOSE'){
      const lot=s.shorts[lotId];requireThat(lot&&lot.asset===asset&&n(lot.debt)===quantity,'차입 귀속 또는 상환 수량 불일치');
      const returned=n(lot.escrow)-quote-fee;requireThat(returned+available>=0n,'숏 손실을 다른 전략에 전가할 수 없습니다.');
      s.cash=str(n(s.cash)+returned);s.realizedPnl=str(n(s.realizedPnl)+n(lot.entryProceeds)-quote-fee);delete s.shorts[lotId];
    }else throw new Error('지원하지 않는 주문');
    s.executionFees=str(n(s.executionFees)+fee);
    this.state.orders.push({strategyId,orderId,asset,side,quantity:str(quantity),quote:str(quote),fee:str(fee),...(lotId?{lotId}:{})});
  }
  crystallize(id,marks){
    const s=this.sleeve(id);this.idle(s);const supply=n(s.units),before=this.investorPool(s,marks);
    if(!supply)return '0';
    const threshold=(supply*n(s.highWater)+UNIT_PRICE_SCALE-1n)/UNIT_PRICE_SCALE,profit=before>threshold?before-threshold:0n,fee=profit*BigInt(s.feeBps)/10000n;
    s.providerAccrual=str(n(s.providerAccrual)+fee);const price=((before-fee)*UNIT_PRICE_SCALE+supply-1n)/supply;
    if(price>n(s.highWater))s.highWater=str(price);
    s.history.push({unitPrice:str((before-fee)*SCALE/supply),equity:str(this.equity(s,marks)),providerFee:str(fee)});return str(fee);
  }
  payProvider(id,requestId){const s=this.sleeve(id);this.idle(s);this.flow(requestId);const amount=n(s.providerAccrual);requireThat(amount<=n(s.cash),'제공자 보수 현금 부족');s.cash=str(n(s.cash)-amount);s.providerAccrual='0';this.state.flows.push(requestId);return str(amount);}
  reconcile(custody,marks){
    const cash=sum(this.state.strategies.map(s=>s.cash))+n(this.state.protocolAccrual);
    requireThat(cash===n(custody.cash),'현금 대사 불일치');
    const assets=['BTC','ETH','MON','SOL'];let vault=n(custody.cash);
    for(const asset of assets){const total=sum(this.state.strategies.map(s=>s.positions[asset]?.quantity||0));requireThat(total===n(custody.positions[asset]||0),'자산 수량 대사 불일치');vault+=total*marks[asset]/SCALE;}
    const loans=this.state.strategies.flatMap(s=>Object.entries(s.shorts));requireThat(loans.length===Object.keys(custody.shorts).length,'차입 수 대사 불일치');
    for(const [id,lot] of loans){const actual=custody.shorts[id];requireThat(actual&&actual.asset===lot.asset&&n(actual.debt)===n(lot.debt)&&n(actual.escrow)===n(lot.escrow),'차입·담보 대사 불일치');vault+=n(actual.escrow)-n(actual.debt)*marks[actual.asset]/SCALE;}
    const equities=this.state.strategies.map(s=>{const equity=this.equity(s,marks);const claims=this.claims(s,marks);requireThat(sum(Object.values(claims))+n(s.providerAccrual)===equity,'전략 권리 대사 불일치');return {strategyId:s.id,equity:str(equity),investorClaims:claims,providerAccrual:s.providerAccrual};});
    // Integer price rounding can differ if quantities are valued after merging.
    // The custody equity uses the same attributed lot valuation; require the
    // aggregate mark discrepancy to stay within the exact integer bound.
    const attributed=sum(equities.map(e=>e.equity))+n(this.state.protocolAccrual),rounding=vault-attributed;
    requireThat(rounding>=0n&&rounding<BigInt(Math.max(1,this.state.strategies.length*assets.length)),'Vault equity 대사 불일치');
    return {balanced:true,vaultEquity:str(vault),strategyEquity:str(sum(equities.map(e=>e.equity))),protocolAccrual:str(n(this.state.protocolAccrual)+rounding),valuationRounding:str(rounding),equities};
  }
}
