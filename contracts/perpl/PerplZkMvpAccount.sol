// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./PerplMvpAccount.sol";

interface ITargetVerifier {
    function verifyProof(uint256[2] calldata a,uint256[2][2] calldata b,uint256[2] calldata c,uint256[11] calldata inputs) external view returns(bool);
}
/// Separate MVP circuit: authorizes a target; does NOT prove NAV, shares or ledger transitions.
contract PerplZkMvpAccount is PerplMvpAccount {
    uint256 private constant P=21888242871839275222246405745257275088548364400416034343698204186575808495617;
    ITargetVerifier public immutable verifier;
    uint256 public immutable managerKeyX;
    uint256 public immutable managerKeyY;
    constructor(address exchange,address token,address manager_,address beneficiary_,uint256 market_,uint256 cap,address verifier_,uint256[2] memory key)
        PerplMvpAccount(exchange,token,manager_,beneficiary_,market_,cap) {
        require(verifier_.code.length>0 && key[0]<P && key[1]<P,"VERIFIER_CONFIG");
        verifier=ITargetVerifier(verifier_);managerKeyX=key[0];managerKeyY=key[1];
    }
    function _field(int256 x) private pure returns(uint256) {
        require(x>-(int256(1)<<63) && x<(int256(1)<<63),"QTY_RANGE");
        return x<0?P-uint256(-x):uint256(x);
    }
    function _authorize(int256 target,uint256 limitPrice,uint256 seq,uint256 deadline,bytes calldata encodedProof) internal view override {
        (uint256[2] memory a,uint256[2][2] memory b,uint256[2] memory c)=abi.decode(encodedProof,(uint256[2],uint256[2][2],uint256[2]));
        (int256 actual,,)=position();
        uint256[11] memory inputs=[block.chainid,uint256(uint160(address(this))),market,seq,_field(target),_field(actual),limitPrice,deadline,maxLots,managerKeyX,managerKeyY];
        require(verifier.verifyProof(a,b,c,inputs),"INVALID_PROOF");
    }
}
