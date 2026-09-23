pragma circom 2.2.2;
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";

// Narrow MVP v1, NOT development-v0.1 TradeCircuit or a ledger proof.
// public: chain, account, market, nonce, target, actual position, price,
// deadline, cap, keyX, keyY. Signed qty uses BN254 field encoding.
template PerplTargetMvp() {
    signal input pub[11];
    signal input sigR8x; signal input sigR8y; signal input sigS;
    component chain=Num2Bits(64); chain.in <== pub[0];
    component account=Num2Bits(160); account.in <== pub[1];
    component market=Num2Bits(64); market.in <== pub[2];
    component seq=Num2Bits(64); seq.in <== pub[3];
    component price=Num2Bits(96); price.in <== pub[6];
    component deadline=Num2Bits(64); deadline.in <== pub[7];
    component cap=Num2Bits(63); cap.in <== pub[8];
    component nonzeroPrice=IsZero(); nonzeroPrice.in <== pub[6]; nonzeroPrice.out === 0;
    component nonzeroCap=IsZero(); nonzeroCap.in <== pub[8]; nonzeroCap.out === 0;
    component signedRange[2]; component excludeMin[2];
    for(var i=0;i<2;i++) {
        signedRange[i]=Num2Bits(64); signedRange[i].in <== pub[4+i]+2**63;
        excludeMin[i]=IsZero(); excludeMin[i].in <== pub[4+i]+2**63; excludeMin[i].out === 0;
    }
    component lower=LessEqThan(64); lower.in[0] <== 2**63-pub[8]; lower.in[1] <== pub[4]+2**63; lower.out === 1;
    component upper=LessEqThan(64); upper.in[0] <== pub[4]+2**63; upper.in[1] <== 2**63+pub[8]; upper.out === 1;
    component msg=Poseidon(12); msg.inputs[0] <== 2026092301;
    for(var j=0;j<11;j++) msg.inputs[j+1] <== pub[j];
    component sig=EdDSAPoseidonVerifier(); sig.enabled <== 1;
    sig.Ax <== pub[9]; sig.Ay <== pub[10]; sig.R8x <== sigR8x; sig.R8y <== sigR8y; sig.S <== sigS; sig.M <== msg.out;
}
component main {public [pub]} = PerplTargetMvp();
