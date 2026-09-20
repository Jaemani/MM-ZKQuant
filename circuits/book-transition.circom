pragma circom 2.2.2;

include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";

// Experimental two-book spot transition. NOT the full protocol ledger.
// Book fields: cash, asset, reservation, accepted provider sequence, pubkey X/Y.
template BookTransition() {
    signal input phase; // 1 = authorize/reserve, 2 = settle authenticated fill
    signal input chainId;
    signal input vault;
    signal input config;
    signal input batch;
    signal input oldRoot;
    signal input newRoot;
    signal input buy;
    signal input amount;
    signal input minOut;
    signal input deadline;
    signal input amountOut;
    signal input cashTotal;
    signal input assetTotal;
    signal input maxSpendBps;

    signal input before[2][6];
    signal input after[2][6];
    signal input oldSalt;
    signal input newSalt;
    signal input selected;
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    signal auth;
    signal settle;
    auth <== 2 - phase;
    settle <== phase - 1;
    auth * (auth - 1) === 0;
    selected * (selected - 1) === 0;
    buy * (buy - 1) === 0;
    component quantities[7];
    signal bounded[7];
    bounded[0] <== amount;
    bounded[1] <== minOut;
    bounded[2] <== amountOut;
    bounded[3] <== cashTotal;
    bounded[4] <== assetTotal;
    bounded[5] <== batch;
    bounded[6] <== deadline;
    for (var j=0; j<7; j++) {
        quantities[j] = Num2Bits(96);
        quantities[j].in <== bounded[j];
    }
    component positiveAmount = IsZero();
    positiveAmount.in <== amount;
    positiveAmount.out === 0;
    component positiveMinimum = IsZero();
    positiveMinimum.in <== minOut;
    positiveMinimum.out === 0;
    component bpsRange = Num2Bits(14);
    bpsRange.in <== maxSpendBps;
    component bpsLimit = LessEqThan(14);
    bpsLimit.in[0] <== maxSpendBps;
    bpsLimit.in[1] <== 10000;
    bpsLimit.out === 1;
    auth * amountOut === 0;
    component minimum = LessEqThan(96);
    minimum.in[0] <== minOut;
    minimum.in[1] <== amountOut;
    settle * (1 - minimum.out) === 0;

    signal chosen[6];
    for (var j=0; j<6; j++) {
        chosen[j] <== before[0][j] + selected * (before[1][j] - before[0][j]);
    }
    // Provider signs a concrete order; target-to-order compilation is out of scope.
    // Sequence in the signed order is the post-authorization sequence.
    component order = Poseidon(12);
    order.inputs[0] <== 20260920;
    order.inputs[1] <== chainId;
    order.inputs[2] <== vault;
    order.inputs[3] <== config;
    order.inputs[4] <== batch;
    order.inputs[5] <== selected;
    order.inputs[6] <== chosen[3] + auth;
    order.inputs[7] <== buy;
    order.inputs[8] <== amount;
    order.inputs[9] <== minOut;
    order.inputs[10] <== deadline;
    order.inputs[11] <== maxSpendBps;
    component signature = EdDSAPoseidonVerifier();
    signature.enabled <== auth;
    signature.Ax <== chosen[4];
    signature.Ay <== chosen[5];
    signature.R8x <== sigR8x;
    signature.R8y <== sigR8y;
    signature.S <== sigS;
    signature.M <== order.out;

    signal available;
    available <== chosen[1] + buy * (chosen[0] - chosen[1]);
    component capacity = LessEqThan(96);
    capacity.in[0] <== amount;
    capacity.in[1] <== available;
    auth * (1 - capacity.out) === 0;
    // Buy limit is fraction of available cash, NOT a NAV/target risk mandate.
    signal cashCap;
    cashCap <== chosen[0] * maxSpendBps;
    component spendLimit = LessEqThan(110);
    spendLimit.in[0] <== amount * 10000;
    spendLimit.in[1] <== cashCap;
    signal buyingAuthorization;
    buyingAuthorization <== auth * buy;
    buyingAuthorization * (1 - spendLimit.out) === 0;

    signal cashDelta;
    signal assetDelta;
    cashDelta <== amountOut - buy * (amount + amountOut);
    assetDelta <== buy * (amount + amountOut) - amount;
    signal settledCashDelta;
    signal settledAssetDelta;
    settledCashDelta <== settle * cashDelta;
    settledAssetDelta <== settle * assetDelta;
    signal belongs[2];
    belongs[0] <== 1 - selected;
    belongs[1] <== selected;
    component rangesBefore[2][4];
    component rangesAfter[2][4];
    component leavesBefore[2];
    component leavesAfter[2];
    signal reservedAmount;
    reservedAmount <== settle * amount;
    signal nextReservedAmount;
    nextReservedAmount <== auth * amount;
    for (var i=0; i<2; i++) {
        for (var j=0; j<4; j++) {
            rangesBefore[i][j] = Num2Bits(96);
            rangesAfter[i][j] = Num2Bits(96);
            rangesBefore[i][j].in <== before[i][j];
            rangesAfter[i][j].in <== after[i][j];
        }
        before[i][2] === belongs[i] * reservedAmount;
        after[i][2] === belongs[i] * nextReservedAmount;
        after[i][0] === before[i][0] + belongs[i] * settledCashDelta;
        after[i][1] === before[i][1] + belongs[i] * settledAssetDelta;
        after[i][3] === before[i][3] + belongs[i] * auth;
        after[i][4] === before[i][4];
        after[i][5] === before[i][5];
        leavesBefore[i] = Poseidon(7);
        leavesAfter[i] = Poseidon(7);
        leavesBefore[i].inputs[0] <== i + 1;
        leavesAfter[i].inputs[0] <== i + 1;
        for (var j=0; j<6; j++) {
            leavesBefore[i].inputs[j+1] <== before[i][j];
            leavesAfter[i].inputs[j+1] <== after[i][j];
        }
    }
    component previous = Poseidon(4);
    component next = Poseidon(4);
    for (var i=0; i<2; i++) {
        previous.inputs[i] <== leavesBefore[i].out;
        next.inputs[i] <== leavesAfter[i].out;
    }
    previous.inputs[2] <== oldSalt;
    next.inputs[2] <== newSalt;
    previous.inputs[3] <== settle * order.out;
    next.inputs[3] <== auth * order.out;
    previous.out === oldRoot;
    next.out === newRoot;
    after[0][0] + after[1][0] === cashTotal;
    after[0][1] + after[1][1] === assetTotal;
}

component main {public [phase, chainId, vault, config, batch, oldRoot, newRoot, buy, amount, minOut, deadline, amountOut, cashTotal, assetTotal, maxSpendBps]} = BookTransition();
