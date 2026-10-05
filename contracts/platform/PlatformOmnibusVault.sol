// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import './PlatformExecutionAccount.sol';
import './PlatformSharedExecutionAccount.sol';

interface IERC20Platform {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Single custody address for every strategy on the platform.
/// @dev Strategy attribution deliberately remains off-chain. `id` is an
/// opaque, one-time deposit identifier created for an authenticated investor.
contract PlatformOmnibusVault {
    IERC20Platform public immutable cash;
    address public operator;
    bool public paused;
    mapping(bytes32 => bool) public used;
    mapping(address => bool) public slots;
    address[] public accounts;
    uint256 private entered;
    modifier locked() { require(entered==0,'REENTRANT');entered=1;_;entered=0; }

    event Deposit(bytes32 indexed id, address indexed investor, uint256 amount);
    event Withdrawal(bytes32 indexed id, address indexed investor, uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed nextOperator);
    event Paused(bool value);

    modifier onlyOperator() {
        require(msg.sender == operator, "OPERATOR");
        _;
    }

    constructor(address token, address initialOperator) {
        require(token != address(0) && initialOperator != address(0), "ADDRESS");
        cash = IERC20Platform(token);
        operator = initialOperator;
    }

    function deposit(uint256 amount, bytes32 id) external locked {
        require(!paused && amount > 0 && id != bytes32(0) && !used[id], "DEPOSIT");
        used[id] = true;
        require(cash.transferFrom(msg.sender, address(this), amount), "TRANSFER");
        emit Deposit(id, msg.sender, amount);
    }

    function withdraw(address investor, uint256 amount, bytes32 id) external onlyOperator locked {
        require(investor != address(0) && amount > 0 && id != bytes32(0) && !used[id], "WITHDRAWAL");
        used[id] = true;
        require(cash.transfer(investor, amount), "TRANSFER");
        emit Withdrawal(id, investor, amount);
    }

    function createSlots(uint256 market,uint256 count) external onlyOperator locked {
        require(count>0&&count<=8,'COUNT');
        for(uint256 i;i<count;i++) {
            address slot=address(new PlatformExecutionAccount(0x1964C32f0bE608E7D29302AFF5E61268E72080cc,address(cash),address(this),operator,market));
            slots[slot]=true;accounts.push(slot);
        }
    }
    function accountCount() external view returns(uint256) {return accounts.length;}
    function executionAccountVersion() external pure returns(uint256) {return 2;}
    /// Shared accounts have no strategy or fixed-market identifier on-chain.
    function createSharedAccounts(uint256 count) external onlyOperator locked {
        require(count>0&&count<=8,'COUNT');
        for(uint256 i;i<count;i++) {
            address account=address(new PlatformSharedExecutionAccount(0x1964C32f0bE608E7D29302AFF5E61268E72080cc,address(cash),address(this),operator));
            slots[account]=true;accounts.push(account);
        }
    }
    function fundSlot(address slot,uint256 amount,bytes32 id) external onlyOperator locked {
        require(!paused&&slots[slot]&&!used[id]&&id!=bytes32(0),'SLOT');used[id]=true;
        require(cash.approve(slot,amount),'APPROVE');PlatformExecutionAccount(slot).fund(amount);
        require(cash.approve(slot,0),'RESET');
    }
    function recoverSlot(address slot,uint256 amount,bytes32 id) external onlyOperator locked {
        require(slots[slot]&&!used[id]&&id!=bytes32(0),'SLOT');used[id]=true;
        PlatformExecutionAccount(slot).recover(amount);
    }

    function setPaused(bool value) external onlyOperator {
        paused = value;
        emit Paused(value);
    }

    function setOperator(address nextOperator) external onlyOperator {
        require(nextOperator != address(0), "ADDRESS");
        address previous = operator;
        operator = nextOperator;
        emit OperatorChanged(previous, nextOperator);
    }
}
