// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IProbeVerifier {
    function verifyProof(uint256[2] calldata a,uint256[2][2] calldata b,uint256[2] calldata c,uint256[11] calldata inputs) external view returns(bool);
}
/// Synthetic proof acceptance only. No custody, venue calls or authenticated position data.
contract PublicZkProbe {
    IProbeVerifier public immutable verifier;
    address public immutable operator;
    uint256 public immutable keyX;
    uint256 public immutable keyY;
    uint256 public accepted;
    event Accepted(uint256 indexed nonce, bytes32 publicInputsHash);
    constructor(address verifier_, uint256[2] memory key) {
        require(block.chainid == 10143, "TESTNET_ONLY");
        require(verifier_.code.length > 0, "VERIFIER");
        verifier=IProbeVerifier(verifier_); operator=msg.sender; keyX=key[0]; keyY=key[1];
    }
    function submit(bytes calldata encodedProof,uint256[11] calldata inputs) external {
        require(msg.sender == operator, "OPERATOR");
        require(inputs[0] == block.chainid && inputs[1] == uint256(uint160(address(this))) && inputs[2] == 16, "DOMAIN");
        require(inputs[3] == accepted && block.timestamp < inputs[7], "STALE");
        require(inputs[5] == 0 && inputs[8] == 100 && inputs[9] == keyX && inputs[10] == keyY, "SYNTHETIC_CONTEXT");
        (uint256[2] memory a,uint256[2][2] memory b,uint256[2] memory c)=abi.decode(encodedProof,(uint256[2],uint256[2][2],uint256[2]));
        require(verifier.verifyProof(a,b,c,inputs), "INVALID_PROOF");
        emit Accepted(accepted,keccak256(abi.encode(inputs)));
        accepted++;
    }
}
