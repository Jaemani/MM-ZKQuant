// A single subscription cohort: shares minted at NAV=1, terminal redemption only.
// Each investor's subscription principal is its HWM for this one period.
export function settleCohort(deposits, recovered, feeBps) {
  const d=deposits.map(BigInt),assets=BigInt(recovered),bps=BigInt(feeBps),limit=1n<<64n;
  if(d.length!==2||d.some(x=>x<=0n||x>=limit)||assets<0n||assets>=limit||bps<0n||bps>2000n)throw Error('COHORT_RANGE');
  const total=d[0]+d[1];if(total>=limit)throw Error('COHORT_RANGE');
  const gross=[assets*d[0]/total,0n];gross[1]=assets-gross[0];
  const profits=gross.map((g,i)=>g>d[i]?g-d[i]:0n);
  const fees=profits.map(p=>p*bps/10000n),claims=gross.map((g,i)=>g-fees[i]);
  return {deposits:d,recovered:assets,feeBps:bps,totalShares:total,gross,profits,fees,claims,
    totalFee:fees[0]+fees[1],allocationRemainder:assets*d[0]-gross[0]*total,
    feeRemainders:profits.map((p,i)=>p*bps-fees[i]*10000n)};
}
