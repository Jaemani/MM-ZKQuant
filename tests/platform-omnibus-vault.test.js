import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { createLocalPilotChain } from '../src/pilot/chain.js';

const tokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract TestCash {
  mapping(address=>uint256) public balanceOf;
  mapping(address=>mapping(address=>uint256)) public allowance;
  function mint(address to,uint256 amount) external { balanceOf[to]+=amount; }
  function approve(address spender,uint256 amount) external returns(bool){ allowance[msg.sender][spender]=amount; return true; }
  function transfer(address to,uint256 amount) external returns(bool){ require(balanceOf[msg.sender]>=amount); balanceOf[msg.sender]-=amount; balanceOf[to]+=amount; return true; }
  function transferFrom(address from,address to,uint256 amount) external returns(bool){ require(balanceOf[from]>=amount&&allowance[from][msg.sender]>=amount); allowance[from][msg.sender]-=amount; balanceOf[from]-=amount; balanceOf[to]+=amount; return true; }
}`;

const venueSource=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import 'contracts/perpl/PerplMvpAccount.sol';
contract TestPerpl {
  ICollateral public cash; uint256 public accountCount; uint256 public fillLimit=type(uint256).max;
  mapping(address=>uint256) public ids; mapping(uint256=>uint256) public balances;
  mapping(uint256=>mapping(uint256=>int256)) public quantities;
  constructor(address token){cash=ICollateral(token);}
  function setFillLimit(uint256 value) external {fillLimit=value;}
  function createAccount(uint256 amount) external returns(uint256){require(ids[msg.sender]==0&&amount>=100000000,'MIN_ACCOUNT');require(cash.transferFrom(msg.sender,address(this),amount),'TRANSFER');uint256 id=++accountCount;ids[msg.sender]=id;balances[id]=amount;return id;}
  function depositCollateral(uint256 amount) external {require(cash.transferFrom(msg.sender,address(this),amount),'TRANSFER');balances[ids[msg.sender]]+=amount;}
  function withdrawCollateral(uint256 amount) external {balances[ids[msg.sender]]-=amount;require(cash.transfer(msg.sender,amount),'TRANSFER');}
  function getAccountByAddr(address addr) external view returns(IPerplMvp.Account memory a){a.accountId=ids[addr];a.accountAddr=addr;a.balanceCNS=balances[a.accountId];}
  function getPositionV2(uint256 market,uint256 id) external view returns(IPerplMvp.Position memory p,uint256 mark,bool valid){int256 qty=quantities[id][market];p.accountId=id;p.positionType=qty<0?1:0;p.lotLNS=uint256(qty<0?-qty:qty);return(p,100000000,true);}
  function getOrderLocks(uint256) external pure returns(IPerplMvp.OrderLock[] memory){return new IPerplMvp.OrderLock[](0);}
  function execOrder(IPerplMvp.OrderDesc calldata d) external returns(uint256,uint256){uint256 filled=d.lotLNS<fillLimit?d.lotLNS:fillLimit;bool buy=d.orderType==0||d.orderType==3;quantities[ids[msg.sender]][d.perpId]+=buy?int256(filled):-int256(filled);return(d.perpId,d.orderDescId);}
}`;

let compiled;

function compile() {
  if(compiled)return compiled;
  const vaultSource = readFileSync('contracts/platform/PlatformOmnibusVault.sol', 'utf8');
  const sources = { 'TestCash.sol': { content: tokenSource },'TestPerpl.sol':{content:venueSource}, 'contracts/platform/PlatformOmnibusVault.sol': { content: vaultSource } };
  for(const path of ['contracts/platform/PlatformExecutionAccount.sol','contracts/platform/PlatformSharedExecutionAccount.sol','contracts/perpl/PerplMvpAccount.sol']) sources[path]={content:readFileSync(path,'utf8')};
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { viaIR:true, evmVersion:'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifact = value => ({ abi: value.abi, bytecode: `0x${value.evm.bytecode.object}` });
  return compiled={ TestCash: artifact(output.contracts['TestCash.sol'].TestCash),TestPerpl:artifact(output.contracts['TestPerpl.sol'].TestPerpl),PlatformSharedExecutionAccount:artifact(output.contracts['contracts/platform/PlatformSharedExecutionAccount.sol'].PlatformSharedExecutionAccount), PlatformOmnibusVault: artifact(output.contracts['contracts/platform/PlatformOmnibusVault.sol'].PlatformOmnibusVault) };
}

test('one omnibus vault accepts opaque deposits without a strategy id', async () => {
  const chain = await createLocalPilotChain(compile());
  const cash = await chain.deploy('cash', 'TestCash', []);
  const vault = await chain.deploy('vault', 'PlatformOmnibusVault', [cash.address, chain.accounts[0]]);
  const depositId = `0x${'11'.repeat(32)}`;
  await chain.tx('mint', cash, 'mint', [chain.accounts[1], 25_000_000n]);
  await chain.tx('approve', cash, 'approve', [vault.address, 25_000_000n], 1);
  const receipt = await chain.tx('deposit', vault, 'deposit', [25_000_000n, depositId], 1);
  assert.equal(receipt.logs.length, 1);
  assert.equal((await chain.read(cash, 'balanceOf', [vault.address]))[0], 25_000_000n);
  assert.equal((await chain.read(vault, 'used', [depositId]))[0], true);
  await assert.rejects(() => chain.tx('replay', vault, 'deposit', [1n, depositId], 1), /DEPOSIT/);
  assert.equal(vault.abi.some(item => item.type === 'function' && item.name === 'deposit' && item.inputs.some(input => /strategy/i.test(input.name))), false);
  await assert.rejects(()=>chain.tx('unauthorized withdraw',vault,'withdraw',[chain.accounts[1],1n,`0x${'22'.repeat(32)}`],1),/OPERATOR/);
  await chain.tx('withdraw',vault,'withdraw',[chain.accounts[1],25000000n,`0x${'22'.repeat(32)}`]);
  assert.equal((await chain.read(cash,'balanceOf',[vault.address]))[0],0n);
  assert.equal((await chain.read(vault,'executionAccountVersion',[]))[0],2n);
  await assert.rejects(()=>chain.tx('unauthorized shared creation',vault,'createSharedAccounts',[1n],1),/OPERATOR/);
  await chain.tx('create shared pool',vault,'createSharedAccounts',[1n]);
  assert.equal((await chain.read(vault,'accountCount',[]))[0],1n);
  const address=(await chain.read(vault,'accounts',[0n]))[0];
  assert.equal((await chain.read(vault,'slots',[address]))[0],true);
  chain.close();
});

test('one shared Perpl account executes different markets and preserves prior strategies fills',async()=>{
  const chain=await createLocalPilotChain(compile());
  try {
    const cash=await chain.deploy('cash','TestCash',[]),venue=await chain.deploy('venue','TestPerpl',[cash.address]);
    const account=await chain.deploy('shared','PlatformSharedExecutionAccount',[venue.address,cash.address,chain.accounts[0],chain.accounts[0]]);
    await chain.tx('mint',cash,'mint',[chain.accounts[0],200000000n]);
    await chain.tx('approve',cash,'approve',[account.address,100000000n]);await chain.tx('fund',account,'fund',[100000000n]);
    const deadline=BigInt(await chain.now())+300n,id=n=>`0x${n.toString(16).padStart(64,'0')}`;
    const order=(key,market,before,delta)=>[id(key),market,before,delta,100000000n,deadline,200n];
    await chain.tx('strategy a btc',account,'executeDelta',order(1,16n,0n,10n));
    await chain.tx('strategy a eth',account,'executeDelta',order(2,17n,0n,20n));
    await chain.tx('strategy b btc',account,'executeDelta',order(3,16n,10n,5n));
    assert.equal((await chain.read(venue,'accountCount',[]))[0],1n);
    assert.equal((await chain.read(account,'position',[16n]))[0],15n);assert.equal((await chain.read(account,'position',[17n]))[0],20n);
    await assert.rejects(()=>chain.tx('stale account target',account,'executeDelta',order(4,16n,10n,2n)),/POSITION_CHANGED/);
    await assert.rejects(()=>chain.tx('duplicate order',account,'executeDelta',order(3,16n,15n,5n)),/AUTH/);
    await assert.rejects(()=>chain.tx('unauthorized order',account,'executeDelta',order(5,16n,15n,5n),1),/AUTH/);
    await chain.tx('remove strategy a btc',account,'executeDelta',order(6,16n,15n,-10n));
    assert.equal((await chain.read(account,'position',[16n]))[0],5n);
    await chain.tx('partial fills',venue,'setFillLimit',[2n]);await chain.tx('strategy b partial',account,'executeDelta',order(7,16n,5n,5n));
    assert.equal((await chain.read(account,'position',[16n]))[0],7n);
    await chain.tx('topup approval',cash,'approve',[account.address,10000000n]);await chain.tx('topup',account,'fund',[10000000n]);
    assert.equal((await chain.read(venue,'accountCount',[]))[0],1n);assert.equal((await chain.read(account,'marketCount',[]))[0],2n);
    // This bridge uses only an existing vault's operator withdrawal permission.
    const vault=await chain.deploy('legacy custody','PlatformOmnibusVault',[cash.address,chain.accounts[0]]);
    const bridged=await chain.deploy('bridged shared','PlatformSharedExecutionAccount',[venue.address,cash.address,vault.address,chain.accounts[0]]);
    await chain.tx('mint vault',cash,'mint',[vault.address,100000000n]);
    await chain.tx('vault bridge transfer',vault,'withdraw',[bridged.address,100000000n,id(20)]);
    await assert.rejects(()=>chain.tx('unauthorized bridge admission',bridged,'fundFromBalance',[100000000n],1),/OPERATOR/);
    await chain.tx('admit bridge collateral',bridged,'fundFromBalance',[100000000n]);
    assert.equal((await chain.read(venue,'accountCount',[]))[0],2n);
    await chain.tx('recover bridge collateral',bridged,'recoverToVault',[100000000n]);
    assert.equal((await chain.read(cash,'balanceOf',[vault.address]))[0],100000000n);
    assert.equal((await chain.read(cash,'balanceOf',[chain.accounts[1]]))[0],0n);
  }finally{chain.close();}
});
