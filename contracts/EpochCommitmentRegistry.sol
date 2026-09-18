// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Publishes immutable epoch commitments; never receives or manages funds.
/// @dev An anchor proves publication of bytes. It does not prove timely submission,
///      complete enrollment, alpha correctness, private computation, or performance.
contract EpochCommitmentRegistry {
    struct Commitment {
        bytes32 root;
        bytes32 manifestHash;
        uint64 anchoredAt;
        uint64 blockNumber;
    }

    address public immutable publisher;
    mapping(bytes32 epochKey => Commitment commitment) private commitments;

    error InvalidPublisher();
    error Unauthorized();
    error InvalidCommitment();
    error AlreadyAnchored(bytes32 epochKey);

    event EpochAnchored(
        bytes32 indexed epochKey,
        bytes32 indexed root,
        bytes32 indexed manifestHash,
        uint64 anchoredAt,
        uint64 blockNumber
    );

    constructor(address initialPublisher) {
        if (initialPublisher == address(0)) revert InvalidPublisher();
        publisher = initialPublisher;
    }

    function anchor(bytes32 epochKey, bytes32 root, bytes32 manifestHash) external {
        if (msg.sender != publisher) revert Unauthorized();
        if (epochKey == bytes32(0) || root == bytes32(0) || manifestHash == bytes32(0)) {
            revert InvalidCommitment();
        }
        if (commitments[epochKey].root != bytes32(0)) revert AlreadyAnchored(epochKey);

        uint64 anchoredAt = uint64(block.timestamp);
        uint64 blockNumber = uint64(block.number);
        commitments[epochKey] = Commitment(root, manifestHash, anchoredAt, blockNumber);
        emit EpochAnchored(epochKey, root, manifestHash, anchoredAt, blockNumber);
    }

    function getCommitment(bytes32 epochKey) external view returns (Commitment memory) {
        return commitments[epochKey];
    }
}
