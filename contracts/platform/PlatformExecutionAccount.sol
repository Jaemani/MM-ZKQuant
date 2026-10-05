// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '../perpl/PerplMvpAccount.sol';

/// A reusable execution slot. Strategy ownership is recorded only in the TEE.
contract PlatformExecutionAccount {
    IPerplMvp public immutable venue;
    ICollateral public immutable cash;
    address public immutable vault;
    address public immutable operator;
    uint256 public immutable market;
    uint256 public accountId;
    mapping(bytes32 => bool) public used;
    uint256 private entered;
    modifier locked() { require(entered == 0, 'REENTRANT'); entered=1; _; entered=0; }
    event Executed(bytes32 indexed id, int256 beforeQty, int256 afterQty);
    constructor(address exchange,address token,address owner,address executor,uint256 marketId) {
        require(block.chainid==10143||block.chainid==31337,'TESTNET_ONLY');
        venue=IPerplMvp(exchange);cash=ICollateral(token);vault=owner;operator=executor;market=marketId;
    }
    function fund(uint256 amount) external locked {
        require(msg.sender==vault&&amount>0,'VAULT');
        require(cash.transferFrom(vault,address(this),amount),'TRANSFER');
        require(cash.approve(address(venue),amount),'APPROVE');
        if(accountId==0) accountId=venue.createAccount(amount); else venue.depositCollateral(amount);
        require(cash.approve(address(venue),0),'RESET');
    }
    function position() public view returns(int256 qty,uint256 mark,bool valid) {
        if(accountId==0)return(0,0,false);
        (IPerplMvp.Position memory p,uint256 m,bool v)=venue.getPositionV2(market,accountId);
        require(p.lotLNS<2**63&&p.positionType<=1,'POSITION');
        return(p.positionType==0?int256(p.lotLNS):-int256(p.lotLNS),m,v);
    }
    function execute(bytes32 id,int256 target,uint256 price,uint256 deadline,uint256 leverage) external locked {
        require(msg.sender==operator&&!used[id]&&id!=bytes32(0)&&block.timestamp<deadline,'AUTH');
        require(target>-2**63&&target<2**63&&leverage>=100&&leverage<=1000,'CAP');
        require(venue.getOrderLocks(accountId).length==0,'OPEN_ORDERS');
        (int256 beforeQty,uint256 mark,bool valid)=position();
        require(valid&&mark>0&&price>0&&price<2**96,'MARK');
        require(beforeQty==0||target==0||(beforeQty>0)==(target>0),'FLATTEN_BEFORE_FLIP');
        int256 delta=target-beforeQty;require(delta!=0,'NO_CHANGE');bool buy=delta>0;
        require(buy?price*10000<=mark*10100:price*10000>=mark*9900,'PRICE_BAND');
        uint256 oldAbs=uint256(beforeQty<0?-beforeQty:beforeQty);uint256 newAbs=uint256(target<0?-target:target);
        uint8 kind=newAbs<oldAbs?(beforeQty>0?2:3):(buy?0:1);
        used[id]=true;
        venue.execOrder(IPerplMvp.OrderDesc(uint256(id),market,kind,0,price,uint256(delta<0?-delta:delta),block.number+20,false,false,true,16,leverage,0,0,10000));
        require(venue.getOrderLocks(accountId).length==0,'RESTING_ORDER');
        (int256 afterQty,,)=position();
        require(buy?(afterQty>=beforeQty&&afterQty<=target):(afterQty<=beforeQty&&afterQty>=target),'FILL_RANGE');
        emit Executed(id,beforeQty,afterQty);
    }
    function recover(uint256 amount) external locked returns(uint256) {
        require(msg.sender==vault,'VAULT');
        IPerplMvp.Account memory a=venue.getAccountByAddr(address(this));
        require(amount>0&&amount<=a.balanceCNS,'FREE_BALANCE');
        uint256 beforeBal=cash.balanceOf(address(this));venue.withdrawCollateral(amount);
        uint256 received=cash.balanceOf(address(this))-beforeBal;require(received==amount,'AMOUNT');
        require(cash.transfer(vault,received),'TRANSFER');return received;
    }
}
