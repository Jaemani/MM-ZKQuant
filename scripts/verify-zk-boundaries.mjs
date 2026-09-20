import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { wtns, curves } from 'snarkjs';
import { createBookProver, json } from '../src/zk/book.js';

// Additional local circuit admission checks. No cloud calls, chain transactions,
// production keys or private user state. Does not replace full-path testing.
try {
const dir='artifacts/zk';
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const build=JSON.parse(readFileSync(`${dir}/build.json`));
for(const [field,path] of [['circuitSha256','circuits/book-transition.circom'],['wasmSha256',`${dir}/book-transition_js/book-transition.wasm`],['r1csSha256',`${dir}/book-transition.r1cs`]])assert.equal(build[field],sha(path),'Stale artifact '+field);
const prover=await createBookProver();
const keys=['public-boundary-fixture-A','public-boundary-fixture-B'].map(x=>createHash('sha256').update(x).digest());
const context={chainId:31337,vault:12345,config:42,maxSpendBps:2500};
const checks=[];
const calculate=async input=>{
  const witness={type:'mem'};
  await wtns.calculate(JSON.parse(json(input)),`${dir}/book-transition_js/book-transition.wasm`,witness);
  return witness;
};
const accept=async(name,input)=>{
  assert.equal(await wtns.check(`${dir}/book-transition.r1cs`,await calculate(input)),true,name);
  checks.push({name,expected:'ACCEPT',passed:true});
};
const reject=async(name,input)=>{
  await assert.rejects(()=>calculate(input),/Assert Failed|Error in template/);
  checks.push({name,expected:'REJECT',passed:true});
};
const changed=(transition,mutate)=>{
  const input=structuredClone(transition.input);mutate(input);
  // Recommit the malicious post-state: rejection must not be explained only
  // by forgetting to update its public root.
  input.newRoot=prover.root({books:input.after,salt:input.newSalt,pending:transition.next.pending});
  return input;
};
for(const selected of [0,1]){
  let state=prover.initial([10000n,10000n],keys);
  for(const buy of [1,0]){
    const order={batch:buy?1:2,selected,buy,amount:buy?2500:100,minOut:buy?100:1,deadline:1800000000};
    const signature=prover.sign(context,order,state.books[selected][3]+1n,keys[selected]);
    const auth=prover.transition(state,context,order,signature);
    await accept(`book-${selected}-${buy?'buy':'sell'}-authorization`,auth.input);
    const settled=prover.transition(auth.next,context,order,signature,buy?100:1);
    await accept(`book-${selected}-${buy?'buy':'sell'}-settlement-at-minimum`,settled.input);
    if(selected===0&&buy===1){
      for(const [name,mutate] of [
        ['invalid-phase',x=>{x.phase=3n;}],
        ['nonboolean-book-selector',x=>{x.selected=2n;}],
        ['nonboolean-direction',x=>{x.buy=2n;}],
        ['provider-key-replacement',x=>{x.after[0][4]=x.after[1][4];x.after[0][5]=x.after[1][5];}],
        ['other-book-sequence-change',x=>{x.after[1][3]++;}],
        ['other-book-asset-creation',x=>{x.after[1][1]++;x.assetTotal++;}],
        ['authorization-with-realized-fill',x=>{x.amountOut=1n;}],
        ['wrong-cash-total',x=>{x.cashTotal++;}],
        ['wrong-asset-total',x=>{x.assetTotal++;}],
        ['policy-over-100-percent',x=>{x.maxSpendBps=10001n;}],
      ])await reject(name,changed(auth,mutate));
      for(const [name,orderChange] of [
        ['signed-zero-amount',{amount:0}],
        ['signed-zero-minimum',{minOut:0}],
        ['signed-one-unit-over-cash-cap',{amount:2501}],
        ['signed-96-bit-amount-overflow',{amount:1n<<96n}],
        ['signed-96-bit-deadline-overflow',{deadline:1n<<96n}],
      ]){
        const altered={...order,...orderChange};
        await reject(name,prover.transition(state,context,altered,prover.sign(context,altered,1n,keys[0])).input);
      }
      await reject('fill-one-unit-below-minimum',prover.transition(auth.next,context,order,signature,99).input);
      await reject('settlement-retains-reservation',changed(settled,x=>{x.after[0][2]=2500n;}));
      await reject('settlement-increments-provider-sequence',changed(settled,x=>{x.after[0][3]++;}));
      const alternate={...order,selected:1};
      await reject('settlement-changes-precommitted-book',prover.transition(auth.next,context,alternate,signature,100).input);
      await reject('settlement-changes-precommitted-amount',prover.transition(auth.next,context,{...order,amount:2499},signature,100).input);
      const noPending=structuredClone(auth.next);noPending.pending=0n;
      await reject('settlement-without-pending-commitment',prover.transition(noPending,context,order,signature,100).input);
      const maxState=prover.initial([10000n,10000n],keys);maxState.books[0][3]=(1n<<96n)-1n;
      await reject('provider-sequence-overflow',prover.transition(maxState,context,order,prover.sign(context,order,1n<<96n,keys[0])).input);
    }
    state=settled.next;
  }
}
const evidence={createdAt:new Date().toISOString(),status:'PASS_LOCAL_CIRCUIT_BOUNDARIES',hardwareTEE:false,externalNetworkBroadcast:false,circuitSha256:build.circuitSha256,r1csSha256:build.r1csSha256,wasmSha256:build.wasmSha256,checks,limitations:['Synthetic circuit tests only; no hardware or DEX path re-executed','Accepted witnesses checked against R1CS; no additional Groth16 proofs generated','Single synchronous order, trusted initial allocation; full protocol acceptance remains pending']};
writeFileSync('docs/evidence/zk-boundaries.json',json(evidence)+'\n');
console.log(json({status:evidence.status,checks:checks.length,accepted:checks.filter(c=>c.expected==='ACCEPT').length,rejected:checks.filter(c=>c.expected==='REJECT').length}));

} finally { await(await curves.getCurveFromName('bn128')).terminate(); }
