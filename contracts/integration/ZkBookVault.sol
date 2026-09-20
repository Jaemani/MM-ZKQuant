// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ApprovedVault.sol";

interface IBookVerifier {
    function verifyProof(uint[2] calldata a,uint[2][2] calldata b,uint[2] calldata c,uint[15] calldata inputs) external view returns(bool);
}

/// Local-fork research harness. Genesis ownership is trusted; no investor claims
/// or withdrawals. Deliberately cannot deploy on Monad/testnet/mainnet.
contract ZkBookVault {
    uint256 public constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    struct Proof { uint[2] a; uint[2][2] b; uint[2] c; }
    IBookVerifier public immutable verifier;
    address public immutable bootstrapper;
    address public immutable cash;
    address public immutable asset;
    address public immutable router;
    uint24 public immutable fee;
    uint256 public immutable config;
    uint256 public immutable maxSpendBps;
    uint256 public root;
    uint256 public batch;
    uint256 public settledCursor;
    uint256 public cashAccounted;
    uint256 public assetAccounted;
    bool public seeded;
    bool public pending;
    bytes32 public pendingPlan;
    uint256 public actualOut;
    bool private entered;
    event Seeded(uint256 root,uint256 cashAmount);
    event Executed(uint256 indexed batch,uint256 reservedRoot,bytes32 plan,uint256 amountOut);
    event Settled(uint256 indexed batch,uint256 settledRoot);
    modifier locked(){require(!entered,"REENTRANCY");entered=true;_;entered=false;}

    constructor(address v,address quote,address base,address venue,uint24 poolFee,uint256 policy,uint256 cashSpendLimit) {
        require(block.chainid==31337,"LOCAL_RESEARCH_ONLY");
        require(v.code.length>0&&quote.code.length>0&&base.code.length>0&&venue.code.length>0&&quote!=base,"CONFIG");
        require(policy>0&&policy<FIELD&&cashSpendLimit>0&&cashSpendLimit<=10000,"POLICY");
        bootstrapper=msg.sender;verifier=IBookVerifier(v);cash=quote;asset=base;router=venue;fee=poolFee;config=policy;maxSpendBps=cashSpendLimit;
    }
    function tokenCall(address token,bytes memory data) private {
        (bool ok,bytes memory result)=token.call(data);
        require(ok&&(result.length==0||abi.decode(result,(bool))),"TOKEN");
    }
    // Synthetic two-book starting allocation, funded with actual fork ERC20.
    // This is explicitly NOT a proof of deposit/share ownership.
    function seed(uint256 initialRoot,uint256 cashAmount) external locked {
        require(msg.sender==bootstrapper&&!seeded&&initialRoot>0&&initialRoot<FIELD&&cashAmount>0,"SEED");
        uint256 previous=IERC20Minimal(cash).balanceOf(address(this));
        tokenCall(cash,abi.encodeCall(IERC20Minimal.transferFrom,(msg.sender,address(this),cashAmount)));
        require(IERC20Minimal(cash).balanceOf(address(this))-previous==cashAmount,"TOKEN_AMOUNT");
        root=initialRoot;cashAccounted=cashAmount;seeded=true;emit Seeded(root,cashAmount);
    }
    function check(Proof calldata p,uint[15] calldata s) private view {
        require(s[1]==block.chainid&&s[2]==uint160(address(this))&&s[3]==config&&s[14]==maxSpendBps,"DOMAIN");
        require(s[5]==root,"STALE_ROOT");
        require(verifier.verifyProof(p.a,p.b,p.c,s),"INVALID_PROOF");
    }
    function plan(uint[15] calldata s) private pure returns(bytes32) {
        return keccak256(abi.encode(s[4],s[7],s[8],s[9],s[10]));
    }
    function authorizeAndExecute(Proof calldata p,uint[15] calldata s) external locked {
        require(seeded&&!pending,"PENDING_OR_UNSEEDED");
        require(s[0]==1&&s[4]==batch+1&&s[11]==0,"PHASE");
        require(s[10]>=block.timestamp&&s[10]<=block.timestamp+15 minutes,"EXPIRED");
        require(s[12]==cashAccounted&&s[13]==assetAccounted,"ACCOUNTING");
        check(p,s);
        bool buy=s[7]==1;address input=buy?cash:asset;address output=buy?asset:cash;
        require(s[8]<=(buy?cashAccounted:assetAccounted),"BALANCE");
        uint256 previousIn=IERC20Minimal(input).balanceOf(address(this));
        uint256 previousOut=IERC20Minimal(output).balanceOf(address(this));
        // R0 -> R1, DEX execution and authenticated receipt are one transaction.
        root=s[6];batch=s[4];pending=true;pendingPlan=plan(s);
        tokenCall(input,abi.encodeCall(IERC20Minimal.approve,(router,0)));
        tokenCall(input,abi.encodeCall(IERC20Minimal.approve,(router,s[8])));
        IV3Router(router).exactInputSingle(IV3Router.ExactInputSingleParams(input,output,fee,address(this),s[10],s[8],s[9],0));
        tokenCall(input,abi.encodeCall(IERC20Minimal.approve,(router,0)));
        actualOut=IERC20Minimal(output).balanceOf(address(this))-previousOut;
        require(previousIn-IERC20Minimal(input).balanceOf(address(this))==s[8]&&actualOut>=s[9],"FILL");
        if(buy){cashAccounted-=s[8];assetAccounted+=actualOut;}else{assetAccounted-=s[8];cashAccounted+=actualOut;}
        emit Executed(batch,root,pendingPlan,actualOut);
    }
    function settle(Proof calldata p,uint[15] calldata s) external locked {
        require(pending&&s[0]==2&&s[4]==batch&&batch==settledCursor+1,"PHASE");
        require(plan(s)==pendingPlan&&s[11]==actualOut,"RECEIPT");
        require(s[12]==cashAccounted&&s[13]==assetAccounted,"ACCOUNTING");
        // No new deadline/risk check: already incurred losses must settle.
        check(p,s);root=s[6];settledCursor=batch;pending=false;
        pendingPlan=bytes32(0);actualOut=0;emit Settled(batch,root);
    }
}
