// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./PerplZkMvpAccount.sol";
interface ICohortVerifier {function verifyProof(uint256[2] calldata,uint256[2][2] calldata,uint256[2] calldata,uint256[13] calldata) external view returns(bool);}
interface IPoseidon6 {function poseidon(uint256[6] calldata) external pure returns(uint256);}

/// Same target circuit, but only the owning cohort vault may execute.
contract PerplCohortAccount is PerplMvpAccount {
    ITargetVerifier public immutable verifier;
    uint256 public activeX; uint256 public activeY;
    constructor(address exchange,address token,address operator,address owner,address targetVerifier,uint256[2] memory key)
      PerplMvpAccount(exchange,token,operator,owner,16,100) {require(targetVerifier.code.length>0,"VERIFIER");verifier=ITargetVerifier(targetVerifier);activeX=key[0];activeY=key[1];}
    function rotate(uint256[2] calldata key) external {
      require(msg.sender==beneficiary,"OWNER");
      require(key[0]<21888242871839275222246405745257275088548364400416034343698204186575808495617 && key[1]<21888242871839275222246405745257275088548364400416034343698204186575808495617,"KEY_RANGE");
      activeX=key[0];activeY=key[1];
    }
    function _authorize(int256 target,uint256 price,uint256 seq,uint256 deadline,bytes calldata proof) internal view override {
      require(msg.sender==beneficiary,"VAULT_ONLY");
      (uint256[2] memory a,uint256[2][2] memory b,uint256[2] memory c)=abi.decode(proof,(uint256[2],uint256[2][2],uint256[2]));
      (int256 actual,,)=position();
      uint256 p=21888242871839275222246405745257275088548364400416034343698204186575808495617;
      uint256[11] memory inputs=[block.chainid,uint256(uint160(address(this))),market,seq,target<0?p-uint256(-target):uint256(target),actual<0?p-uint256(-actual):uint256(actual),price,deadline,maxLots,activeX,activeY];
      require(verifier.verifyProof(a,b,c,inputs),"INVALID_PROOF");
    }
}

/// Terminal single-cohort MVP. Two investors subscribe at NAV=1 before trading.
/// Public dedicated account, no subscriptions during trading or rolling series.
contract PerplCohortVault {
    enum Phase {Funding,Live,Closing,Recovered,Settled}
    Phase public phase;
    ICollateral public immutable token;
    PerplCohortAccount public immutable account;
    ICohortVerifier public immutable ledgerVerifier;
    IPoseidon6 public immutable hasher;
    address public immutable controller;
    address public immutable operator;
    address public immutable feeRecipient;
    address[2] public investors;
    uint256[2] public deposits;
    uint256[2] public shares;
    uint256[2] public claims;
    bool[2] public withdrawalRequested;
    uint256 public immutable feeBps;
    uint256 public totalShares;
    uint256 public ledgerRoot;
    uint256 public recoveredAssets;
    uint256 public finalVenueNonce;
    uint256 public feeClaim;
    uint256 public keyEpoch;
    bool public paused;
    uint256 private entered;
    event Subscribed(uint256 indexed investor,uint256 amount,uint256 shares);
    event ClosingRequested(uint256 indexed investor);
    event Snapshot(uint256 indexed nonce,int256 actualQuantity,uint256 freeBalance);
    event AssetsRecovered(uint256 assets,uint256 venueNonce);
    event Settled(uint256 oldRoot,uint256 newRoot,uint256 assets,uint256 claim0,uint256 claim1,uint256 fee);
    event Claimed(address indexed owner,uint256 amount);
    modifier locked(){require(entered==0,"REENTRANT");entered=1;_;entered=0;}
    constructor(address exchange,address collateral,address controller_,address operator_,address[2] memory owners,address feeRecipient_,uint256 bps,address targetVerifier,address ledgerVerifier_,address poseidon,uint256[2] memory key){
      require(controller_!=address(0)&&operator_!=address(0)&&feeRecipient_!=address(0),"CONFIG");
      require(owners[0]!=address(0)&&owners[1]!=address(0)&&owners[0]!=owners[1]&&bps<=2000,"COHORT_CONFIG");
      require(ledgerVerifier_.code.length>0&&poseidon.code.length>0,"VERIFIER");
      token=ICollateral(collateral);controller=controller_;operator=operator_;investors=owners;feeRecipient=feeRecipient_;feeBps=bps;
      ledgerVerifier=ICohortVerifier(ledgerVerifier_);hasher=IPoseidon6(poseidon);
      account=new PerplCohortAccount(exchange,collateral,operator_,address(this),targetVerifier,key);
    }
    function subscribe(uint256 i,uint256 amount) external locked {
      require(!paused&&phase==Phase.Funding&&i<2&&msg.sender==investors[i],"SUBSCRIBE");
      require(amount>0&&totalShares+amount<2**64,"AMOUNT");
      uint256 beforeBal=token.balanceOf(address(this));require(token.transferFrom(msg.sender,address(this),amount),"TRANSFER");
      require(token.balanceOf(address(this))==beforeBal+amount,"EXACT_TOKEN");
      deposits[i]+=amount;shares[i]+=amount;totalShares+=amount;emit Subscribed(i,amount,amount);
    }
    function cancelSubscription(uint256 i) external locked {
      require(phase==Phase.Funding&&i<2&&msg.sender==investors[i]&&shares[i]>0,"CANCEL");
      uint256 amount=shares[i];totalShares-=amount;shares[i]=0;deposits[i]=0;
      require(token.transfer(msg.sender,amount),"TRANSFER");
    }
    function activate() external locked {
      require(msg.sender==controller&&!paused&&phase==Phase.Funding&&deposits[0]>0&&deposits[1]>0,"ACTIVATE");
      ledgerRoot=hasher.poseidon([uint256(2026100401),block.chainid,uint256(uint160(address(this))),deposits[0],deposits[1],totalShares]);
      phase=Phase.Live;
      require(token.approve(address(account),totalShares),"APPROVE");account.fund(totalShares);require(token.approve(address(account),0),"RESET");
    }
    function requestWithdrawal(uint256 i) external {
      require(i<2&&msg.sender==investors[i]&&(phase==Phase.Live||phase==Phase.Closing),"WITHDRAW_REQUEST");
      withdrawalRequested[i]=true;phase=Phase.Closing;emit ClosingRequested(i);
    }
    function beginClose() external {require(msg.sender==controller&&phase==Phase.Live,"CONTROLLER");phase=Phase.Closing;}
    function setPaused(bool value) external {require(msg.sender==controller,"CONTROLLER");paused=value;}
    function rotateKey(uint256[2] calldata key) external {
      require(msg.sender==controller&&(phase==Phase.Live||phase==Phase.Closing),"ROTATE");
      keyEpoch++;account.rotate(key);
    }
    function execute(int256 target,uint256 price,uint256 seq,uint256 deadline,bytes calldata proof) external locked {
      require(msg.sender==operator&&(phase==Phase.Live||phase==Phase.Closing),"OPERATOR");
      require((!paused&&phase==Phase.Live)||target==0,"REDUCE_ONLY");
      account.execute(target,price,seq,deadline,proof);
      (int256 qty,,)=account.position();
      emit Snapshot(seq,qty,account.venue().getAccountByAddr(address(account)).balanceCNS);
    }
    function recover() external locked {
      require(phase==Phase.Closing,"CLOSING");
      uint256 beforeBal=token.balanceOf(address(this));
      (int256 qty,,)=account.position();require(qty==0,"NOT_FLAT");
      IPerplMvp.Account memory va=account.venue().getAccountByAddr(address(account));
      require(va.lockedBalanceCNS==0&&account.venue().getOrderLocks(account.accountId()).length==0,"LOCKED");
      if(va.balanceCNS>0)account.recover(); // unavailable venue withdrawal reverts and remains Closing
      recoveredAssets=token.balanceOf(address(this))-beforeBal;
      require(recoveredAssets<2**64,"ASSET_RANGE");finalVenueNonce=account.nonce();phase=Phase.Recovered;
      emit AssetsRecovered(recoveredAssets,finalVenueNonce);
    }
    function settlementInputs(uint256 newRoot,uint256 c0,uint256 c1,uint256 fee) public view returns(uint256[13] memory){
      return [block.chainid,uint256(uint160(address(this))),ledgerRoot,newRoot,finalVenueNonce,deposits[0],deposits[1],recoveredAssets,feeBps,c0,c1,fee,totalShares];
    }
    function settle(uint256 newRoot,uint256 c0,uint256 c1,uint256 fee,bytes calldata proof) external locked {
      require(phase==Phase.Recovered,"RECOVERED");
      (uint256[2] memory a,uint256[2][2] memory b,uint256[2] memory c)=abi.decode(proof,(uint256[2],uint256[2][2],uint256[2]));
      require(ledgerVerifier.verifyProof(a,b,c,settlementInputs(newRoot,c0,c1,fee)),"LEDGER_PROOF");
      require(c0+c1+fee==recoveredAssets&&token.balanceOf(address(this))>=recoveredAssets,"SOLVENCY");
      emit Settled(ledgerRoot,newRoot,recoveredAssets,c0,c1,fee);
      ledgerRoot=newRoot;claims=[c0,c1];feeClaim=fee;shares=[uint256(0),uint256(0)];totalShares=0;phase=Phase.Settled;
    }
    function claim(uint256 i) external locked {
      require(phase==Phase.Settled&&i<2&&msg.sender==investors[i],"OWNER");
      uint256 amount=claims[i];require(amount>0,"NO_CLAIM");claims[i]=0;
      require(token.transfer(msg.sender,amount),"TRANSFER");emit Claimed(msg.sender,amount);
    }
    function claimFee() external locked {
      require(phase==Phase.Settled&&msg.sender==feeRecipient&&feeClaim>0,"FEE");
      uint256 amount=feeClaim;feeClaim=0;require(token.transfer(msg.sender,amount),"TRANSFER");emit Claimed(msg.sender,amount);
    }
}
