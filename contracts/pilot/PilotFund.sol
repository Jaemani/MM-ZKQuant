// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Test assets only. Tokens are minted by the deployment operator and carry no
// redemption claim on BTC/ETH/MON/SOL/USD. No production money is accepted.
contract PilotToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
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
contract PilotVenue {
    PilotToken public immutable cash;
    address public immutable seeder;
    PilotToken[4] public assets;
    uint256[4] public cashReserves;
    uint256[4] public assetReserves;
    uint256[4] public lendingReserves;
    mapping(address => mapping(uint256 => uint256)) public shortDebt;
    mapping(address => mapping(uint256 => uint256)) public shortCollateral;
    event Swap(address indexed trader, uint256 indexed asset, bool buy, uint256 amountIn, uint256 amountOut, uint256 fee);
    event ShortOpened(address indexed trader, uint256 indexed asset, uint256 debt, uint256 cashCollateral);
    event ShortClosed(address indexed trader, uint256 indexed asset, uint256 debtRepaid, uint256 returnedCash);
    constructor(address quote, address[4] memory tokens) { cash = PilotToken(quote); seeder = msg.sender; for (uint256 i; i < 4; i++) assets[i] = PilotToken(tokens[i]); }
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
    function openShort(uint256 i, uint256 quantity, uint256 collateral, uint256 minProceeds, uint256 deadline) external {
        require(i < 4 && shortDebt[msg.sender][i] == 0 && quantity > 0 && quantity <= lendingReserves[i], 'SHORT');
        // Extra cash collateral covers at least the current sale proceeds. The
        // proceeds themselves are escrowed too; no uncollateralized withdrawal.
        require(collateral >= quote(i, false, quantity), 'MARGIN');
        require(cash.transferFrom(msg.sender, address(this), collateral));
        lendingReserves[i] -= quantity; shortDebt[msg.sender][i] = quantity;
        require(assets[i].transfer(msg.sender, quantity));
        uint256 proceeds = swap(i, false, quantity, minProceeds, deadline);
        require(cash.transferFrom(msg.sender, address(this), proceeds));
        shortCollateral[msg.sender][i] = collateral + proceeds;
        emit ShortOpened(msg.sender, i, quantity, collateral + proceeds);
    }
    function closeShort(uint256 i, uint256 maxInput, uint256 deadline) external returns (uint256 collateral, uint256 cost) {
        uint256 quantity = shortDebt[msg.sender][i]; collateral = shortCollateral[msg.sender][i];
        require(quantity > 0, 'NO_SHORT'); shortDebt[msg.sender][i] = 0; shortCollateral[msg.sender][i] = 0;
        require(cash.transfer(msg.sender, collateral));
        // A gap loss can require extra cash from the trader. It never silently
        // forgives debt or invents a profitable fill; insufficient cash reverts.
        cost = buyExact(i, quantity, maxInput, deadline);
        require(assets[i].transferFrom(msg.sender, address(this), quantity)); lendingReserves[i] += quantity;
        emit ShortClosed(msg.sender, i, quantity, collateral > cost ? collateral - cost : 0);
    }
}

contract PilotFund {
    uint256 public constant PERFORMANCE_FEE_BPS = 1000;
    uint256 public constant MAX_MARK_AGE = 180;
    uint256 public constant MAX_SLIPPAGE_BPS = 200;
    address public immutable operator;
    PilotToken public immutable cash;
    PilotVenue public immutable venue;
    PilotToken[4] public assets;
    uint256[4] public prices;
    uint256 public observedAt;
    bytes32 public marketHash;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    uint256 public highWaterPrice = 1e18;
    uint256 public rewardReserve;
    uint256 public accountedCash;
    uint256[4] public positions;
    bytes32 public activeEpoch;
    bool public paused;
    mapping(bytes32 => bool) public usedFlow;
    struct Epoch {
        bytes32 policyHash; bytes32 rosterHash; bytes32 weightsHash; bytes32 payoutsHash;
        bytes32 root; bytes32 manifestHash; bytes32 targetHash;
        uint64 cutoffAt; uint64 startAt; uint64 endAt; uint64 anchorBlock;
        uint256 initialNav; uint256 endingNav; uint256 feePool; uint8 phase;
    }
    mapping(bytes32 => Epoch) public epochs;
    event Deposit(address indexed investor, bytes32 indexed requestId, uint256 assets, uint256 shares);
    event Redeem(address indexed investor, bytes32 indexed requestId, uint256 shares, uint256 cashOut);
    event EpochOpened(bytes32 indexed epoch, bytes32 policyHash, bytes32 rosterHash, bytes32 weightsHash, bytes32 payoutsHash, uint64 cutoffAt, uint64 startAt, uint64 endAt);
    event Committed(bytes32 indexed epoch, bytes32 root, bytes32 manifestHash, bytes32 targetHash);
    event Executed(bytes32 indexed epoch, bytes32 marketHash, uint256 initialNav);
    event Closed(bytes32 indexed epoch, bytes32 marketHash, uint256 endingNav, uint256 feePool);
    event Reward(bytes32 indexed epoch, address indexed actor, uint256 amount);
    event Settled(bytes32 indexed epoch, bytes32 evaluationHash, bytes32 nextWeightsHash, uint256 paid);
    modifier onlyOperator() { require(msg.sender == operator, 'OPERATOR'); _; }
    modifier idle() { require(activeEpoch == bytes32(0), 'EPOCH_ACTIVE'); _; }
    constructor(address quote, address exchange, address[4] memory tokens) {
        operator = msg.sender; cash = PilotToken(quote); venue = PilotVenue(exchange);
        require(address(venue.cash()) == quote, 'VENUE');
        for (uint256 i; i < 4; i++) { require(address(venue.assets(i)) == tokens[i], 'ASSET'); assets[i] = PilotToken(tokens[i]); assets[i].approve(exchange, type(uint256).max); }
        cash.approve(exchange, type(uint256).max);
    }
    function setPaused(bool value) external onlyOperator { paused = value; }
    function setMarks(uint256[4] calldata marks, uint256 timestamp, bytes32 evidenceHash) external onlyOperator {
        require(timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_MARK_AGE && timestamp >= observedAt && evidenceHash != bytes32(0), 'STALE_MARK');
        for (uint256 i; i < 4; i++) require(marks[i] > 0 && marks[i] < 1e30, 'PRICE');
        if (timestamp == observedAt) require(evidenceHash == marketHash && keccak256(abi.encode(marks)) == keccak256(abi.encode(prices)), 'MARK_REVISION');
        prices = marks; observedAt = timestamp; marketHash = evidenceHash;
    }
    function totalAssets() public view returns (uint256 nav) {
        // Unsolicited ERC20 transfers are not alpha PnL or new investor shares.
        int256 equity = int256(accountedCash - rewardReserve);
        for (uint256 i; i < 4; i++) {
            equity += int256(positions[i] * prices[i] / 1e18);
            equity += int256(venue.shortCollateral(address(this), i));
            equity -= int256(venue.shortDebt(address(this), i) * prices[i] / 1e18);
        }
        nav = equity > 0 ? uint256(equity) : 0;
    }
    function deposit(uint256 amount, bytes32 requestId) external idle returns (uint256 shares) {
        require(!paused && amount > 0, 'DEPOSIT'); _flow(requestId);
        shares = amount * (totalSupply + 1) / (totalAssets() + 1); require(shares > 0, 'DUST');
        balanceOf[msg.sender] += shares; totalSupply += shares;
        require(cash.transferFrom(msg.sender, address(this), amount)); accountedCash += amount; emit Deposit(msg.sender, requestId, amount, shares);
    }
    function redeem(uint256 shares, bytes32 requestId) external idle returns (uint256 amount) {
        require(shares > 0 && shares <= balanceOf[msg.sender], 'SHARES'); _flow(requestId);
        // Epochs close every spot holding before shares can be redeemed.
        for (uint256 i; i < 4; i++) require(positions[i] == 0 && venue.shortDebt(address(this), i) == 0, 'UNSETTLED_HOLDING');
        amount = shares * (totalAssets() + 1) / (totalSupply + 1);
        balanceOf[msg.sender] -= shares; totalSupply -= shares;
        accountedCash -= amount; require(cash.transfer(msg.sender, amount)); emit Redeem(msg.sender, requestId, shares, amount);
    }
    function _flow(bytes32 id) private { bytes32 key = keccak256(abi.encode(msg.sender, id)); require(id != bytes32(0) && !usedFlow[key], 'DUPLICATE_FLOW'); usedFlow[key] = true; }
    function openEpoch(bytes32 id, bytes32 policy, bytes32 roster, bytes32 weights, bytes32 payouts, uint64 cutoff, uint64 start, uint64 end) external onlyOperator idle {
        require(!paused && totalSupply > 0 && id != bytes32(0) && epochs[id].phase == 0, 'OPEN');
        require(policy != bytes32(0) && roster != bytes32(0) && weights != bytes32(0) && payouts != bytes32(0), 'HASH');
        require(block.timestamp < cutoff && cutoff < start && start < end, 'SCHEDULE');
        Epoch storage e = epochs[id]; e.policyHash = policy; e.rosterHash = roster; e.weightsHash = weights; e.payoutsHash = payouts;
        e.cutoffAt = cutoff; e.startAt = start; e.endAt = end; e.phase = 1; activeEpoch = id;
        emit EpochOpened(id, policy, roster, weights, payouts, cutoff, start, end);
    }
    function commit(bytes32 id, bytes32 root, bytes32 manifest, bytes32 targets) external onlyOperator {
        Epoch storage e = epochs[id]; require(activeEpoch == id && e.phase == 1 && block.timestamp >= e.cutoffAt && block.timestamp < e.startAt, 'COMMIT_WINDOW');
        require(root != bytes32(0) && manifest != bytes32(0) && targets != bytes32(0), 'HASH');
        e.root = root; e.manifestHash = manifest; e.targetHash = targets; e.anchorBlock = uint64(block.number); e.phase = 2;
        emit Committed(id, root, manifest, targets);
    }
    function execute(bytes32 id, int256[4] calldata targets) external onlyOperator {
        Epoch storage e = epochs[id]; require(!paused && activeEpoch == id && e.phase == 2, 'EXECUTE_PHASE');
        require(block.number > e.anchorBlock && block.timestamp >= e.startAt && block.timestamp < e.endAt && observedAt >= e.startAt, 'EXECUTE_WINDOW');
        require(keccak256(abi.encode(targets)) == e.targetHash, 'TARGET_BINDING'); _fresh();
        e.initialNav = totalAssets();
        for (uint256 i; i < 4; i++) {
            require(targets[i] >= -2500 && targets[i] <= 2500, 'ASSET_CAP');
            uint256 weight = uint256(targets[i] < 0 ? -targets[i] : targets[i]);
            uint256 amount = e.initialNav * weight / 10000;
            if (amount > 0 && targets[i] > 0) { accountedCash -= amount; positions[i] = venue.swap(i, true, amount, amount * 1e18 / prices[i] * (10000 - MAX_SLIPPAGE_BPS) / 10000, block.timestamp); }
            if (amount > 0 && targets[i] < 0) { accountedCash -= amount; venue.openShort(i, amount * 1e18 / prices[i], amount, amount * (10000 - MAX_SLIPPAGE_BPS) / 10000, block.timestamp); }
        }
        e.phase = 3; emit Executed(id, marketHash, e.initialNav);
    }
    function closeEpoch(bytes32 id) external onlyOperator {
        Epoch storage e = epochs[id]; require(activeEpoch == id && e.phase == 3 && block.timestamp >= e.endAt && observedAt >= e.endAt, 'CLOSE_WINDOW'); _fresh();
        for (uint256 i; i < 4; i++) {
            uint256 quantity = positions[i];
            if (quantity > 0) { positions[i] = 0; accountedCash += venue.swap(i, false, quantity, quantity * prices[i] / 1e18 * (10000 - MAX_SLIPPAGE_BPS) / 10000, block.timestamp); }
            uint256 debt = venue.shortDebt(address(this), i);
            if (debt > 0) { (uint256 collateral, uint256 cost) = venue.closeShort(i, debt * prices[i] / 1e18 * (10000 + MAX_SLIPPAGE_BPS) / 10000, block.timestamp); accountedCash = accountedCash + collateral - cost; }
        }
        e.endingNav = totalAssets();
        uint256 threshold = totalSupply * highWaterPrice / 1e18;
        uint256 profit = e.endingNav > threshold ? e.endingNav - threshold : 0;
        e.feePool = profit * PERFORMANCE_FEE_BPS / 10000; rewardReserve = e.feePool; e.phase = 4;
        emit Closed(id, marketHash, e.endingNav, e.feePool);
    }
    function payRewards(bytes32 id, address[] calldata recipients, uint256[] calldata amounts, bytes32 evaluationHash, bytes32 nextWeightsHash) external onlyOperator {
        Epoch storage e = epochs[id]; require(activeEpoch == id && e.phase == 4 && recipients.length == amounts.length, 'REWARD_PHASE');
        require(evaluationHash != bytes32(0) && nextWeightsHash != bytes32(0) && keccak256(abi.encode(recipients)) == e.payoutsHash, 'REWARD_BINDING');
        uint256 paid;
        for (uint256 i; i < amounts.length; i++) { require(recipients[i] != address(0), 'RECIPIENT'); for (uint256 j; j < i; j++) require(recipients[i] != recipients[j], 'DUPLICATE_ACTOR'); paid += amounts[i]; }
        require(paid <= e.feePool, 'FEE_CAP'); rewardReserve = 0; accountedCash -= paid; e.phase = 5; activeEpoch = bytes32(0);
        for (uint256 i; i < amounts.length; i++) if (amounts[i] > 0) { require(cash.transfer(recipients[i], amounts[i])); emit Reward(id, recipients[i], amounts[i]); }
        uint256 sharePrice = totalAssets() * 1e18 / totalSupply; if (sharePrice > highWaterPrice) highWaterPrice = sharePrice;
        emit Settled(id, evaluationHash, nextWeightsHash, paid);
    }
    function cancelUnexecuted(bytes32 id) external onlyOperator {
        Epoch storage e = epochs[id]; require(activeEpoch == id && (e.phase == 1 || e.phase == 2) && block.timestamp >= e.startAt, 'CANCEL');
        e.phase = 6; activeEpoch = bytes32(0);
    }
    function _fresh() private view { require(observedAt > 0 && block.timestamp - observedAt <= MAX_MARK_AGE, 'STALE_MARK'); }
}
