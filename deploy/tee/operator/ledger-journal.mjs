// Financial transition records are persisted with the ledger in its sealed store.
// Repeated market observations are coalesced only between monetary mutations.
export const LEDGER_OP = Object.freeze({NONE:0,DEPOSIT:1,MINT:2,FEE:3,BURN:4,PAY:5,PENDING_PAY:6,VENUE:7,MARK:8,FEE_PAY:9,POLICY:10,VALUE:11,REGISTER:12});
const clone=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));
export function financialSnapshot(book) {
  return clone({id:book.id,manager:book.manager,feeBps:book.feeBps,cash:book.cash,equity:book.equity,totalUnits:book.totalUnits,nav:book.nav,feesDue:book.feesDue,
    investors:Object.fromEntries(Object.entries(book.investors).map(([key,p])=>[key,{wallet:p.wallet,pending:p.pending,units:p.units,deposited:p.deposited,paid:p.paid,fees:p.fees,lots:p.lots}]))});
}
export function initializeLedgerJournal(book) {
  if(!book.zkLedger)book.zkLedger={version:1,baseline:financialSnapshot(book),events:[],pendingMark:null};
  return book;
}
export function flushLedgerMark(book) {
  const audit=book.zkLedger;if(!audit?.pendingMark)return;
  audit.events.push(audit.pendingMark);audit.pendingMark=null;
}
export function ledgerEvent(book,kind,values={}) {
  if(!book.zkLedger)return;
  flushLedgerMark(book);
  book.zkLedger.events.push(clone({kind,...values}));
}
export function ledgerMark(book,basis) {
  if(!book.zkLedger)return;
  book.zkLedger.pendingMark={kind:'MARK',basis:String(basis),equity:book.equity,observedAt:Math.floor(Date.now()/1000)};
}
export function ledgerValue(book) {
  if(!book.zkLedger)return;
  if(book.zkLedger.pendingMark)book.zkLedger.pendingMark.equity=book.equity;
  else ledgerEvent(book,'VALUE',{equity:book.equity});
}
