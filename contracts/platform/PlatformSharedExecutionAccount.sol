// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '../perpl/PerplMvpAccount.sol';

/// @notice A single Perpl account can execute multiple markets and strategies.
/// @dev Strategy ownership and attribution are maintained exclusively by the TEE.
/// The operator supplies a reconciled account position, never a strategy target.
contract PlatformSharedExecutionAccount {
    IPerplMvp public immutable venue;
    ICollateral public immutable cash;
    address public immutable vault;
    address public immutable operator;
    uint256 public accountId;
    mapping(bytes32 => bool) public used;
    uint256[] public tradedMarkets;
    mapping(uint256 => bool) private trackedMarket;
    uint256 private entered;
    modifier locked() { require(entered==0,'REENTRANT');entered=1;_;entered=0; }
    event Executed(bytes32 indexed id,uint256 market,int256 beforeQty,int256 afterQty);

    constructor(address exchange,address token,address owner,address executor) {
        require(block.chainid==10143||block.chainid==31337,'TESTNET_ONLY');
        require(exchange!=address(0)&&token!=address(0)&&owner!=address(0)&&executor!=address(0),'ADDRESS');
        venue=IPerplMvp(exchange);cash=ICollateral(token);vault=owner;operator=executor;
    }

    function fund(uint256 amount) external locked {
        require(msg.sender==vault&&amount>0,'VAULT');
        require(cash.transferFrom(vault,address(this),amount),'TRANSFER');
        _fund(amount);
    }

    /// Existing v1 vaults can transfer collateral using their operator-only
    /// withdraw function. Only the same enclave operator can admit that cash.
    function fundFromBalance(uint256 amount) external locked {
        require(msg.sender==operator&&amount>0&&cash.balanceOf(address(this))>=amount,'OPERATOR');
        _fund(amount);
    }

    function _fund(uint256 amount) private {
        require(cash.approve(address(venue),amount),'APPROVE');
        if(accountId==0)accountId=venue.createAccount(amount);
        else venue.depositCollateral(amount);
        require(accountId>0,'ACCOUNT');
        require(cash.approve(address(venue),0),'RESET');
    }

    function marketCount() external view returns(uint256) {return tradedMarkets.length;}

    function position(uint256 market) public view returns(int256 qty,uint256 mark,bool valid) {
        if(accountId==0)return(0,0,false);
        (IPerplMvp.Position memory p,uint256 m,bool v)=venue.getPositionV2(market,accountId);
        require(p.lotLNS<2**63&&p.positionType<=1,'POSITION');
        return(p.positionType==0?int256(p.lotLNS):-int256(p.lotLNS),m,v);
    }

    /// @notice Execute one request's change against the shared account position.
    /// @dev expectedBefore prevents a stale strategy request from overwriting a
    /// concurrent strategy's fill. Sign reversals must first flatten and reconcile.
    function executeDelta(bytes32 id,uint256 market,int256 expectedBefore,int256 delta,uint256 price,uint256 deadline,uint256 leverage) external locked {
        require(msg.sender==operator&&!used[id]&&id!=bytes32(0)&&block.timestamp<deadline,'AUTH');
        require(accountId>0&&leverage>=100&&leverage<=1000,'CAP');
        require(venue.getOrderLocks(accountId).length==0,'OPEN_ORDERS');
        (int256 beforeQty,uint256 mark,bool valid)=position(market);
        require(beforeQty==expectedBefore,'POSITION_CHANGED');
        require(delta!=0&&delta>-2**63&&delta<2**63,'DELTA');
        int256 target=beforeQty+delta;
        require(target>-2**63&&target<2**63,'CAP');
        require(valid&&mark>0&&price>0&&price<2**96,'MARK');
        require(beforeQty==0||target==0||(beforeQty>0)==(target>0),'FLATTEN_BEFORE_FLIP');
        bool buy=delta>0;
        require(buy?price*10000<=mark*10100:price*10000>=mark*9900,'PRICE_BAND');
        uint256 oldAbs=uint256(beforeQty<0?-beforeQty:beforeQty);
        uint256 newAbs=uint256(target<0?-target:target);
        uint8 kind=newAbs<oldAbs?(beforeQty>0?2:3):(buy?0:1);
        used[id]=true;
        if(!trackedMarket[market]){trackedMarket[market]=true;tradedMarkets.push(market);}
        venue.execOrder(IPerplMvp.OrderDesc(uint256(id),market,kind,0,price,uint256(delta<0?-delta:delta),block.number+20,false,false,true,16,leverage,0,0,10000));
        require(venue.getOrderLocks(accountId).length==0,'RESTING_ORDER');
        (int256 afterQty,,)=position(market);
        require(buy?(afterQty>=beforeQty&&afterQty<=target):(afterQty<=beforeQty&&afterQty>=target),'FILL_RANGE');
        emit Executed(id,market,beforeQty,afterQty);
    }

    function recover(uint256 amount) external locked returns(uint256) {
        require(msg.sender==vault,'VAULT');return _recover(amount);
    }
    function recoverToVault(uint256 amount) external locked returns(uint256) {
        require(msg.sender==operator,'OPERATOR');return _recover(amount);
    }
    function _recover(uint256 amount) private returns(uint256) {
        require(amount>0,'AMOUNT');
        uint256 beforeBal=cash.balanceOf(address(this));
        if(amount>beforeBal){
            require(accountId>0,'ACCOUNT');uint256 needed=amount-beforeBal;
            IPerplMvp.Account memory a=venue.getAccountByAddr(address(this));
            require(needed<=a.balanceCNS,'FREE_BALANCE');venue.withdrawCollateral(needed);
            require(cash.balanceOf(address(this))-beforeBal==needed,'AMOUNT');
        }
        require(cash.transfer(vault,amount),'TRANSFER');return amount;
    }
}
