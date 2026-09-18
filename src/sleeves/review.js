import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { SleeveLedger, SCALE, money } from './ledger.js';
import { atomicJson } from '../pilot/chain.js';

// Explicitly an isolated accounting review, not an external execution adapter.
// Simulated custody is independent state and receives opaque order identifiers.
export function reviewFixture(){
  const l=new SleeveLedger();
  l.create({id:'btc-trend',provider:'검토 제공자 A',name:'BTC 상승 전략',description:'자기 전략 자본의 25%를 BTC 상승 방향으로 운용하는 회계 검토 예제.'});
  l.create({id:'btc-hedge',provider:'검토 제공자 B',name:'BTC 하락 전략',description:'자기 전략 자본의 25%로 BTC를 차입·매도하는 회계 검토 예제.'});
  l.create({id:'cash-reserve',provider:'검토 제공자 A',name:'현금 유지 전략',description:'같은 제공자의 다른 전략도 별도 지분·성과를 갖는 예제.'});
  return {mode:'ISOLATED_ACCOUNTING_REVIEW',ledger:l.state,marks:{BTC:money(100).toString(),ETH:money(100).toString(),MON:money(1).toString(),SOL:money(100).toString()},custody:{identity:'ONE_REVIEW_OMNIBUS_VAULT',cash:'0',positions:{},shorts:{},events:[]},wallets:{'review-a':money(200000).toString(),'review-b':money(200000).toString()},cycles:0};
}
const marksOf=s=>Object.fromEntries(Object.entries(s.marks).map(([k,v])=>[k,BigInt(v)]));
export class SleeveReview {
  constructor(path){this.path=path;this.state=path&&existsSync(path)?JSON.parse(readFileSync(path)):reviewFixture();}
  mutate(fn){const next=structuredClone(this.state),ledger=new SleeveLedger(next.ledger);const result=fn(next,ledger);ledger.reconcile(next.custody,marksOf(next));if(this.path)atomicJson(this.path,next);this.state=next;return result;}
  investor(id){if(!Object.hasOwn(this.state.wallets,id))throw new Error('로컬 검토 투자자를 선택하세요.');}
  allocate({investor,strategyId,amount,requestId}){
    this.investor(investor);const cash=money(amount);
    return this.mutate((s,l)=>{if(cash>BigInt(s.wallets[investor]))throw new Error('검토 지갑 잔액 부족');const result=l.allocate({strategyId,investor,amount:cash,requestId},marksOf(s));s.wallets[investor]=String(BigInt(s.wallets[investor])-cash);s.custody.cash=String(BigInt(s.custody.cash)+cash);s.custody.events.push({id:randomUUID(),type:'DEPOSIT',amount:String(cash),vault:s.custody.identity});return result;});
  }
  redeem({investor,strategyId,requestId}){
    this.investor(investor);
    return this.mutate((s,l)=>{const units=l.sleeve(strategyId).investors[investor]||'0';const result=l.redeem({strategyId,investor,units,requestId},marksOf(s));s.wallets[investor]=String(BigInt(s.wallets[investor])+BigInt(result.amount));s.custody.cash=String(BigInt(s.custody.cash)-BigInt(result.amount));s.custody.events.push({id:randomUUID(),type:'WITHDRAW',amount:result.amount,vault:s.custody.identity});return result;});
  }
  cycle({moveBps=1000}={}){
    if(!Number.isInteger(moveBps)||moveBps< -2000||moveBps>2000)throw new Error('검토 가격 변화는 ±20% 이내입니다.');
    return this.mutate((s,l)=>{
      if(!l.state.strategies.some(a=>BigInt(a.units)>0n))throw new Error('먼저 선택한 전략에 검토 자본을 배정하세요.');
      const fill=(strategyId,side,qty,lotId)=>{
        const quote=qty*BigInt(s.marks.BTC)/SCALE,fee=quote/10000n;
        const f={strategyId,orderId:randomUUID(),asset:'BTC',side,quantity:String(qty),quote:String(quote),fee:String(fee),...(lotId?{lotId}:{})};
        // First authorize against that sleeve. An invalid fill rolls back the
        // whole review operation, including custody and prior fills.
        l.recordFill(f);
        const c=s.custody;
        if(side==='BUY'){c.cash=String(BigInt(c.cash)-quote-fee);c.positions.BTC=String(BigInt(c.positions.BTC||0)+qty);}
        if(side==='SELL'){c.cash=String(BigInt(c.cash)+quote-fee);c.positions.BTC=String(BigInt(c.positions.BTC||0)-qty);}
        if(side==='SHORT_OPEN'){c.cash=String(BigInt(c.cash)-quote);c.shorts[lotId]={asset:'BTC',debt:String(qty),escrow:String(2n*quote-fee)};}
        if(side==='SHORT_CLOSE'){c.cash=String(BigInt(c.cash)+BigInt(c.shorts[lotId].escrow)-quote-fee);delete c.shorts[lotId];}
        const {strategyId:privateStrategy,...publicFill}=f;c.events.push({...publicFill,vault:c.identity,type:'FILL'});
        l.reconcile(c,marksOf(s));
      };
      const entered=[];
      for(const a of l.state.strategies){if(a.id==='cash-reserve'||!BigInt(a.units))continue;const capital=l.investorPool(a,marksOf(s)),qty=capital/4n*SCALE/BigInt(s.marks.BTC);if(qty===0n)continue;const lotId=randomUUID(),short=a.id==='btc-hedge';fill(a.id,short?'SHORT_OPEN':'BUY',qty,short?lotId:undefined);entered.push({id:a.id,qty,short,lotId});}
      s.marks.BTC=String(BigInt(s.marks.BTC)*BigInt(10000+moveBps)/10000n);
      l.reconcile(s.custody,marksOf(s));
      for(const a of entered)fill(a.id,a.short?'SHORT_CLOSE':'SELL',a.qty,a.short?a.lotId:undefined);
      for(const a of l.state.strategies)l.crystallize(a.id,marksOf(s));
      s.cycles++;return {cycle:s.cycles,controlledPrice:true};
    });
  }
  view(investor='review-a'){
    this.investor(investor);const s=this.state,l=new SleeveLedger(s.ledger),marks=marksOf(s),r=l.reconcile(s.custody,marks);
    const catalog=s.ledger.strategies.map(a=>({id:a.id,provider:a.provider,name:a.name,description:a.description,feeBps:a.feeBps,
      strategyEquity:String(l.equity(a,marks)),investorEquity:String(l.investorPool(a,marks)),units:a.units,unitPrice:BigInt(a.units)?String(l.investorPool(a,marks)*SCALE/BigInt(a.units)):String(SCALE),
      providerAccrual:a.providerAccrual,history:a.history,source:'CONTROLLED_REVIEW_FIXTURE',forwardTrackRecord:false}));
    const portfolio=s.ledger.strategies.filter(a=>BigInt(a.investors[investor]||0)>0n).map(a=>({strategyId:a.id,name:a.name,units:a.investors[investor],claim:l.claims(a,marks)[investor]}));
    const {equities,...publicReconciliation}=r;
    return {mode:s.mode,tee:false,chainConnected:false,investor,wallet:s.wallets[investor],catalog,portfolio,cycles:s.cycles,
      vault:{identity:s.custody.identity,...publicReconciliation},executionCount:s.custody.events.filter(e=>e.type==='FILL').length,
      explanation:'새 전략별 회계를 확인하는 격리된 검토 환경입니다. 실제 제공자·투자금·체인 거래·forward 성과가 아닙니다. 기존 테스트넷 자금과 연결되지 않습니다.'};
  }
}
