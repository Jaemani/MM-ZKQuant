import test from 'node:test';
import assert from 'node:assert/strict';
import { delta, isReduction, custodyDraw, minimumReduction, withinLeverage, notional, reconcileSlot, submissionRoute } from '../../protocol/ts/model.mts';

test('IOC targets use actual position; open orders and delta overflow reject',()=>{
  assert.equal(delta(-20n,100n),-120n);
  assert.throws(()=>delta(0n,100n,1n));
  assert.throws(()=>delta((1n<<63n)-1n,-1n));
  assert.equal(isReduction(100n,-100n),true);
  assert.equal(isReduction(100n,-101n),false);
  assert.equal(isReduction(-100n,80n),true);
});
test('custody spends slot credit first; margin release is not custody cash',()=>{
  assert.equal(custodyDraw(100n,30n,70n),70n);
  assert.equal(custodyDraw(-100n,30n,0n),0n);
  assert.throws(()=>custodyDraw(100n,30n,69n));
  assert.throws(()=>custodyDraw(1n,-1n,20n));
});
test('risk uses market units and conservative rational arithmetic',()=>{
  const p={qty:3n,price:101n,quoteNumerator:1n,quoteDenominator:100n};
  assert.equal(notional(p),4n);
  assert.equal(withinLeverage([p],4n,0n,10000n),true);
  assert.equal(withinLeverage([p],4n,1n,10000n),false);
  assert.equal(withinLeverage([p],1n,0n,50000n),true);
  assert.equal(withinLeverage([p],-1n,0n,50000n),false);
  assert.throws(()=>notional({...p,quoteDenominator:0n}));
  assert.throws(()=>withinLeverage([p],4n,10001n,50000n));
  assert.equal(minimumReduction(3n,3333n),1n);
  assert.equal(minimumReduction(-3n,3334n),2n);
});
test('S1: partial IOC creates a concrete risk false-accept under draft T14',()=>{
  const position=100n, target=0n, actualFill=-10n;
  const projected=position+delta(target,position), actual=position+actualFill;
  const marked=qty=>({qty,price:1n,quoteNumerator:1n,quoteDenominator:1n});
  assert.equal(projected,0n); assert.equal(actual,90n);
  // A subsequent market opens 20 units against equity 100 at 1x leverage.
  assert.equal(withinLeverage([marked(projected),marked(20n)],100n,0n,10000n),true);
  assert.equal(withinLeverage([marked(actual),marked(20n)],100n,0n,10000n),false);
  const s={projectedQty:projected,observedQty:actual,evidenceIndex:11n,requiredIndex:11n,beforeQty:position,fallbackRequired:100n};
  assert.deepEqual(reconcileSlot(s),{qty:90n,fallbackDone:false});
  assert.throws(()=>reconcileSlot({...s,observedQty:null}));
  assert.throws(()=>reconcileSlot({...s,evidenceIndex:10n}));
  assert.deepEqual(reconcileSlot({...s,observedQty:0n}),{qty:0n,fallbackDone:true});
});
test('S5: account aggregate equality does not establish slot ownership',()=>{
  const previous=[20n,30n], nextFree=80n;
  const assignToA=[previous[0]+30n,previous[1]], assignToB=[previous[0],previous[1]+30n];
  assert.equal(assignToA.reduce((s,x)=>s+x),nextFree);
  assert.equal(assignToB.reduce((s,x)=>s+x),nextFree);
  assert.notDeepEqual(assignToA,assignToB);
});
test('private-only never silently falls back, including timeout',()=>{
  assert.equal(submissionRoute('PRIVATE_ONLY',false,99999n,2000n,10n,100n),'WAIT_PRIVATE');
  assert.equal(submissionRoute('ALLOW_PUBLIC',false,1999n,2000n,10n,100n),'WAIT_PRIVATE');
  assert.equal(submissionRoute('ALLOW_PUBLIC',false,2000n,2000n,10n,100n),'SUBMISSION_PUBLIC_FALLBACK');
  assert.equal(submissionRoute('PRIVATE_ONLY',true,0n,2000n,100n,100n),'EXPIRED');
  assert.equal(submissionRoute('PRIVATE_ONLY',true,0n,2000n,10n,100n),'PRIVATE');
});
test('exhaustive small signed positions: reduction never flips or increases absolute exposure',()=>{
  for(let p=-30n;p<=30n;p++) for(let q=-60n;q<=60n;q++) {
    const next=p+q, expected=(next<0n?-next:next)<=(p<0n?-p:p) && next*p>=0n;
    assert.equal(isReduction(p,q),expected);
  }
});
