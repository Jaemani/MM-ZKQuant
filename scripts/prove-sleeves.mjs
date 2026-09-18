import assert from 'node:assert/strict';
import { SleeveReview } from '../src/sleeves/review.js';
import { money } from '../src/sleeves/ledger.js';
import { atomicJson } from '../src/pilot/chain.js';
const review=new SleeveReview();
review.allocate({investor:'review-a',strategyId:'btc-trend',amount:'100000',requestId:'a-trend'});
review.allocate({investor:'review-b',strategyId:'btc-hedge',amount:'100000',requestId:'b-hedge'});
review.allocate({investor:'review-a',strategyId:'cash-reserve',amount:'30000',requestId:'a-cash'});
review.cycle({moveBps:1000});
const a=review.view('review-a'),b=review.view('review-b');
assert.ok(BigInt(a.portfolio.find(p=>p.strategyId==='btc-trend').claim)>money(100000));
assert.ok(BigInt(b.portfolio[0].claim)<money(100000));
assert.equal(a.portfolio.find(p=>p.strategyId==='cash-reserve').claim,String(money(30000)));
assert.equal(BigInt(a.vault.vaultEquity),BigInt(a.vault.strategyEquity)+BigInt(a.vault.protocolAccrual));
review.redeem({investor:'review-a',strategyId:'btc-trend',requestId:'a-withdraw'});
assert.equal(review.view('review-a').portfolio.length,1);
assert.equal(review.view('review-b').portfolio[0].claim,b.portfolio[0].claim);
const report={generatedAt:new Date().toISOString(),concept:'CONFIDENTIAL_ALPHA_V0.2',accountingReview:'PASS',
  productVerdict:'NOT_READY_OMNIBUS_INTEGRATION',teeExcluded:true,chainConnected:false,controlledPrices:true,realParticipants:false,
  beforeRedemption:{investorA:a.portfolio,investorB:b.portfolio,reconciliation:a.vault},
  afterRedemption:{investorA:review.view('review-a').portfolio,investorB:review.view('review-b').portfolio,reconciliation:review.view().vault},
  checks:['strategy-specific investor claims','independent long/short outcomes','same provider independent sleeves','attributed fees','one-sleeve redemption preserves other claims','shared custody reconciles with strategy equity'],
  remaining:'Signed strategy submissions, investor authorization, new Omnibus/DEX adapter and actual receipt reconciliation, crash recovery, insolvency handling, external end-to-end execution; see docs/sleeves-v0.2.md.'};
atomicJson('docs/evidence/sleeves-review.json',report);
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--strict'))process.exitCode=2;
