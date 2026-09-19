// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address) external view returns (uint256);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
    function approve(address,uint256) external returns (bool);
}
interface IV3Router {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}

/// PoC: fixed signer, pair and router. Signer enrollment must be verified OFFCHAIN
/// against hardware attestation before deployment. This contract does not verify TDX.
/// No admin withdrawal, arbitrary call, or signer upgrade. Permanent key loss is
/// not recoverable for credited funds: production recovery is deliberately absent.
contract ApprovedVault {
    struct Approval {
        uint256 sequence; bytes32 previous; bytes32 requestId; bytes32 intent;
        uint8 kind; address tokenIn; uint256 amount; uint256 minOut;
        address recipient; uint256 deadline;
    }
    struct Deposit { address owner; uint256 amount; uint256 timestamp; bool consumed; }
    address public immutable signer;
    address public immutable cash;
    address public immutable asset;
    address public immutable router;
    uint24 public immutable fee;
    bytes32 public immutable policyHash;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant APPROVAL_TYPEHASH = keccak256("Approval(uint256 sequence,bytes32 previous,bytes32 requestId,bytes32 intent,uint8 kind,address tokenIn,uint256 amount,uint256 minOut,address recipient,uint256 deadline)");
    uint256 public sequence;
    bytes32 public checkpoint;
    uint256 public cashAccounted;
    uint256 public assetAccounted;
    mapping(bytes32 => Deposit) public deposits;
    mapping(bytes32 => bool) public used;
    bool private entered;
    event Deposited(bytes32 indexed id,address indexed owner,uint256 amount);
    event Refunded(bytes32 indexed id,address indexed owner,uint256 amount);
    event Applied(uint256 indexed sequence,bytes32 indexed requestId,bytes32 approvalHash,uint8 kind,uint256 amountOut,bytes32 checkpoint);
    modifier locked() { require(!entered,"REENTRANCY"); entered=true; _; entered=false; }
    constructor(address signingKey,address quote,address base,address venue,uint24 poolFee,bytes32 policy,bytes32 initial) {
        require(signingKey!=address(0)&&quote!=base&&quote.code.length>0&&base.code.length>0&&venue.code.length>0,"CONFIG");
        require(policy!=bytes32(0)&&initial!=bytes32(0),"POLICY");
        signer=signingKey;cash=quote;asset=base;router=venue;fee=poolFee;policyHash=policy;checkpoint=initial;
        DOMAIN_SEPARATOR=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"),keccak256("MM_APPROVED_VAULT"),keccak256("1"),block.chainid,address(this),policy));
    }
    function tokenCall(address token,bytes memory data) private {
        (bool ok,bytes memory result)=token.call(data);
        require(ok&&(result.length==0||abi.decode(result,(bool))),"TOKEN");
    }
    function deposit(bytes32 id,uint256 amount) external locked {
        require(id!=bytes32(0)&&deposits[id].owner==address(0)&&amount>0,"DEPOSIT");
        uint256 beforeBalance=IERC20Minimal(cash).balanceOf(address(this));
        tokenCall(cash,abi.encodeCall(IERC20Minimal.transferFrom,(msg.sender,address(this),amount)));
        require(IERC20Minimal(cash).balanceOf(address(this))-beforeBalance==amount,"TOKEN_AMOUNT");
        deposits[id]=Deposit(msg.sender,amount,block.timestamp,false);emit Deposited(id,msg.sender,amount);
    }
    function refundUncredited(bytes32 id) external locked {
        Deposit storage d=deposits[id];
        require(d.owner==msg.sender&&!d.consumed&&block.timestamp>=d.timestamp+1 hours,"REFUND");
        d.consumed=true;tokenCall(cash,abi.encodeCall(IERC20Minimal.transfer,(msg.sender,d.amount)));
        emit Refunded(id,msg.sender,d.amount);
    }
    function approvalHash(Approval calldata a) public view returns(bytes32) {
        return keccak256(abi.encodePacked("\x19\x01",DOMAIN_SEPARATOR,keccak256(abi.encode(APPROVAL_TYPEHASH,a))));
    }
    function executeApproved(Approval calldata a,bytes calldata signature) external locked returns(uint256 out) {
        require(a.sequence==sequence+1&&a.previous==checkpoint,"STALE_STATE");
        require(a.requestId!=bytes32(0)&&!used[a.requestId]&&a.intent!=bytes32(0),"REPLAY");
        require(a.amount>0&&block.timestamp<=a.deadline&&a.deadline<=block.timestamp+15 minutes,"EXPIRED");
        require(signature.length==65,"SIGNATURE");
        bytes32 r;bytes32 s;uint8 v;
        assembly { r:=calldataload(signature.offset) s:=calldataload(add(signature.offset,32)) v:=byte(0,calldataload(add(signature.offset,64))) }
        require(uint256(s)<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0&&(v==27||v==28),"SIGNATURE");
        bytes32 digest=approvalHash(a);require(ecrecover(digest,v,r,s)==signer,"SIGNER");
        used[a.requestId]=true;
        if(a.kind==0) {
            Deposit storage d=deposits[a.requestId];
            require(!d.consumed&&d.owner==a.recipient&&d.amount==a.amount&&a.tokenIn==cash&&a.minOut==0,"CREDIT");
            d.consumed=true;cashAccounted+=a.amount;out=a.amount;
        } else if(a.kind==1) {
            require((a.tokenIn==cash||a.tokenIn==asset)&&a.recipient==address(this)&&a.minOut>0,"SWAP");
            bool buy=a.tokenIn==cash;address tokenOut=buy?asset:cash;
            require(a.amount<=(buy?cashAccounted:assetAccounted),"ACCOUNTED_BALANCE");
            uint256 beforeIn=IERC20Minimal(a.tokenIn).balanceOf(address(this));
            uint256 beforeOut=IERC20Minimal(tokenOut).balanceOf(address(this));
            tokenCall(a.tokenIn,abi.encodeCall(IERC20Minimal.approve,(router,0)));
            tokenCall(a.tokenIn,abi.encodeCall(IERC20Minimal.approve,(router,a.amount)));
            IV3Router(router).exactInputSingle(IV3Router.ExactInputSingleParams(a.tokenIn,tokenOut,fee,address(this),a.deadline,a.amount,a.minOut,0));
            tokenCall(a.tokenIn,abi.encodeCall(IERC20Minimal.approve,(router,0)));
            out=IERC20Minimal(tokenOut).balanceOf(address(this))-beforeOut;
            require(beforeIn-IERC20Minimal(a.tokenIn).balanceOf(address(this))==a.amount&&out>=a.minOut,"FILL");
            if(buy){cashAccounted-=a.amount;assetAccounted+=out;}else{assetAccounted-=a.amount;cashAccounted+=out;}
        } else if(a.kind==2) {
            require(a.tokenIn==cash&&a.recipient!=address(0)&&a.recipient!=address(this)&&a.amount<=cashAccounted&&a.minOut==0,"WITHDRAW");
            cashAccounted-=a.amount;out=a.amount;
            uint256 beforeBalance=IERC20Minimal(cash).balanceOf(a.recipient);
            tokenCall(cash,abi.encodeCall(IERC20Minimal.transfer,(a.recipient,out)));
            require(IERC20Minimal(cash).balanceOf(a.recipient)-beforeBalance==out,"TOKEN_AMOUNT");
        } else revert("KIND");
        sequence=a.sequence;checkpoint=keccak256(abi.encode(checkpoint,digest,out));
        emit Applied(sequence,a.requestId,digest,a.kind,out,checkpoint);
    }
}
