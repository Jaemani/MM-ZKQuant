// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IPlatformLedgerVerifier {
 function verifyProof(uint256[2] calldata,uint256[2][2] calldata,uint256[2] calldata,uint256[7] calldata) external view returns(bool);
}
/// @notice Audit only: never receives funds or changes the existing Vault.
contract PlatformLedgerCheckpoint {
 address public immutable operator;
 address public immutable vault;
 IPlatformLedgerVerifier public immutable verifier;
 bytes32 public immutable verificationKeyHash;
 uint256 public root;
 uint256 public sequence;
 uint256 public checkpointAt;
 uint256 public genesisRoot;
 event GenesisInitialized(uint256 root);
 event TransitionVerified(uint256 indexed sequence,uint256 indexed checkpointAt,uint256 oldRoot,uint256 newRoot,uint256 eventsRoot);
 constructor(address operator_,address vault_,address verifier_,bytes32 verificationKeyHash_) {
  require(operator_!=address(0)&&vault_!=address(0)&&verifier_.code.length>0,"CONFIG");
  operator=operator_;vault=vault_;verifier=IPlatformLedgerVerifier(verifier_);verificationKeyHash=verificationKeyHash_;
 }
 function initializeRoot(uint256 root_) external {
  require(msg.sender==operator,"OPERATOR");require(root==0&&root_>0&&root_<21888242871839275222246405745257275088548364400416034343698204186575808495617,"GENESIS");
  root=root_;genesisRoot=root_;emit GenesisInitialized(root_);
 }
 function append(uint256[2] calldata a,uint256[2][2] calldata b,uint256[2] calldata c,uint256[7] calldata inputs) external {
  require(msg.sender==operator,"OPERATOR");require(root!=0,"INITIALIZE");
  require(inputs[0]==block.chainid&&inputs[1]==uint256(uint160(vault)),"DOMAIN");
  require(inputs[2]==sequence+1&&inputs[4]==root,"CONTINUITY");
  require(inputs[3]>=checkpointAt&&inputs[3]<=block.timestamp&&inputs[5]!=root,"CHECKPOINT");
  require(verifier.verifyProof(a,b,c,inputs),"PROOF");
  root=inputs[5];sequence=inputs[2];checkpointAt=inputs[3];
  emit TransitionVerified(inputs[2],inputs[3],inputs[4],inputs[5],inputs[6]);
 }
}
