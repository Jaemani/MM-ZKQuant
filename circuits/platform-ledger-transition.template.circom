pragma circom 2.2.2;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Exact nonnegative integer division. Products remain below 2^194, far below Fr.
template FloorDiv() {
 signal input numerator; signal input denominator; signal output quotient;
 signal remainder;
 quotient <-- numerator \ denominator;
 remainder <-- numerator % denominator;
 numerator === quotient*denominator+remainder;
 component q=Num2Bits(96);q.in<==quotient;
 component r=Num2Bits(96);r.in<==remainder;
 component cap=LessThan(97);cap.in[0]<==remainder;cap.in[1]<==denominator;cap.out===1;
 component nz=IsZero();nz.in<==denominator;nz.out===0;
}
template Path(depth) {
 signal input leaf;signal input index;signal input siblings[depth];signal output root;
 component bits=Num2Bits(depth);bits.in<==index;
 component h[depth];signal nodes[depth+1];signal left[depth];signal right[depth];
 nodes[0]<==leaf;
 for(var i=0;i<depth;i++){
  left[i]<==nodes[i]+bits.out[i]*(siblings[i]-nodes[i]);
  right[i]<==siblings[i]+bits.out[i]*(nodes[i]-siblings[i]);
  h[i]=Poseidon(2);h[i].inputs[0]<==left[i];h[i].inputs[1]<==right[i];nodes[i+1]<==h[i].out;
 }root<==nodes[depth];
}
template AccountsRoot(count) {
 signal input rows[count][9];signal output root;
 component leaf[count];component pair[count-1];signal nodes[2*count];
 for(var i=0;i<count;i++){leaf[i]=Poseidon(10);leaf[i].inputs[0]<==i;for(var j=0;j<9;j++){leaf[i].inputs[j+1]<==rows[i][j];}nodes[count+i]<==leaf[i].out;}
 for(var i=count-1;i>0;i--){pair[i-1]=Poseidon(2);pair[i-1].inputs[0]<==nodes[2*i];pair[i-1].inputs[1]<==nodes[2*i+1];nodes[i]<==pair[i-1].out;}
 root<==nodes[1];
}
// One hidden strategy book, 16 investor slots, one journal event per proof.
// Operations: deposit, mint, HWM fee, proportional/remainder burn, redemption,
// pending redemption, venue cash, authenticated valuation, fee payout, policy,
// valuation adjustment, book registration. Zero pads a short batch.
template PlatformLedger() {
 signal input pub[7]; // chain,vault,sequence,checkpointAt,oldRoot,newRoot,eventsRoot
 signal input beforeBook[7]; // private id, feeBps, cash, equity, units, NAV, feesDue
 signal input beforeRows[16][9]; // wallet,pending,units,deposited,paid,fees,lotRoot,redemptionCredit,goal
 signal input events[1][9]; // kind,row,wallet,amount,units,value,sign,rate,aux
 signal input lotBefore[1][2];signal input lotIndex[1];signal input lotSiblings[1][6];
 signal input bookIndex;signal input bookSiblings[12];
 signal input oldSalt;signal input newSalt;signal input eventSalt;
 signal book[2][7];signal rows[2][16][9];
 signal requireWallet[1];signal venueDelta[1];signal markNav[1];
 component initialBookRange[7];component initialRowRange[16][8];component initialCap=LessEqThan(14);
 for(var j=0;j<7;j++){book[0][j]<==beforeBook[j];initialBookRange[j]=Num2Bits(j==0?160:(j==1?14:96));initialBookRange[j].in<==beforeBook[j];}
 initialCap.in[0]<==beforeBook[1];initialCap.in[1]<==2000;initialCap.out===1;
 for(var i=0;i<16;i++){for(var j=0;j<9;j++){
  rows[0][i][j]<==beforeRows[i][j];
  if(j!=6){var k=j>6?j-1:j;initialRowRange[i][k]=Num2Bits(j==0?160:96);initialRowRange[i][k].in<==beforeRows[i][j];}
 }}
 component pubRanges[4];for(var i=0;i<4;i++){pubRanges[i]=Num2Bits(i==1?160:64);pubRanges[i].in<==pub[i];}
 component saltRanges[3];signal salts[3];salts[0]<==oldSalt;salts[1]<==newSalt;salts[2]<==eventSalt;
 for(var i=0;i<3;i++){saltRanges[i]=Num2Bits(128);saltRanges[i].in<==salts[i];}
 component opcode[1][13];component selector[1][16];signal selected[1][9];signal terms[1][16][9];
 signal isAccount[1];signal isLot[1];signal feeGain[1];signal negativeCost[1];signal positiveCost[1];signal profit[1];
 signal fresh[1][9];signal freshBook[1][7];signal newLot[1][2];
 component eventRange[1][9];component walletZero[1];component rowZero[1];component unitsZero[1];component goalZero[1];
 component gainCap[1];component profitCap[1];component lotCmp[1];component cashCap[1];component goalCap[1];
 component mintDiv[1];component gainDiv[1];component rateDiv[1];component burnDiv[1];component actualDiv[1];component proportionDiv[1];component markDiv[1];component payDiv[1];
 signal proportional[1];signal remainderBurn[1];signal remaining[1];signal feeDenom[1];signal markDenom[1];signal payDenom[1];signal payNumerator[1];
 component oldLotHash[1];component newLotHash[1];component oldLotPath[1];component newLotPath[1];
 component oldLotRange[1][2];component newLotRange[1][2];component bookZero[1];
 component freshRowRange[1][8];component freshBookRange[1][7];component rateCap[1];
 component eventHash[1];component eventChain[1];signal eventNodes[2];eventNodes[0]<==eventSalt;
 for(var t=0;t<1;t++){
  var valid=0;for(var op=0;op<13;op++){opcode[t][op]=IsEqual();opcode[t][op].in[0]<==events[t][0];opcode[t][op].in[1]<==op;valid+=opcode[t][op].out;}valid===1;
  for(var j=0;j<9;j++){eventRange[t][j]=Num2Bits(j==0?4:(j==1?4:(j==2?160:(j==6?1:(j==7?14:96)))));eventRange[t][j].in<==events[t][j];}
  for(var i=0;i<16;i++){selector[t][i]=IsEqual();selector[t][i].in[0]<==events[t][1];selector[t][i].in[1]<==i;for(var j=0;j<9;j++){terms[t][i][j]<==selector[t][i].out*rows[t][i][j];}}
  for(var j=0;j<9;j++){var sum=0;for(var i=0;i<16;i++){sum+=terms[t][i][j];}selected[t][j]<==sum;}
  isAccount[t]<==opcode[t][1].out+opcode[t][2].out+opcode[t][3].out+opcode[t][4].out+opcode[t][5].out+opcode[t][6].out;
  isLot[t]<==opcode[t][2].out+opcode[t][3].out+opcode[t][4].out;
  bookZero[t]=IsZero();bookZero[t].in<==book[t][0];
  (1-opcode[t][0].out-opcode[t][12].out)*bookZero[t].out===0;
  rowZero[t]=IsZero();rowZero[t].in<==selected[t][0];walletZero[t]=IsZero();walletZero[t].in<==events[t][2];
  opcode[t][1].out*walletZero[t].out===0;
  requireWallet[t]<==isAccount[t]-opcode[t][1].out*rowZero[t].out;
  requireWallet[t]*(selected[t][0]-events[t][2])===0;
  goalZero[t]=IsZero();goalZero[t].in<==selected[t][8];
  (opcode[t][2].out+opcode[t][3].out+opcode[t][6].out)*selected[t][7]===0;
  opcode[t][4].out*(1-goalZero[t].out)*(selected[t][8]-events[t][8])===0;
  opcode[t][5].out*(selected[t][7]-events[t][8])===0;
  opcode[t][5].out*(selected[t][8]-events[t][8])===0;
  unitsZero[t]=IsZero();unitsZero[t].in<==book[t][4];
  mintDiv[t]=FloorDiv();mintDiv[t].numerator<==opcode[t][2].out*events[t][3]*1000000000000000000;
  mintDiv[t].denominator<==1+opcode[t][2].out*(book[t][5]-1);
  opcode[t][2].out*(events[t][4]-mintDiv[t].quotient)===0;
  opcode[t][2].out*lotBefore[t][0]===0;
  gainCap[t]=LessThan(96);gainCap[t].in[0]<==lotBefore[t][1];gainCap[t].in[1]<==book[t][5];opcode[t][3].out*(1-gainCap[t].out)===0;
  feeGain[t]<==opcode[t][3].out*(book[t][5]-lotBefore[t][1]);
  gainDiv[t]=FloorDiv();gainDiv[t].numerator<==lotBefore[t][0]*feeGain[t];gainDiv[t].denominator<==1000000000000000000;
  negativeCost[t]<==events[t][5]*events[t][6];positiveCost[t]<==events[t][5]-negativeCost[t];
  profitCap[t]=LessThan(97);profitCap[t].in[0]<==positiveCost[t];profitCap[t].in[1]<==gainDiv[t].quotient+negativeCost[t];
  profit[t]<==profitCap[t].out*(gainDiv[t].quotient+negativeCost[t]-positiveCost[t]);
  rateDiv[t]=FloorDiv();rateDiv[t].numerator<==profit[t]*book[t][1];rateDiv[t].denominator<==10000;
  feeDenom[t]<==1+opcode[t][3].out*(book[t][5]-1);
  burnDiv[t]=FloorDiv();burnDiv[t].numerator<==opcode[t][3].out*rateDiv[t].quotient*1000000000000000000;burnDiv[t].denominator<==feeDenom[t];
  actualDiv[t]=FloorDiv();actualDiv[t].numerator<==burnDiv[t].quotient*book[t][5];actualDiv[t].denominator<==1000000000000000000;
  opcode[t][3].out*(events[t][4]-burnDiv[t].quotient)===0;opcode[t][3].out*(events[t][3]-actualDiv[t].quotient)===0;
  proportionDiv[t]=FloorDiv();proportionDiv[t].numerator<==opcode[t][4].out*lotBefore[t][0]*events[t][8];
  proportionDiv[t].denominator<==1+opcode[t][4].out*(selected[t][2]+selected[t][7]-1);
  goalCap[t]=LessEqThan(96);goalCap[t].in[0]<==selected[t][7];goalCap[t].in[1]<==events[t][8];opcode[t][4].out*(1-goalCap[t].out)===0;
  remaining[t]<==opcode[t][4].out*(events[t][8]-selected[t][7]);
  lotCmp[t]=LessThan(96);lotCmp[t].in[0]<==lotBefore[t][0];lotCmp[t].in[1]<==remaining[t];
  remainderBurn[t]<==remaining[t]+lotCmp[t].out*(lotBefore[t][0]-remaining[t]);
  proportional[t]<==proportionDiv[t].quotient+events[t][6]*(remainderBurn[t]-proportionDiv[t].quotient);
  opcode[t][4].out*(events[t][4]-proportional[t])===0;
  markDenom[t]<==1+opcode[t][8].out*(1-unitsZero[t].out)*(book[t][4]-1);
  markDiv[t]=FloorDiv();markDiv[t].numerator<==opcode[t][8].out*(1-unitsZero[t].out)*events[t][3]*1000000000000000000;markDiv[t].denominator<==markDenom[t];
  payDenom[t]<==1+opcode[t][5].out*(book[t][4]+unitsZero[t].out*(events[t][8]-book[t][4])-1);
  payNumerator[t]<==book[t][3]-events[t][3]+unitsZero[t].out*(2*events[t][3]-book[t][3]);
  payDiv[t]=FloorDiv();payDiv[t].numerator<==opcode[t][5].out*payNumerator[t]*1000000000000000000;payDiv[t].denominator<==payDenom[t];
  newLot[t][0]<==lotBefore[t][0]+opcode[t][2].out*events[t][4]-(opcode[t][3].out+opcode[t][4].out)*events[t][4];
  newLot[t][1]<==lotBefore[t][1]+(opcode[t][2].out+opcode[t][3].out)*(book[t][5]-lotBefore[t][1]);
  oldLotHash[t]=Poseidon(3);newLotHash[t]=Poseidon(3);oldLotHash[t].inputs[0]<==lotIndex[t];newLotHash[t].inputs[0]<==lotIndex[t];
  for(var j=0;j<2;j++){oldLotHash[t].inputs[j+1]<==lotBefore[t][j];newLotHash[t].inputs[j+1]<==newLot[t][j];oldLotRange[t][j]=Num2Bits(96);oldLotRange[t][j].in<==lotBefore[t][j];newLotRange[t][j]=Num2Bits(96);newLotRange[t][j].in<==newLot[t][j];}
  oldLotPath[t]=Path(6);newLotPath[t]=Path(6);oldLotPath[t].leaf<==oldLotHash[t].out;newLotPath[t].leaf<==newLotHash[t].out;oldLotPath[t].index<==lotIndex[t];newLotPath[t].index<==lotIndex[t];
  for(var j=0;j<6;j++){oldLotPath[t].siblings[j]<==lotSiblings[t][j];newLotPath[t].siblings[j]<==lotSiblings[t][j];}
  isLot[t]*(oldLotPath[t].root-selected[t][6])===0;
  fresh[t][0]<==selected[t][0]+opcode[t][1].out*rowZero[t].out*(events[t][2]-selected[t][0]);
  fresh[t][1]<==selected[t][1]+opcode[t][1].out*events[t][3]-(opcode[t][2].out+opcode[t][6].out)*events[t][3];
  fresh[t][2]<==selected[t][2]+opcode[t][2].out*events[t][4]-(opcode[t][3].out+opcode[t][4].out)*events[t][4];
  fresh[t][3]<==selected[t][3]+opcode[t][1].out*events[t][3];
  fresh[t][4]<==selected[t][4]+(opcode[t][5].out+opcode[t][6].out)*events[t][3];
  fresh[t][5]<==selected[t][5]+opcode[t][3].out*events[t][3];
  fresh[t][6]<==selected[t][6]+isLot[t]*(newLotPath[t].root-selected[t][6]);
  fresh[t][7]<==selected[t][7]+opcode[t][4].out*events[t][4]-opcode[t][5].out*selected[t][7];
  fresh[t][8]<==selected[t][8]+opcode[t][4].out*goalZero[t].out*(events[t][8]-selected[t][8])-opcode[t][5].out*selected[t][8];
  freshBook[t][0]<==book[t][0]+opcode[t][12].out*(events[t][2]-book[t][0]);
  opcode[t][12].out*book[t][0]===0;opcode[t][12].out*walletZero[t].out===0;
  freshBook[t][1]<==book[t][1]+(opcode[t][10].out+opcode[t][12].out)*(events[t][7]-book[t][1]);
  venueDelta[t]<==(1-2*events[t][6])*events[t][3];
  freshBook[t][2]<==book[t][2]+opcode[t][2].out*events[t][3]-(opcode[t][5].out+opcode[t][9].out)*events[t][3]+opcode[t][7].out*venueDelta[t];
  freshBook[t][3]<==book[t][3]+opcode[t][2].out*events[t][3]-(opcode[t][3].out+opcode[t][5].out)*events[t][3]+opcode[t][8].out*(events[t][5]-book[t][3])+opcode[t][11].out*(events[t][3]-book[t][3]);
  freshBook[t][4]<==book[t][4]+opcode[t][2].out*events[t][4]-(opcode[t][3].out+opcode[t][4].out)*events[t][4];
  markNav[t]<==book[t][5]+(1-unitsZero[t].out)*(markDiv[t].quotient-book[t][5]);
  freshBook[t][5]<==book[t][5]+opcode[t][8].out*(markNav[t]-book[t][5])+opcode[t][5].out*(payDiv[t].quotient-book[t][5]);
  freshBook[t][6]<==book[t][6]+opcode[t][3].out*events[t][3]-opcode[t][9].out*events[t][3];
  cashCap[t]=LessEqThan(96);cashCap[t].in[0]<==book[t][6];cashCap[t].in[1]<==freshBook[t][2];opcode[t][5].out*(1-cashCap[t].out)===0;
  for(var j=0;j<9;j++){if(j!=6){var k=j>6?j-1:j;freshRowRange[t][k]=Num2Bits(j==0?160:96);freshRowRange[t][k].in<==fresh[t][j];}}
  for(var j=0;j<7;j++){freshBookRange[t][j]=Num2Bits(j==0?160:(j==1?14:96));freshBookRange[t][j].in<==freshBook[t][j];book[t+1][j]<==freshBook[t][j];}
  rateCap[t]=LessEqThan(14);rateCap[t].in[0]<==freshBook[t][1];rateCap[t].in[1]<==2000;rateCap[t].out===1;
  for(var i=0;i<16;i++){for(var j=0;j<9;j++){rows[t+1][i][j]<==rows[t][i][j]+selector[t][i].out*(fresh[t][j]-rows[t][i][j]);}}
  eventHash[t]=Poseidon(11);for(var j=0;j<9;j++){eventHash[t].inputs[j]<==events[t][j];}eventHash[t].inputs[9]<==lotIndex[t];eventHash[t].inputs[10]<==oldLotHash[t].out;
  eventChain[t]=Poseidon(2);eventChain[t].inputs[0]<==eventNodes[t];eventChain[t].inputs[1]<==eventHash[t].out;eventNodes[t+1]<==eventChain[t].out;
 }
 component accounts[2];component leaf[2];component path[2];component commitment[2];
 for(var s=0;s<2;s++){
  accounts[s]=AccountsRoot(16);for(var i=0;i<16;i++){for(var j=0;j<9;j++){accounts[s].rows[i][j]<==rows[s][i][j];}}
  var units=0;for(var i=0;i<16;i++){units+=rows[s][i][2];}book[s][4]===units;
  leaf[s]=Poseidon(8);for(var j=0;j<7;j++){leaf[s].inputs[j]<==book[s][j];}leaf[s].inputs[7]<==accounts[s].root;
  path[s]=Path(12);path[s].leaf<==leaf[s].out;path[s].index<==bookIndex;for(var j=0;j<12;j++){path[s].siblings[j]<==bookSiblings[j];}
  commitment[s]=Poseidon(4);commitment[s].inputs[0]<==pub[0];commitment[s].inputs[1]<==pub[1];commitment[s].inputs[2]<==path[s].root;commitment[s].inputs[3]<==s==0?oldSalt:newSalt;
  commitment[s].out===pub[4+s];
 }
 eventNodes[1]===pub[6];
}
component main {public [pub]} = PlatformLedger();
