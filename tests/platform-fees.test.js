import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Interface,keccak256,toUtf8Bytes} from 'ethers';
import {PlatformExecution} from '../deploy/tee/operator/execution.mjs';
import {PlatformService} from '../src/platform/service.js';
import {newBook,depositPending,activatePending,markBook,crystallizeFees,managerFeeTotals,publicMetrics} from '../deploy/tee/operator/ledger.mjs';

const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const opaque=value=>keccak256(toUtf8Bytes(value));
const vaultInterface=new Interface(['function withdraw(address,uint256,bytes32)']);
function fixture() {
  const book=newBook({id:'s',strategist_wallet:owner,fee_bps:2000});
  const state={books:{s:book}},records={},e=Object.create(PlatformExecution.prototype);
  e.save=()=>{};e.submitter={lookup:id=>records[id]};
  e.investments={state:()=>state,serial:fn=>fn()};
  depositPending(book,owner,'100000000');activatePending(book);
  return {book,state,records,e};
}
function legacyPayment(f,sequence,amount,{recipient=owner,status=1,block=sequence}={}) {
  const jobId=opaque(`fee:s:${sequence}`),id=opaque(`${jobId}:pay`);
  f.records[id]={hash:`0x${String(sequence).padStart(64,'0')}`,status,block,
    fingerprint:JSON.stringify({to:other,data:vaultInterface.encodeFunctionData('withdraw',[recipient,amount,opaque(jobId)])})};
  f.book.feePaymentSequence=Math.max(f.book.feePaymentSequence||0,sequence);
  return {jobId,id,record:f.records[id]};
}

test('owner fee estimates aggregate active subscriptions with separate watermarks, excluding pending cash and unrecovered losses',()=>{
  const {book}=fixture();markBook(book,'120000000');
  depositPending(book,other,'60000000');activatePending(book);
  depositPending(book,other,'50000000');markBook(book,'225000000');
  assert.equal(managerFeeTotals(book).estimated,'13000000');
  assert.equal(managerFeeTotals(book).paid,'0');assert.equal(managerFeeTotals(book).outstanding,'0');
  markBook(book,'135000000');assert.equal(managerFeeTotals(book).estimated,'0');
});

test('crystallized receivables become actual paid income once, with a retained receipt',async()=>{
  const {book,state,e}=fixture();markBook(book,'120000000');book.cash='120000000';
  const due=String(crystallizeFees(book));assert.ok(BigInt(due)>0n);
  assert.equal(e.performanceFees(book).outstanding,due);assert.equal(e.performanceFees(book).paid,'0');
  const result={hash:'0xpaid',block:12},effect={bookId:'s',kind:'FEE',amount:due};
  await e.applyEffect(state,effect,result);const cash=book.cash;
  await e.applyEffect(state,effect,result);
  const fees=e.performanceFees(book);
  assert.equal(book.cash,cash);assert.equal(fees.paid,due);assert.equal(fees.outstanding,'0');
  assert.equal(fees.payments.length,1);assert.equal(fees.payments[0].blockNumber,12);
  assert.equal(fees.historyComplete,true);assert.equal(fees.paymentState,'NONE');
});

test('legacy journal restores only confirmed manager fee payouts and keeps lifetime income even when details are incomplete',()=>{
  const f=fixture();f.book.investors[owner].fees='8000000';f.book.feesDue='2000000';
  legacyPayment(f,1,'6000000');legacyPayment(f,2,'9000000',{recipient:other});
  legacyPayment(f,3,'9000000',{status:0});
  let fees=f.e.performanceFees(f.book);
  assert.equal(fees.paid,'6000000');assert.equal(fees.payments.length,1);assert.equal(fees.historyComplete,true);
  assert.equal(fees.payments[0].paidAt,null);
  f.records={};f.e.submitter.lookup=()=>undefined;fees=f.e.performanceFees(f.book);
  assert.equal(fees.paid,'6000000');assert.equal(fees.payments.length,0);assert.equal(fees.historyComplete,false);
});

test('fee payment interrupted after chain confirmation resumes without a second payment or duplicate ledger debit',async()=>{
  const f=fixture();markBook(f.book,'120000000');f.book.cash='120000000';crystallizeFees(f.book);
  let saved,crash=true,broadcasts=0;
  f.e.save=state=>{if(crash&&broadcasts)throw Error('PROCESS_CRASH');saved=structuredClone(state);};
  f.e.vault=()=>({withdraw:{populateTransaction:async(recipient,amount,id)=>({to:other,data:vaultInterface.encodeFunctionData('withdraw',[recipient,amount,id])})}});
  f.e.submitter.submit=async(id,request)=>{broadcasts++;return f.records[id]={hash:'0xfeeconfirmed',status:1,block:42,fingerprint:JSON.stringify(request)};};
  await assert.rejects(()=>f.e.payFees(f.state,f.book),/PROCESS_CRASH/);
  assert.ok(BigInt(saved.books.s.feesDue)>0n);
  f.e.investments.state=()=>saved;
  const waiting=await f.e.accept.call(Object.assign(f.e,{authorize:async()=>({id:'s'})}),{action:'STATUS'});
  assert.equal(waiting.performanceFees.paymentState,'CONFIRMING');assert.equal(waiting.performanceFees.paid,'0');
  assert.equal(waiting.performanceFees.payments[0].status,'CONFIRMING');
  crash=false;await f.e.payFees(saved,saved.books.s);await f.e.payFees(saved,saved.books.s);
  assert.equal(broadcasts,1);assert.equal(saved.books.s.feePayouts.length,1);
  assert.equal(saved.books.s.feesDue,'0');assert.equal(f.e.performanceFees(saved.books.s).historyComplete,true);
});

test('fees remain distinguishable during unavailable valuation, settlement, cash shortage and reverted payments',()=>{
  const f=fixture();markBook(f.book,'120000000');crystallizeFees(f.book);f.book.cash='0';
  assert.equal(f.e.performanceFees(f.book).paymentState,'WAITING_CASH');
  f.book.valuationError='RPC_UNAVAILABLE';let fees=f.e.performanceFees(f.book);
  assert.equal(fees.estimated,null);assert.equal(fees.paymentState,'WAITING_PLATFORM');assert.ok(BigInt(fees.outstanding)>0n);
  delete f.book.valuationError;f.book.settlement={};fees=f.e.performanceFees(f.book);
  assert.equal(fees.estimated,null);assert.equal(fees.paymentState,'SETTLING');
  delete f.book.settlement;const failed=legacyPayment(f,1,'1000',{status:0});
  f.book.feePayment={id:failed.jobId,steps:{pay:{id:failed.id}}};
  assert.equal(f.e.performanceFees(f.book).paymentState,'FAILED');
});

test('real platform ownership authorization denies another strategist before accessing private fee books',async()=>{
  const f=fixture(),token=`mmq_test_${'a'.repeat(30)}`;
  const keyHash=createHash('sha256').update(`MMQ_API_KEY_V1:${token}`).digest('hex');
  let wallet=other,bookReads=0;
  const service=new PlatformService({query:async(sql,params)=>{
    if(sql.startsWith('SELECT id,strategist_wallet,key_hash'))return {rows:[{id:'key',strategist_wallet:wallet,key_hash:keyHash}]};
    if(sql.startsWith('SELECT * FROM strategies'))return {rows:params[1]===owner?[{id:'s',strategist_wallet:owner}]:[]};
    throw Error(`Unexpected query: ${sql}`);
  }});
  f.e.authorize=input=>service.authorizeStrategy(`Bearer ${input.apiKey}`,input.strategyId);
  f.e.investments.state=()=>{bookReads++;return f.state;};
  await assert.rejects(()=>f.e.accept({action:'STATUS',strategyId:'s',apiKey:token}),/STRATEGY_FORBIDDEN/);
  assert.equal(bookReads,0);wallet=owner;
  const result=await f.e.accept({action:'STATUS',strategyId:'s',apiKey:token});
  assert.equal(result.performanceFees.paid,'0');assert.equal(bookReads,1);
  assert.ok(!JSON.stringify(result.performanceFees).includes(owner));
  const publicData=publicMetrics(f.book);
  for(const key of ['performanceFees','estimated','outstanding','paid','payments','investors','slots'])assert.ok(!(key in publicData));
});
