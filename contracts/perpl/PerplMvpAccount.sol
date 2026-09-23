// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICollateral {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}
interface IPerplMvp {
    struct OrderDesc {
        uint256 orderDescId; uint256 perpId; uint8 orderType; uint256 orderId;
        uint256 pricePNS; uint256 lotLNS; uint256 expiryBlock;
        bool postOnly; bool fillOrKill; bool immediateOrCancel;
        uint256 maxMatches; uint256 leverageHdths; uint256 lastExecutionBlock;
        uint256 amountCNS; uint256 maxNegPnlCollatBPS;
    }
    struct Position { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; uint256 priceResiduePNSQ16; }
    struct Bitmap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }
    struct Account { uint256 accountId; uint256 balanceCNS; uint256 lockedBalanceCNS; uint8 frozen; address accountAddr; Bitmap positions; }
    struct OrderLock { uint32 orderLockId; uint32 nextOrderLockId; uint32 prevOrderLockId; uint8 orderType; uint40 lotLNS; uint80 amountCNS; }
    function createAccount(uint256) external returns(uint256);
    function depositCollateral(uint256) external;
    function withdrawCollateral(uint256) external;
    function execOrder(OrderDesc calldata) external returns(uint256,uint256);
    function getAccountByAddr(address) external view returns(Account memory);
    function getPositionV2(uint256,uint256) external view returns(Position memory,uint256,bool);
    function getOrderLocks(uint256) external view returns(OrderLock[] memory);
}

/// Local-fork feasibility harness. One Product, one investor, one market per account.
/// EIP-712 manager authorization only: NOT a ZK verifier, TEE, fund, or full v1 Gate.
contract PerplMvpAccount {
    IPerplMvp public immutable venue;
    ICollateral public immutable collateral;
    address public immutable manager;
    address public immutable beneficiary;
    uint256 public immutable market;
    uint256 public immutable maxLots;
    uint256 public accountId;
    uint256 public nonce;
    uint256 private entered;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant TARGET_TYPEHASH = keccak256("Target(int256 target,uint256 limitPrice,uint256 nonce,uint256 deadline)");
    event Funded(uint256 amount, uint256 accountId);
    event Executed(uint256 indexed nonce, int256 target, int256 beforeQty, int256 afterQty, uint256 beforeFree, uint256 afterFree);
    event Recovered(uint256 amount, address beneficiary);
    modifier locked() { require(entered == 0,"REENTRANT"); entered=1; _; entered=0; }

    constructor(address exchange,address token,address manager_,address beneficiary_,uint256 market_,uint256 maxLots_) {
        require(block.chainid == 31337,"LOCAL_RESEARCH_ONLY");
        require(exchange.code.length>0 && token.code.length>0 && manager_!=address(0) && beneficiary_!=address(0),"CONFIG");
        require(maxLots_>0 && maxLots_ < 2**63,"CAP");
        venue=IPerplMvp(exchange); collateral=ICollateral(token); manager=manager_; beneficiary=beneficiary_; market=market_; maxLots=maxLots_;
        DOMAIN_SEPARATOR=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("Metropolis Perpl Feasibility"),keccak256("1"),block.chainid,address(this)));
    }
    function fund(uint256 amount) external locked {
        require(msg.sender==beneficiary && amount>0,"FUNDER");
        require(collateral.transferFrom(msg.sender,address(this),amount),"TRANSFER");
        require(collateral.approve(address(venue),amount),"APPROVE");
        if(accountId==0) accountId=venue.createAccount(amount);
        else venue.depositCollateral(amount);
        require(accountId>0,"ACCOUNT");
        require(collateral.approve(address(venue),0),"RESET");
        emit Funded(amount,accountId);
    }
    function position() public view returns(int256 qty,uint256 mark,bool valid) {
        (IPerplMvp.Position memory p,uint256 m,bool v)=venue.getPositionV2(market,accountId);
        require(p.lotLNS<2**63 && p.positionType<=1,"POSITION_RANGE");
        qty=p.positionType==0?int256(p.lotLNS):-int256(p.lotLNS);
        return(qty,m,v);
    }
    function digest(int256 target,uint256 limitPrice,uint256 seq,uint256 deadline) public view returns(bytes32) {
        return keccak256(abi.encodePacked("\x19\x01",DOMAIN_SEPARATOR,keccak256(abi.encode(TARGET_TYPEHASH,target,limitPrice,seq,deadline))));
    }
    function _authorize(int256 target,uint256 limitPrice,uint256 seq,uint256 deadline,bytes calldata signature) internal view virtual {
        require(signature.length==65,"SIGNATURE");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r:=calldataload(signature.offset) s:=calldataload(add(signature.offset,32)) v:=byte(0,calldataload(add(signature.offset,64))) }
        require(uint256(s)<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 && (v==27 || v==28),"SIGNATURE");
        require(ecrecover(digest(target,limitPrice,seq,deadline),v,r,s)==manager,"MANAGER");
    }
    function execute(int256 target,uint256 limitPrice,uint256 seq,uint256 deadline,bytes calldata signature) external locked {
        require(accountId>0 && seq==nonce && block.timestamp<deadline,"STALE");
        _authorize(target,limitPrice,seq,deadline,signature);
        require(target>=-int256(maxLots) && target<=int256(maxLots),"CAP");
        require(venue.getOrderLocks(accountId).length==0,"OPEN_ORDERS");
        (int256 beforeQty,uint256 mark,bool valid)=position();
        require(valid && mark>0 && limitPrice>0 && limitPrice<2**96,"MARK");
        require(beforeQty==0 || target==0 || (beforeQty>0)==(target>0),"FLATTEN_BEFORE_FLIP");
        int256 change=target-beforeQty; require(change!=0,"NO_CHANGE");
        bool buy=change>0;
        require(buy?limitPrice*10000<=mark*10100:limitPrice*10000>=mark*9900,"PRICE_BAND");
        uint256 oldAbs=uint256(beforeQty>=0?beforeQty:-beforeQty);
        uint256 newAbs=uint256(target>=0?target:-target);
        uint8 orderType=newAbs<oldAbs?(beforeQty>0?2:3):(buy?0:1);
        IPerplMvp.OrderDesc memory order=IPerplMvp.OrderDesc(seq+1,market,orderType,0,limitPrice,uint256(buy?change:-change),block.number+20,false,false,true,16,100,0,0,10000);
        uint256 beforeFree=venue.getAccountByAddr(address(this)).balanceCNS;
        nonce++;
        venue.execOrder(order);
        require(venue.getOrderLocks(accountId).length==0,"RESTING_ORDER");
        (int256 afterQty,,)=position();
        // The actual venue result is authoritative; never store target as a fill.
        require(buy?(afterQty>=beforeQty && afterQty<=target):(afterQty<=beforeQty && afterQty>=target),"FILL_RANGE");
        emit Executed(seq,target,beforeQty,afterQty,beforeFree,venue.getAccountByAddr(address(this)).balanceCNS);
    }
    function recover() external locked {
        require(msg.sender==beneficiary && accountId>0,"BENEFICIARY");
        (int256 qty,,)=position(); require(qty==0,"NOT_FLAT");
        require(venue.getOrderLocks(accountId).length==0,"OPEN_ORDERS");
        IPerplMvp.Account memory a=venue.getAccountByAddr(address(this));
        require(a.lockedBalanceCNS==0 && a.balanceCNS>0,"NO_FREE_BALANCE");
        uint256 beforeBal=collateral.balanceOf(address(this));
        venue.withdrawCollateral(a.balanceCNS);
        uint256 received=collateral.balanceOf(address(this))-beforeBal;
        require(received==a.balanceCNS,"WITHDRAW_AMOUNT");
        require(collateral.transfer(beneficiary,received),"TRANSFER");
        emit Recovered(received,beneficiary);
    }
}
