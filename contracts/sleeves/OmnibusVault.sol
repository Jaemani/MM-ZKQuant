// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Test assets only. Tokens are minted by the deployment operator and carry no
// redemption claim on BTC/ETH/MON/SOL/USD. No production money is accepted.
contract SleeveToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    address public immutable minter;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    constructor(string memory label, string memory ticker) { name = label; symbol = ticker; minter = msg.sender; }
    function mint(address to, uint256 amount) external { require(msg.sender == minter && to != address(0), 'MINTER'); totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transfer(address to, uint256 amount) external returns (bool) { _move(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { uint256 a = allowance[from][msg.sender]; require(a >= amount, 'ALLOWANCE'); if (a != type(uint256).max) allowance[from][msg.sender] = a - amount; _move(from, to, amount); return true; }
    function _move(address from, address to, uint256 amount) internal { require(to != address(0) && balanceOf[from] >= amount, 'BALANCE'); balanceOf[from] -= amount; balanceOf[to] += amount; emit Transfer(from, to, amount); }
}

// A real constant-product exchange for the above test assets. Fills transfer
// ERC20 balances and pay a 1bp fee. Liquidity is seeded once, with no admin drain.
// This proves test-asset execution, not production venue capacity or liquidity.
contract SleeveVenue {
    SleeveToken public immutable cash;
    address public immutable seeder;
    SleeveToken[4] public assets;
    uint256[4] public cashReserves;
    uint256[4] public assetReserves;
    uint256[4] public lendingReserves;
    mapping(address => mapping(bytes32 => uint256)) public shortDebt;
    mapping(address => mapping(bytes32 => uint256)) public lotAsset;
    mapping(address => mapping(bytes32 => uint256)) public shortCollateral;
    event Swap(address indexed trader, uint256 indexed asset, bool buy, uint256 amountIn, uint256 amountOut, uint256 fee);
    event ShortOpened(address indexed trader, uint256 indexed asset, uint256 debt, uint256 cashCollateral);
    event ShortClosed(address indexed trader, uint256 indexed asset, uint256 debtRepaid, uint256 returnedCash);
    constructor(address quote, address[4] memory tokens) { cash = SleeveToken(quote); seeder = msg.sender; for (uint256 i; i < 4; i++) assets[i] = SleeveToken(tokens[i]); }
    function seed(uint256 i, uint256 quote, uint256 quantity) external {
        require(msg.sender == seeder && i < 4 && cashReserves[i] == 0 && quote > 0 && quantity > 0, 'SEED');
        require(cash.transferFrom(msg.sender, address(this), quote) && assets[i].transferFrom(msg.sender, address(this), quantity));
        cashReserves[i] = quote; assetReserves[i] = quantity;
    }
    function seedLending(uint256 i, uint256 quantity) external {
        require(msg.sender == seeder && i < 4 && lendingReserves[i] == 0 && quantity > 0, 'LENDING_SEED');
        require(assets[i].transferFrom(msg.sender, address(this), quantity)); lendingReserves[i] = quantity;
    }
    function quote(uint256 i, bool buy, uint256 amount) public view returns (uint256) {
        require(i < 4 && cashReserves[i] > 0, 'POOL');
        uint256 input = buy ? cashReserves[i] : assetReserves[i];
        uint256 output = buy ? assetReserves[i] : cashReserves[i];
        uint256 net = amount * 9999;
        return net * output / (input * 10000 + net);
    }
    function swap(uint256 i, bool buy, uint256 amount, uint256 minOut, uint256 deadline) public returns (uint256 out) {
        require(block.timestamp <= deadline && amount > 0, 'DEADLINE_OR_AMOUNT');
        out = quote(i, buy, amount); require(out >= minOut && out > 0, 'SLIPPAGE');
        if (buy) {
            cashReserves[i] += amount; assetReserves[i] -= out;
            require(cash.transferFrom(msg.sender, address(this), amount) && assets[i].transfer(msg.sender, out));
        } else {
            assetReserves[i] += amount; cashReserves[i] -= out;
            require(assets[i].transferFrom(msg.sender, address(this), amount) && cash.transfer(msg.sender, out));
        }
        emit Swap(msg.sender, i, buy, amount, out, amount - amount * 9999 / 10000);
    }
    function buyExact(uint256 i, uint256 quantity, uint256 maxInput, uint256 deadline) public returns (uint256 cost) {
        require(i < 4 && quantity > 0 && quantity < assetReserves[i] && block.timestamp <= deadline, 'EXACT_OUTPUT');
        uint256 numerator = cashReserves[i] * quantity * 10000;
        uint256 denominator = (assetReserves[i] - quantity) * 9999;
        cost = (numerator + denominator - 1) / denominator;
        require(cost <= maxInput, 'SLIPPAGE'); cashReserves[i] += cost; assetReserves[i] -= quantity;
        require(cash.transferFrom(msg.sender, address(this), cost) && assets[i].transfer(msg.sender, quantity));
        emit Swap(msg.sender, i, true, cost, quantity, cost - cost * 9999 / 10000);
    }
    function openShort(bytes32 lot, uint256 i, uint256 quantity, uint256 collateral, uint256 minProceeds, uint256 deadline) external {
        require(lot != bytes32(0) && i < 4 && shortDebt[msg.sender][lot] == 0 && quantity > 0 && quantity <= lendingReserves[i], 'SHORT');
        // Extra cash collateral covers at least the current sale proceeds. The
        // proceeds themselves are escrowed too; no uncollateralized withdrawal.
        require(collateral >= quote(i, false, quantity), 'MARGIN');
        require(cash.transferFrom(msg.sender, address(this), collateral));
        lotAsset[msg.sender][lot] = i; lendingReserves[i] -= quantity; shortDebt[msg.sender][lot] = quantity;
        require(assets[i].transfer(msg.sender, quantity));
        uint256 proceeds = swap(i, false, quantity, minProceeds, deadline);
        require(cash.transferFrom(msg.sender, address(this), proceeds));
        shortCollateral[msg.sender][lot] = collateral + proceeds;
        emit ShortOpened(msg.sender, i, quantity, collateral + proceeds);
    }
    function closeShort(bytes32 lot, uint256 maxInput, uint256 deadline) external returns (uint256 collateral, uint256 cost) {
        uint256 i = lotAsset[msg.sender][lot]; uint256 quantity = shortDebt[msg.sender][lot]; collateral = shortCollateral[msg.sender][lot];
        require(quantity > 0, 'NO_SHORT'); shortDebt[msg.sender][lot] = 0; shortCollateral[msg.sender][lot] = 0;
        require(cash.transfer(msg.sender, collateral));
        // A gap loss can require extra cash from the trader. It never silently
        // forgives debt or invents a profitable fill; insufficient cash reverts.
        cost = buyExact(i, quantity, maxInput, deadline);
        require(assets[i].transferFrom(msg.sender, address(this), quantity)); lendingReserves[i] += quantity;
        emit ShortClosed(msg.sender, i, quantity, collateral > cost ? collateral - cost : 0);
    }
}


// Test-asset custody/execution only. Strategy attribution stays offchain.
// Operator is trusted until TEE authorization is integrated. No pooled shares.
contract OmnibusVault {
    address public immutable operator;
    SleeveToken public immutable cash;
    SleeveVenue public immutable venue;
    SleeveToken[4] public assets;
    mapping(bytes32 => bool) public used;
    mapping(bytes32 => bytes32) public commitments;
    mapping(bytes32 => uint256) public anchorBlock;
    bool public paused;
    event Deposit(bytes32 indexed id, address indexed investor, uint256 amount);
    event Withdrawal(bytes32 indexed id, address indexed investor, uint256 amount);
    event Committed(bytes32 indexed id, bytes32 commitment);
    event Fill(bytes32 indexed id, uint8 side, uint256 asset, uint256 quantity, uint256 cashAmount, uint256 escrow, bytes32 lot);
    modifier onlyOperator() { require(msg.sender == operator, 'OPERATOR'); _; }
    constructor(address quote, address exchange, address[4] memory tokens) {
        operator = msg.sender; cash = SleeveToken(quote); venue = SleeveVenue(exchange);
        require(address(venue.cash()) == quote, 'VENUE');
        cash.approve(exchange, type(uint256).max);
        for(uint256 i; i < 4; i++) {
            require(address(venue.assets(i)) == tokens[i], 'ASSET');
            assets[i] = SleeveToken(tokens[i]); assets[i].approve(exchange, type(uint256).max);
        }
    }
    function _use(bytes32 id) private { require(id != bytes32(0) && !used[id], 'REPLAY'); used[id] = true; }
    function setPaused(bool value) external onlyOperator { paused = value; }
    function deposit(uint256 amount, bytes32 id) external {
        require(!paused && amount > 0, 'DEPOSIT'); _use(id);
        require(cash.transferFrom(msg.sender, address(this), amount)); emit Deposit(id, msg.sender, amount);
    }
    function withdraw(address investor, uint256 amount, bytes32 id) external onlyOperator {
        require(investor != address(0) && amount > 0, 'WITHDRAW'); _use(id);
        require(cash.transfer(investor, amount)); emit Withdrawal(id, investor, amount);
    }
    function commit(bytes32 id, bytes32 commitment) external onlyOperator {
        require(!paused && id != bytes32(0) && commitments[id] == bytes32(0) && commitment != bytes32(0), 'COMMIT');
        commitments[id] = commitment; anchorBlock[id] = block.number; emit Committed(id, commitment);
    }
    // The salted provider message is never opened onchain. The trusted operator
    // verifies its signature/binding in the private coordinator before executing.
    function execute(bytes32 id, uint8 side, uint256 asset, uint256 amount, uint256 limit, uint256 collateral, bytes32 lot, uint256 deadline) external onlyOperator {
        require(asset < 4 && block.timestamp <= deadline && amount > 0, 'ORDER');
        require(commitments[id] != bytes32(0) && block.number > anchorBlock[id], 'ANCHOR');
        require(!paused || side == 1 || side == 3, 'PAUSED'); _use(id);
        uint256 qty; uint256 quote; uint256 escrow;
        if(side == 0) { quote = amount; qty = venue.swap(asset,true,amount,limit,deadline); }
        else if(side == 1) { qty = amount; quote = venue.swap(asset,false,amount,limit,deadline); }
        else if(side == 2) {
            require(venue.shortDebt(address(this),lot) == 0, 'LOT');
            qty = amount; uint256 beforeCash = cash.balanceOf(address(this));
            venue.openShort(lot,asset,amount,collateral,limit,deadline);
            quote = beforeCash - cash.balanceOf(address(this));
            escrow = venue.shortCollateral(address(this),lot);
        } else if(side == 3) {
            require(venue.lotAsset(address(this),lot) == asset && venue.shortDebt(address(this),lot) == amount, 'LOT');
            qty = amount; (escrow, quote) = venue.closeShort(lot,limit,deadline);
        } else revert('SIDE');
        emit Fill(id,side,asset,qty,quote,escrow,lot);
    }
}
