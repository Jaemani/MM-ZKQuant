import { nextSettlement, validatePolicy } from '../../../src/platform/policy.js';

export const SCALE = 10n ** 18n;
const integer = x => BigInt(x || '0');
const positive = x => { const n = integer(x); if (n <= 0n) throw Error('POSITIVE_AMOUNT_REQUIRED'); return n; };
export function newBook(strategy) {
  return { id: strategy.id, manager: strategy.strategist_wallet, feeBps: strategy.fee_bps, policy: validatePolicy(strategy.policy), policyVersion: strategy.policy_version || 1, cash: '0', equity: '0', totalUnits: '0', nav: String(SCALE), peakNav: String(SCALE), baselineNav: String(SCALE), referenceUnits: String(SCALE), referenceHwm: String(SCALE), status: 'ACTIVE', sequence: 0, investors: {}, withdrawals: {}, slots: {}, requests: {}, marks: [], feesDue: '0' };
}
export function investor(book, wallet) {
  const key = wallet.toLowerCase();
  return book.investors[key] ||= { wallet, pending: '0', units: '0', lots: [], deposited: '0', paid: '0', fees: '0' };
}
export function depositPending(book, wallet, amount) {
  const p = investor(book, wallet), n = positive(amount);
  p.pending = String(integer(p.pending) + n); p.deposited = String(integer(p.deposited) + n);
}
// Equity supplied only by the venue adapter; excludes pending deposits and fees due.
export function markBook(book, equity, now = Date.now(), {assessRisk=true} = {}) {
  const n = integer(equity); if (n < 0n) throw Error('NEGATIVE_EQUITY');
  book.equity = String(n);
  if (integer(book.totalUnits)) book.nav = String(n * SCALE / integer(book.totalUnits));
  if (assessRisk && integer(book.nav) > integer(book.peakNav)) book.peakNav = book.nav;
  const nav = integer(book.nav), peak = integer(book.peakNav), baseline = integer(book.baselineNav);
  const drawdown = peak ? Number((peak - nav) * 10000n / peak) : 0;
  if(assessRisk)book.maxObservedDrawdownBps=Math.max(book.maxObservedDrawdownBps||0,drawdown);
  const loss = baseline > nav ? Number((baseline - nav) * 10000n / baseline) : 0;
  if (assessRisk && (drawdown >= book.policy.maxDrawdownBps || loss >= book.policy.stopLossBps)) { book.status = 'RISK_EXIT'; book.riskReason = drawdown >= book.policy.maxDrawdownBps ? 'MAX_DRAWDOWN' : 'STOP_LOSS'; }
  // Fixed hourly observations avoid exposing exact submission times via public metrics.
  const hour = Math.floor(now / 3600000) * 3600000;
  if (assessRisk && (!book.marks.length || book.marks.at(-1).time < hour)) book.marks.push({ time: hour, nav: book.nav });
  book.marks = book.marks.slice(-2160);
  return { nav: book.nav, drawdownBps: drawdown };
}
export function activatePending(book) {
  if (book.status !== 'ACTIVE') throw Error('STRATEGY_HALTED');
  const nav = positive(book.nav); let activated = 0n;
  for (const p of Object.values(book.investors)) {
    const reserved=Object.values(book.withdrawals).filter(w=>w.wallet.toLowerCase()===p.wallet.toLowerCase()&&w.kind==='PENDING'&&['REQUESTED','SETTLING'].includes(w.status)).reduce((a,w)=>a+integer(w.amount),0n);
    const amount = integer(p.pending)-reserved; if (!amount) continue;
    const units = amount * SCALE / nav; if (!units) throw Error('DEPOSIT_TOO_SMALL');
    p.lots.push({ units: String(units), hwm: String(nav) });
    p.units = String(integer(p.units) + units); p.pending = String(reserved);
    book.totalUnits = String(integer(book.totalUnits) + units); activated += amount;
  }
  book.cash = String(integer(book.cash) + activated); book.equity = String(integer(book.equity) + activated);
  return activated;
}

// Costs reserved for pending redemptions must not lower the continuing holders'
// risk NAV while a venue withdrawal or payout is being retried.
export function markVenueEquity(book, equity, options) {
  const settlement=book.settlement;
  let reservedCost=0n;
  if(settlement){
    if(!settlement.payouts)reservedCost=integer(settlement.cost);
    else reservedCost=settlement.withdrawalIds.filter(id=>book.withdrawals[id].status!=='PAID').reduce((sum,id)=>sum+integer(book.withdrawals[id].units)*integer(settlement.referenceNav||book.nav)/SCALE-integer(settlement.payouts[id]),0n);
  }
  const actual=integer(equity),riskValue=actual+reservedCost;
  markBook(book,riskValue>0n?riskValue:0n,Date.now(),options);
  book.equity=String(actual>0n?actual:0n);
}
export function requestWithdrawal(book, wallet, units, id, nowSeconds) {
  const p = investor(book, wallet), n = positive(units);
  if (book.withdrawals[id]) throw Error('REQUEST_EXISTS');
  const reserved = Object.values(book.withdrawals).filter(w => w.wallet.toLowerCase() === wallet.toLowerCase() && w.kind!=='PENDING' && ['REQUESTED', 'SETTLING'].includes(w.status)).reduce((a,w) => a + integer(w.units), 0n);
  if (n + reserved > integer(p.units)) throw Error('INSUFFICIENT_UNITS');
  const settlementAt = nextSettlement(book.policy, nowSeconds);
  return book.withdrawals[id] = { id, wallet, units: String(n), status: 'REQUESTED', settlementAt, cutoffAt: settlementAt - book.policy.withdrawalCutoffSeconds };
}
export function requestPendingWithdrawal(book,wallet,amount,id,nowSeconds) {
  const p=investor(book,wallet),value=positive(amount);
  if(book.withdrawals[id])throw Error('REQUEST_EXISTS');
  const reserved=Object.values(book.withdrawals).filter(w=>w.wallet.toLowerCase()===wallet.toLowerCase()&&w.kind==='PENDING'&&['REQUESTED','SETTLING'].includes(w.status)).reduce((a,w)=>a+integer(w.amount),0n);
  if(value+reserved>integer(p.pending))throw Error('INSUFFICIENT_PENDING_CASH');
  const settlementAt=nextSettlement(book.policy,nowSeconds);
  return book.withdrawals[id]={id,wallet,kind:'PENDING',amount:String(value),units:'0',status:'REQUESTED',settlementAt,cutoffAt:settlementAt-book.policy.withdrawalCutoffSeconds};
}
export function cancelWithdrawal(book, wallet, id, nowSeconds) {
  const w = book.withdrawals[id];
  if (!w || w.wallet.toLowerCase() !== wallet.toLowerCase() || w.status !== 'REQUESTED' || nowSeconds >= w.cutoffAt) throw Error('CANNOT_CANCEL');
  w.status = 'CANCELLED'; return w;
}
// Crystallize HWM fees by burning units at the current gross NAV. Preserve each
// subscription's own watermark, including when subscriptions occur after losses.
export function crystallizeFees(book, exitCosts = {}) {
  const nav = integer(book.nav); let fees = 0n;
  if(nav===0n)return 0n;
  const refGain=nav>integer(book.referenceHwm)?nav-integer(book.referenceHwm):0n;
  const refFee=integer(book.referenceUnits)*refGain*BigInt(book.feeBps)/(SCALE*10000n);
  book.referenceUnits=String(integer(book.referenceUnits)-refFee*SCALE/nav);
  if(refGain)book.referenceHwm=String(nav);
  for (const p of Object.values(book.investors)) {
    let burned = 0n, paid = 0n;
    const totalUnits=integer(p.units),exitCost=integer(exitCosts[p.wallet.toLowerCase()]);
    for (const lot of p.lots) {
      if (nav <= integer(lot.hwm)) continue;
      const gain=integer(lot.units)*(nav-integer(lot.hwm))/SCALE;
      const cost=totalUnits?exitCost*integer(lot.units)/totalUnits:0n;
      const fee = (gain>cost?gain-cost:0n)*BigInt(book.feeBps)/10000n;
      const burn = fee * SCALE / nav; const actualFee = burn * nav / SCALE;
      lot.units = String(integer(lot.units) - burn); lot.hwm = String(nav); burned += burn; paid += actualFee;
    }
    const oldUnits = integer(p.units); p.units = String(oldUnits - burned); p.fees = String(integer(p.fees) + paid);
    // Redemption requests reserve a fraction of the investor's stake. Deduct
    // fees from that same stake instead of leaving more reserved units than exist.
    for (const w of Object.values(book.withdrawals)) if (w.kind!=='PENDING' && w.wallet.toLowerCase() === p.wallet.toLowerCase() && ['REQUESTED','SETTLING'].includes(w.status) && oldUnits) w.units = String(integer(w.units) * integer(p.units) / oldUnits);
    book.totalUnits = String(integer(book.totalUnits) - burned); fees += paid;
  }
  book.equity = String(integer(book.equity) - fees); book.feesDue = String(integer(book.feesDue) + fees);
  return fees;
}
export function portfolio(book, wallet) {
  const p = investor(book, wallet), nav = integer(book.nav);
  const accruedFee=p.lots.reduce((a,l)=>a+(nav>integer(l.hwm)?integer(l.units)*(nav-integer(l.hwm))*BigInt(book.feeBps)/(SCALE*10000n):0n),0n);
  return { strategyId: book.id, units: p.units, pending: p.pending, deposited:p.deposited, value: String(integer(p.units) * nav / SCALE-accruedFee), accruedFee:String(accruedFee), paid: p.paid, fees: p.fees, status: book.status, withdrawals: Object.values(book.withdrawals).filter(w => w.wallet.toLowerCase() === wallet.toLowerCase()) };
}
export function publicMetrics(book) {
  const p = book.investors[book.manager.toLowerCase()], nav = integer(book.nav);
  const fees = p ? p.lots.reduce((sum,l) => sum + (nav > integer(l.hwm) ? integer(l.units) * (nav-integer(l.hwm)) * BigInt(book.feeBps) / (SCALE*10000n) : 0n), 0n) : 0n;
  const returns = book.marks.slice(1).flatMap((m,i) => integer(book.marks[i].nav)>0n ? [Number(integer(m.nav) * 1000000n / integer(book.marks[i].nav) - 1000000n) / 1000000] : []);
  const mean = returns.length ? returns.reduce((a,b)=>a+b,0)/returns.length : 0;
  const volatilityBps = returns.length > 1 ? Math.round(Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1))*Math.sqrt(24*365)*10000) : null;
  const refValue=integer(book.referenceUnits)*nav/SCALE;
  const refFee=nav>integer(book.referenceHwm)?integer(book.referenceUnits)*(nav-integer(book.referenceHwm))*BigInt(book.feeBps)/(SCALE*10000n):0n;
  return { source: 'TEE_LIVE', pnlBps: Number((refValue-refFee-SCALE)*10000n/SCALE), volatilityBps, maxDrawdownBps: book.maxObservedDrawdownBps||0, managerActive: p ? String(integer(p.units)*nav/SCALE-fees) : '0', managerPending: p?.pending || '0', managerWithdrawing: p ? String(Object.values(book.withdrawals).filter(w=>w.wallet.toLowerCase()===p.wallet.toLowerCase()&&['REQUESTED','SETTLING'].includes(w.status)).reduce((a,w)=>a+(w.kind==='PENDING'?integer(w.amount):integer(w.units)*nav/SCALE),0n)) : '0', status: book.status,policyVersion:book.policyVersion||1 };
}

export function burnWithdrawal(book,w,amount) {
  const p=investor(book,w.wallet),units=integer(w.units),oldUnits=integer(p.units);
  if(units>oldUnits||integer(amount)>integer(book.cash)-integer(book.feesDue))throw Error('WITHDRAWAL_ACCOUNTING');
  let remaining=units;
  // Proportional series burn preserves subscription-specific high watermarks.
  for(let i=0;i<p.lots.length;i++) {
    const lot=p.lots[i],take=integer(lot.units)*units/oldUnits;
    lot.units=String(integer(lot.units)-take);remaining-=take;
  }
  for(const lot of p.lots){const take=integer(lot.units)<remaining?integer(lot.units):remaining;lot.units=String(integer(lot.units)-take);remaining-=take;if(!remaining)break;}
  p.units=String(oldUnits-units);p.paid=String(integer(p.paid)+integer(amount));
  book.totalUnits=String(integer(book.totalUnits)-units);book.cash=String(integer(book.cash)-integer(amount));
  book.equity=String(integer(book.equity)-integer(amount));w.amount=String(amount);w.status='PAID';
  if(integer(book.totalUnits))book.nav=String(integer(book.equity)*SCALE/integer(book.totalUnits));
  else if(units)book.nav=String(integer(amount)*SCALE/units);
}
