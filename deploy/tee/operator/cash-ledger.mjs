import {newBook,investor,depositPending,burnWithdrawal} from './ledger.mjs';
import {ledgerEvent} from './ledger-journal.mjs';
const n=x=>BigInt(x||0);
export const cashBookId=wallet=>`cash:${wallet.toLowerCase()}`;
export function cashBook(state,wallet) {
  const id=cashBookId(wallet);
  if(!state.books[id])state.books[id]={...newBook({id,strategist_wallet:wallet,fee_bps:0}),kind:'CASH_ACCOUNT'};
  return state.books[id];
}
export function cashBalance(state,wallet) {
  if(!wallet)return {available:'0',reserved:'0',total:'0',withdrawals:[]};
  const book=state.books[cashBookId(wallet)];
  if(!book)return {available:'0',reserved:'0',total:'0',withdrawals:[]};
  const p=book.investors[wallet.toLowerCase()],withdrawals=Object.values(book.withdrawals);
  const total=n(p?.pending),reserved=withdrawals.filter(w=>['REQUESTED','SETTLING'].includes(w.status)).reduce((sum,w)=>sum+n(w.amount),0n);
  if(reserved>total)throw Error('CASH_ACCOUNTING_MISMATCH');
  return {available:String(total-reserved),reserved:String(reserved),total:String(total),withdrawals};
}
export function debitPending(book,wallet,amount,values={}) {
  const p=investor(book,wallet),value=n(amount);
  if(value<=0n||value>n(p.pending))throw Error('INSUFFICIENT_PLATFORM_BALANCE');
  p.pending=String(n(p.pending)-value);p.paid=String(n(p.paid)+value);
  ledgerEvent(book,'PENDING_PAY',{wallet:p.wallet,amount:String(value),...values});
}
export function transferCredit(state,from,to,wallet,amount,id) {
  const value=n(amount);if(value===0n)return;
  state.cashTransfers||={};
  if(state.cashTransfers[id])throw Error('TRANSFER_ALREADY_APPLIED');
  depositPending(to,wallet,String(value));
  const event=to.zkLedger.events.at(-1);event.transferId=id;event.direction='CREDIT';
  state.cashTransfers[id]={from:from.id,to:to.id,wallet,amount:String(value)};
}
export function allocateCash(state,strategy,wallet,amount,id) {
  if(n(amount)>n(cashBalance(state,wallet).available))throw Error('INSUFFICIENT_PLATFORM_BALANCE');
  const from=cashBook(state,wallet),to=state.books[strategy.id] ||= newBook(strategy);
  if(to.kind==='CASH_ACCOUNT'||to.status!=='ACTIVE')throw Error('STRATEGY_HALTED');
  debitPending(from,wallet,amount,{transferId:id,direction:'DEBIT'});
  transferCredit(state,from,to,wallet,amount,id);
  return {strategyId:strategy.id,amount,status:'PENDING'};
}
export function redeemToCash(state,book,w,amount) {
  if(w.status==='PAID')return;
  const id=`redeem:${book.id}:${w.id}`,value=n(amount);
  if(w.kind==='PENDING')debitPending(book,w.wallet,String(value),{transferId:id,direction:'DEBIT'});
  else {
    burnWithdrawal(book,w,value);
    const event=book.zkLedger.events.at(-1);event.transferId=id;event.direction='DEBIT';
  }
  transferCredit(state,book,cashBook(state,w.wallet),w.wallet,String(value),id);
  w.amount=String(value);w.status='PAID';w.destination='BALANCE';w.paidAt=Math.floor(Date.now()/1000);delete w.error;
}
// Pair validation is an enclave invariant, not an additional claim of the v1 circuit.
export function assertCashTransfers(tasks,transfers={}) {
  const pairs=new Map();
  for(const task of tasks)for(const event of task.events)if(event.transferId){
    const pair=pairs.get(event.transferId)||[];pair.push({bookId:task.bookId,...event});pairs.set(event.transferId,pair);
  }
  for(const [id,pair] of pairs){
    const transfer=transfers[id],debit=pair.find(e=>e.direction==='DEBIT'),credit=pair.find(e=>e.direction==='CREDIT');
    if(pair.length!==2||!transfer||!debit||!credit||debit.bookId!==transfer.from||credit.bookId!==transfer.to||debit.wallet.toLowerCase()!==credit.wallet.toLowerCase()||debit.wallet.toLowerCase()!==transfer.wallet.toLowerCase()||debit.amount!==credit.amount||debit.amount!==transfer.amount)throw Error('CASH_TRANSFER_RECONCILIATION_REQUIRED');
  }
}
