// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

/// @title RollingStrategyVault
/// @notice Rolling multi-investor vault for confidential quant strategies on Monad Testnet.
/// Supports epoch-based deposits, unit NAV share minting/burning, redemption claims, HWM performance fees, and TEE execution receipts.
contract RollingStrategyVault {
    enum EpochStatus {
        Funding,
        Live,
        Settled
    }

    struct EpochInfo {
        uint256 sequence;
        EpochStatus status;
        uint256 depositCutoff;
        uint256 startAt;
        uint256 endAt;
        uint256 openingNav;
        uint256 closingNav;
        uint256 totalSharesAtStart;
        uint256 totalAssetsAtStart;
    }

    struct RedeemRequest {
        uint256 shares;
        uint256 epoch;
    }

    uint256 public constant NAV_DECIMALS = 1e6; // Base unit: 1.0 AUSD = 1_000_000
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    IERC20 public immutable collateral;
    address public immutable strategist;
    address public immutable operator;
    address public immutable feeRecipient;
    uint256 public immutable feeBps; // Max 2000 (20%)

    uint256 public epochSequence;
    uint256 public highWaterMarkNav;
    uint256 public lastUnitNav;
    uint256 public totalShares;

    mapping(address => uint256) public sharesOf;
    mapping(address => uint256) public pendingDeposits;
    mapping(address => RedeemRequest) public redeemRequests;
    mapping(address => uint256) public claimableAmounts;

    address[] public pendingInvestors;
    address[] public pendingRedeemers;
    mapping(address => bool) private hasPendingDeposit;
    mapping(address => bool) private hasPendingRedemption;

    mapping(uint256 => EpochInfo) public epochs;

    uint256 private _locked;

    // Events conforming to E2E Platform Requirements
    event Deposit(address indexed investor, uint256 indexed epoch, uint256 amount, uint256 pendingTotal);
    event RedeemRequested(address indexed investor, uint256 indexed epoch, uint256 shares);
    event Redeemed(address indexed investor, uint256 amount);
    event EpochOpened(uint256 indexed epoch, uint256 openingNav, uint256 totalShares, uint256 totalAssets);
    event EpochClosed(uint256 indexed epoch, uint256 closingNav, uint256 totalAssets, uint256 performanceFee);
    event NavCommitted(uint256 indexed epoch, uint256 estimatedNav, uint256 unitNav, uint256 sourceBlock);
    event ExecutionRecorded(uint256 indexed epoch, bytes32 indexed intentHash, bytes32 proofHash, int256 positionAfter);

    modifier nonReentrant() {
        require(_locked == 0, "REENTRANT");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "OPERATOR_ONLY");
        _;
    }

    constructor(
        address tokenAddress,
        address strategistAddress,
        address operatorAddress,
        address feeRecipientAddress,
        uint256 bps
    ) {
        require(tokenAddress != address(0) && strategistAddress != address(0), "INVALID_ADDRESS");
        require(operatorAddress != address(0) && feeRecipientAddress != address(0), "INVALID_ROLES");
        require(bps <= 2000, "FEE_BPS_TOO_HIGH");

        collateral = IERC20(tokenAddress);
        strategist = strategistAddress;
        operator = operatorAddress;
        feeRecipient = feeRecipientAddress;
        feeBps = bps;

        highWaterMarkNav = NAV_DECIMALS;
        lastUnitNav = NAV_DECIMALS;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("RollingStrategyVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

        // Start with Epoch 1 in Funding state
        epochSequence = 1;
        epochs[1] = EpochInfo({
            sequence: 1,
            status: EpochStatus.Funding,
            depositCutoff: block.timestamp + 1 hours,
            startAt: 0,
            endAt: 0,
            openingNav: NAV_DECIMALS,
            closingNav: 0,
            totalSharesAtStart: 0,
            totalAssetsAtStart: 0
        });
    }

    /// @notice Investors deposit test AUSD. Funds remain pending until the next epoch starts.
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "AMOUNT_ZERO");
        EpochInfo storage current = epochs[epochSequence];
        require(current.status == EpochStatus.Funding, "NOT_IN_FUNDING_PHASE");
        require(block.timestamp <= current.depositCutoff, "DEPOSIT_CUTOFF_PASSED");

        uint256 beforeBal = collateral.balanceOf(address(this));
        require(collateral.transferFrom(msg.sender, address(this), amount), "TRANSFER_FAILED");
        require(collateral.balanceOf(address(this)) == beforeBal + amount, "EXACT_TOKEN_MISMATCH");

        pendingDeposits[msg.sender] += amount;
        if (!hasPendingDeposit[msg.sender]) {
            hasPendingDeposit[msg.sender] = true;
            pendingInvestors.push(msg.sender);
        }

        emit Deposit(msg.sender, epochSequence, amount, pendingDeposits[msg.sender]);
    }

    /// @notice Request redemption of shares. Processed at the close of the current active epoch.
    function requestRedeem(uint256 shares) external nonReentrant {
        require(shares > 0 && sharesOf[msg.sender] >= shares, "INVALID_SHARES");
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;

        redeemRequests[msg.sender].shares += shares;
        redeemRequests[msg.sender].epoch = epochSequence;

        if (!hasPendingRedemption[msg.sender]) {
            hasPendingRedemption[msg.sender] = true;
            pendingRedeemers.push(msg.sender);
        }

        emit RedeemRequested(msg.sender, epochSequence, shares);
    }

    /// @notice Withdraw settled redemption claim in test AUSD.
    function claimRedemption() external nonReentrant returns (uint256 amount) {
        amount = claimableAmounts[msg.sender];
        require(amount > 0, "NO_CLAIMABLE_AMOUNT");
        claimableAmounts[msg.sender] = 0;

        require(collateral.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit Redeemed(msg.sender, amount);
    }

    /// @notice TEE Operator opens the epoch: mints shares for all pending deposits at the opening unit NAV.
    function openEpoch(uint256 durationSeconds) external onlyOperator nonReentrant {
        EpochInfo storage current = epochs[epochSequence];
        require(current.status == EpochStatus.Funding, "NOT_IN_FUNDING");

        current.status = EpochStatus.Live;
        current.startAt = block.timestamp;
        current.endAt = block.timestamp + durationSeconds;
        current.openingNav = lastUnitNav;

        // Process pending deposits
        for (uint256 i = 0; i < pendingInvestors.length; i++) {
            address investor = pendingInvestors[i];
            uint256 dep = pendingDeposits[investor];
            if (dep > 0) {
                // share count = (deposit * NAV_DECIMALS) / unitNav
                uint256 mintShares = (dep * NAV_DECIMALS) / current.openingNav;
                sharesOf[investor] += mintShares;
                totalShares += mintShares;
                pendingDeposits[investor] = 0;
            }
            hasPendingDeposit[investor] = false;
        }
        delete pendingInvestors;

        current.totalSharesAtStart = totalShares;
        current.totalAssetsAtStart = collateral.balanceOf(address(this));

        emit EpochOpened(epochSequence, current.openingNav, totalShares, current.totalAssetsAtStart);
    }

    /// @notice TEE Operator commits an interim 1-minute NAV mark.
    function commitNav(uint256 estimatedNav, uint256 sourceBlock) external onlyOperator {
        require(epochs[epochSequence].status == EpochStatus.Live, "EPOCH_NOT_LIVE");
        emit NavCommitted(epochSequence, estimatedNav, lastUnitNav, sourceBlock);
    }

    /// @notice TEE Operator logs execution receipts linked to TEE ZK proof.
    function recordExecution(
        bytes32 intentHash,
        bytes32 proofHash,
        int256 positionAfter
    ) external onlyOperator {
        require(epochs[epochSequence].status == EpochStatus.Live, "EPOCH_NOT_LIVE");
        emit ExecutionRecorded(epochSequence, intentHash, proofHash, positionAfter);
    }

    /// @notice TEE Operator closes and settles the epoch, calculating HWM performance fee and redemption claims.
    function closeAndSettleEpoch(
        uint256 currentVaultAssets,
        uint256 nextDepositCutoffDuration
    ) external onlyOperator nonReentrant {
        EpochInfo storage current = epochs[epochSequence];
        require(current.status == EpochStatus.Live, "EPOCH_NOT_LIVE");

        uint256 closingUnitNav = totalShares == 0
            ? NAV_DECIMALS
            : (currentVaultAssets * NAV_DECIMALS) / totalShares;

        uint256 performanceFee = 0;
        if (closingUnitNav > highWaterMarkNav && feeBps > 0) {
            uint256 gainPerShare = closingUnitNav - highWaterMarkNav;
            uint256 totalGain = (gainPerShare * totalShares) / NAV_DECIMALS;
            performanceFee = (totalGain * feeBps) / 10000;
            if (performanceFee > 0 && collateral.balanceOf(address(this)) >= performanceFee) {
                collateral.transfer(feeRecipient, performanceFee);
                currentVaultAssets -= performanceFee;
                closingUnitNav = (currentVaultAssets * NAV_DECIMALS) / totalShares;
            }
            highWaterMarkNav = closingUnitNav;
        }

        current.closingNav = closingUnitNav;
        lastUnitNav = closingUnitNav;
        current.status = EpochStatus.Settled;

        // Process pending redemptions
        for (uint256 i = 0; i < pendingRedeemers.length; i++) {
            address redeemer = pendingRedeemers[i];
            uint256 reqShares = redeemRequests[redeemer].shares;
            if (reqShares > 0) {
                uint256 payout = (reqShares * closingUnitNav) / NAV_DECIMALS;
                claimableAmounts[redeemer] += payout;
                delete redeemRequests[redeemer];
            }
            hasPendingRedemption[redeemer] = false;
        }
        delete pendingRedeemers;

        emit EpochClosed(epochSequence, closingUnitNav, currentVaultAssets, performanceFee);

        // Open next epoch in Funding state
        epochSequence += 1;
        epochs[epochSequence] = EpochInfo({
            sequence: epochSequence,
            status: EpochStatus.Funding,
            depositCutoff: block.timestamp + nextDepositCutoffDuration,
            startAt: 0,
            endAt: 0,
            openingNav: closingUnitNav,
            closingNav: 0,
            totalSharesAtStart: 0,
            totalAssetsAtStart: 0
        });
    }

    /// @notice Read-only view for an investor's total effective position
    function getInvestorSummary(address investor)
        external
        view
        returns (
            uint256 shares,
            uint256 pendingDeposit,
            uint256 pendingRedeemShares,
            uint256 claimable,
            uint256 currentNav
        )
    {
        return (
            sharesOf[investor],
            pendingDeposits[investor],
            redeemRequests[investor].shares,
            claimableAmounts[investor],
            lastUnitNav
        );
    }
}
