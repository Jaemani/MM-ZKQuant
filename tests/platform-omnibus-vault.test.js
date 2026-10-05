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

function compile() {
  const vaultSource = readFileSync('contracts/platform/PlatformOmnibusVault.sol', 'utf8');
  const sources = { 'TestCash.sol': { content: tokenSource }, 'contracts/platform/PlatformOmnibusVault.sol': { content: vaultSource } };
  for(const path of ['contracts/platform/PlatformExecutionAccount.sol','contracts/perpl/PerplMvpAccount.sol']) sources[path]={content:readFileSync(path,'utf8')};
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { viaIR:true, evmVersion:'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifact = value => ({ abi: value.abi, bytecode: `0x${value.evm.bytecode.object}` });
  return { TestCash: artifact(output.contracts['TestCash.sol'].TestCash), PlatformOmnibusVault: artifact(output.contracts['contracts/platform/PlatformOmnibusVault.sol'].PlatformOmnibusVault) };
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
  chain.close();
});
