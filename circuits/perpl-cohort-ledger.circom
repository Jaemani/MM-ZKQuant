pragma circom 2.2.2;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
// Terminal, flat-only ledger transition for one two-investor subscription cohort.
// No shared slots, interim mark NAV, subscriptions during trading, or rolling HWM.
template CohortLedger() {
 signal input pub[13];
 // chain,vault,oldRoot,newRoot,venueNonce,deposit0,deposit1,recovered,bps,claim0,claim1,fees,totalShares
 signal input gross[2]; signal input profits[2]; signal input fees[2];
 signal input allocationRemainder; signal input feeRemainders[2];
 component ranges[9];
 for(var i=0;i<9;i++){ranges[i]=Num2Bits(64);ranges[i].in <== pub[i+4];}
 component positive[2];
 for(var i=0;i<2;i++){positive[i]=IsZero();positive[i].in <== pub[5+i];positive[i].out === 0;}
 pub[12] === pub[5]+pub[6];
 component feeCap=LessEqThan(64);feeCap.in[0]<==pub[8];feeCap.in[1]<==2000;feeCap.out===1;
 component old=Poseidon(6);
 old.inputs[0]<==2026100401;old.inputs[1]<==pub[0];old.inputs[2]<==pub[1];
 old.inputs[3]<==pub[5];old.inputs[4]<==pub[6];old.inputs[5]<==pub[12];old.out===pub[2];
 component gr[2]; component pr[2];component fr[2];component rr[2];component gains[2];component remCaps[2];
 for(var i=0;i<2;i++){
  gr[i]=Num2Bits(64);gr[i].in<==gross[i];pr[i]=Num2Bits(64);pr[i].in<==profits[i];
  fr[i]=Num2Bits(64);fr[i].in<==fees[i];rr[i]=Num2Bits(14);rr[i].in<==feeRemainders[i];
  gains[i]=LessThan(64);gains[i].in[0]<==pub[5+i];gains[i].in[1]<==gross[i];
  profits[i] === gains[i].out*(gross[i]-pub[5+i]);
  profits[i]*pub[8] === fees[i]*10000+feeRemainders[i];
  remCaps[i]=LessThan(14);remCaps[i].in[0]<==feeRemainders[i];remCaps[i].in[1]<==10000;remCaps[i].out===1;
  pub[9+i] === gross[i]-fees[i];
 }
 component ar=Num2Bits(64);ar.in<==allocationRemainder;
 component ac=LessThan(64);ac.in[0]<==allocationRemainder;ac.in[1]<==pub[12];ac.out===1;
 signal weightedAssets;weightedAssets <== pub[7]*pub[5];
 weightedAssets === gross[0]*pub[12]+allocationRemainder;
 gross[0]+gross[1] === pub[7];pub[11]===fees[0]+fees[1];
 pub[9]+pub[10]+pub[11] === pub[7];
 component next=Poseidon(6);
 next.inputs[0]<==pub[2];next.inputs[1]<==pub[4];next.inputs[2]<==pub[7];
 next.inputs[3]<==pub[9];next.inputs[4]<==pub[10];next.inputs[5]<==pub[11];next.out===pub[3];
}
component main {public [pub]} = CohortLedger();
