import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SleeveLedger, money } from '../src/sleeves/ledger.js';
import { SleeveReview } from '../src/sleeves/review.js';
const allocate=(r,strategyId,investor='review-a',amount='100000',requestId=crypto.randomUUID())=>r.allocate({strategyId,investor,amount,requestId});

test('one custody, independent long and short claims, attributed costs and per-strategy provider accrual',()=>{
  const r=new SleeveReview();allocate(r,'btc-trend');allocate(r,'btc-hedge','review-b');r.cycle();
  const a=r.view('review-a'),b=r.view('review-b');
  assert.ok(BigInt(a.portfolio[0].claim)>money(100000));assert.ok(BigInt(b.portfolio[0].claim)<money(100000));
  assert.equal(a.portfolio.length,1);assert.equal(a.portfolio[0].strategyId,'btc-trend');
  assert.equal(a.vault.identity,b.vault.identity);assert.equal(a.executionCount,4);
  assert.equal(BigInt(a.vault.vaultEquity),BigInt(a.vault.strategyEquity)+BigInt(a.vault.protocolAccrual));
  assert.ok(BigInt(a.catalog[0].providerAccrual)>0n);assert.equal(a.catalog[1].providerAccrual,'0');
  assert.equal(Object.keys(r.state.custody.shorts).length,0);
  assert.equal(r.state.custody.events.some(e=>'strategyId' in e||'provider' in e),false);
  assert.equal(r.state.ledger.orders.filter(o=>o.strategyId==='btc-trend').length,2);
});

test('a different strategy losing money does not change this investor claim',()=>{
  const solo=new SleeveReview(),shared=new SleeveReview();
  for(const r of [solo,shared])allocate(r,'btc-trend');
  allocate(shared,'btc-hedge','review-b');solo.cycle();shared.cycle();
  assert.equal(solo.view().portfolio[0].claim,shared.view().portfolio[0].claim);
});

test('one investor may choose several strategies and redeem one without redeeming the other',()=>{
  const r=new SleeveReview();allocate(r,'btc-trend','review-a','50000');allocate(r,'cash-reserve','review-a','30000');r.cycle();
  const cash=r.view().portfolio.find(p=>p.strategyId==='cash-reserve').claim;
  r.redeem({investor:'review-a',strategyId:'btc-trend',requestId:'redemption'});
  assert.equal(r.view().portfolio.length,1);assert.equal(r.view().portfolio[0].claim,cash);
  assert.throws(()=>r.redeem({investor:'review-a',strategyId:'cash-reserve',requestId:'redemption'}),/중복/);
});

test('new investors enter at their selected strategy unit price; deposit is not performance',()=>{
  const r=new SleeveReview();allocate(r,'btc-trend');r.cycle();const before=r.view().portfolio[0].claim;
  allocate(r,'btc-trend','review-b');
  assert.ok(BigInt(r.view('review-b').portfolio[0].units)<money(100000));
  assert.ok(BigInt(r.view().portfolio[0].claim)-BigInt(before)<=2n);
  const l=new SleeveLedger(r.state.ledger),s=l.sleeve('btc-trend');
  assert.equal(l.crystallize(s.id,Object.fromEntries(Object.entries(r.state.marks).map(([k,v])=>[k,BigInt(v)]))),'0');
});

test('cross-strategy spending, holdings theft and duplicate fills fail without changing review state',()=>{
  const r=new SleeveReview();allocate(r,'btc-trend','review-a','10');allocate(r,'cash-reserve','review-b','100000');
  const before=structuredClone(r.state);
  assert.throws(()=>r.mutate((s,l)=>l.recordFill({strategyId:'btc-trend',orderId:'x',asset:'BTC',side:'BUY',quantity:money(1),quote:money(100),fee:0})),/다른 전략/);
  assert.deepEqual(r.state,before);
  assert.throws(()=>r.mutate((s,l)=>l.recordFill({strategyId:'btc-trend',orderId:'bad-fee',asset:'BTC',side:'BUY',quantity:money(1),quote:money(1),fee:money(2)})),/체결 값 오류/);
  assert.deepEqual(r.state,before);
  assert.throws(()=>r.mutate((s,l)=>l.recordFill({strategyId:'btc-trend',orderId:'x',asset:'BTC',side:'SELL',quantity:money(1),quote:money(100),fee:0})),/다른 전략/);
  r.cycle();const f=r.state.ledger.orders[0];assert.throws(()=>r.mutate((s,l)=>l.recordFill(f)),/중복 체결/);
});

test('ledger rejects custody discrepancies and exactly assigns fractional claim remainders',()=>{
  const r=new SleeveReview();allocate(r,'cash-reserve','review-a','1');allocate(r,'cash-reserve','review-b','2');
  const l=new SleeveLedger(r.state.ledger),marks=Object.fromEntries(Object.entries(r.state.marks).map(([k,v])=>[k,BigInt(v)]));
  const c=structuredClone(r.state.custody);c.cash=String(BigInt(c.cash)+1n);assert.throws(()=>l.reconcile(c,marks),/현금 대사/);
  const s=l.sleeve('cash-reserve');s.cash=String(BigInt(s.cash)+1n);r.state.custody.cash=c.cash;
  const report=l.reconcile(r.state.custody,marks);assert.equal(Object.values(report.equities[2].investorClaims).reduce((v,x)=>v+BigInt(x),0n),BigInt(s.cash));
});

test('isolated review persists without modifying the old pilot data',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sleeve-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'state.json'),r=new SleeveReview(path);allocate(r,'btc-trend');r.cycle();
  const restored=new SleeveReview(path);assert.deepEqual(restored.view(),r.view());
  const publicText=JSON.stringify(restored.view());assert.ok(!publicText.includes('orderId'));assert.ok(!publicText.includes('lotId'));assert.ok(!publicText.includes('positions'));
});
