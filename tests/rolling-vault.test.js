import assert from 'node:assert/strict';
import { test } from 'node:test';
import solc from 'solc';
import { createBlock } from '@ethereumjs/block';
import { Mainnet, Hardfork, createCustomCommon } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';
import { Interface, concat } from 'ethers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mockErc20Source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockToken {
    string public name = "Test AUSD";
    string public symbol = "AUSD";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BAL");
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "ALLOW");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}
`;

async function compileBoth() {
  const vaultSource = await readFile(resolve('contracts/platform/RollingStrategyVault.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'MockToken.sol': { content: mockErc20Source },
      'RollingStrategyVault.sol': { content: vaultSource }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return {
    token: output.contracts['MockToken.sol']['MockToken'],
    vault: output.contracts['RollingStrategyVault.sol']['RollingStrategyVault']
  };
}

test('RollingStrategyVault: multi-investor deposits, rolling epochs, NAV minting, and HWM settlements', async t => {
  const compiled = await compileBoth();
  const tokenAbi = compiled.token.abi;
  const tokenBytecode = `0x${compiled.token.evm.bytecode.object}`;
  const vaultAbi = compiled.vault.abi;
  const vaultBytecode = `0x${compiled.vault.evm.bytecode.object}`;

  const tokenIface = new Interface(tokenAbi);
  const vaultIface = new Interface(vaultAbi);

  // Setup local EVM environment
  const common = createCustomCommon({ chainId: 10143, name: 'monad-testnet-sim' }, Mainnet, { hardfork: Hardfork.Shanghai });
  const vm = await createVM({ common });

  // 4 keys: 0: Operator/Deployer, 1: Investor1, 2: Investor2, 3: FeeRecipient
  const keys = [
    new Uint8Array(32).fill(0x10),
    new Uint8Array(32).fill(0x11),
    new Uint8Array(32).fill(0x12),
    new Uint8Array(32).fill(0x13)
  ];
  const addresses = keys.map(createAddressFromPrivateKey);
  for (const addr of addresses) {
    await vm.stateManager.putAccount(addr, createAccount({ nonce: 0n, balance: 10n ** 20n }));
  }

  let blockNumber = 1n;
  let timestamp = 1_800_000_000n;

  async function sendTx({ to, data = '0x', senderIndex = 0 }) {
    const sender = addresses[senderIndex];
    const account = await vm.stateManager.getAccount(sender);
    blockNumber += 1n;
    timestamp += 60n;
    const block = createBlock({
      header: { number: blockNumber, timestamp, gasLimit: 30_000_000n, baseFeePerGas: 1n }
    }, { common, skipConsensusFormatValidation: true });

    const tx = createLegacyTx({
      nonce: account.nonce,
      gasLimit: 6_000_000n,
      gasPrice: 10n,
      ...(to ? { to: createAddressFromString(to) } : {}),
      data: hexToBytes(data)
    }, { common }).sign(keys[senderIndex]);

    const result = await runTx(vm, { tx, block });
    if (result.execResult.exceptionError) {
      const errBytes = bytesToHex(result.execResult.returnValue);
      let parsed = errBytes;
      try { parsed = vaultIface.parseError(errBytes)?.name || errBytes; } catch {}
      throw new Error(`Tx failed: ${parsed} (${result.execResult.exceptionError.error})`);
    }
    return result;
  }

  async function callRead({ to, data }) {
    const block = createBlock({
      header: { number: blockNumber, timestamp, gasLimit: 30_000_000n, baseFeePerGas: 1n }
    }, { common, skipConsensusFormatValidation: true });
    const account = await vm.stateManager.getAccount(addresses[0]);
    const tx = createLegacyTx({
      nonce: account.nonce, gasLimit: 6_000_000n, gasPrice: 10n,
      to: createAddressFromString(to),
      data: hexToBytes(data)
    }, { common }).sign(keys[0]);
    const result = await runTx(vm, { tx, block, skipBalance: true, skipNonce: true });
    return bytesToHex(result.execResult.returnValue);
  }

  // 1. Deploy Token
  const deployToken = await sendTx({ data: tokenBytecode, senderIndex: 0 });
  const tokenAddress = deployToken.createdAddress.toString();

  // 2. Deploy Vault
  // constructor(token, strategist, operator, feeRecipient, feeBps)
  const deployVaultData = concat([
    vaultBytecode,
    vaultIface.encodeDeploy([
      tokenAddress,
      addresses[0].toString(), // strategist
      addresses[0].toString(), // operator
      addresses[3].toString(), // feeRecipient
      2000 // 20%
    ])
  ]);
  const deployVault = await sendTx({ data: deployVaultData, senderIndex: 0 });
  const vaultAddress = deployVault.createdAddress.toString();

  // 3. Mint AUSD to Investor1 and Investor2
  await sendTx({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('mint', [addresses[1].toString(), 100_000_000n]), // 100 AUSD
    senderIndex: 0
  });
  await sendTx({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('mint', [addresses[2].toString(), 200_000_000n]), // 200 AUSD
    senderIndex: 0
  });

  // 4. Approve vault
  await sendTx({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('approve', [vaultAddress, 100_000_000n]),
    senderIndex: 1
  });
  await sendTx({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('approve', [vaultAddress, 200_000_000n]),
    senderIndex: 2
  });

  // 5. Investors deposit
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('deposit', [100_000_000n]),
    senderIndex: 1
  });
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('deposit', [200_000_000n]),
    senderIndex: 2
  });

  // Check pending deposits
  const dep1 = vaultIface.decodeFunctionResult('pendingDeposits', await callRead({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('pendingDeposits', [addresses[1].toString()])
  }))[0];
  assert.equal(dep1, 100_000_000n);

  // 6. Operator opens epoch 1 (minting shares at initial NAV 1.0)
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('openEpoch', [3600]),
    senderIndex: 0
  });

  // Check minted shares
  const shares1 = vaultIface.decodeFunctionResult('sharesOf', await callRead({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('sharesOf', [addresses[1].toString()])
  }))[0];
  const shares2 = vaultIface.decodeFunctionResult('sharesOf', await callRead({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('sharesOf', [addresses[2].toString()])
  }))[0];
  assert.equal(shares1, 100_000_000n);
  assert.equal(shares2, 200_000_000n);

  // 7. Commit interim NAV mark & record execution
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('commitNav', [1_050_000n, 12345n]),
    senderIndex: 0
  });
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('recordExecution', [
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      10n
    ]),
    senderIndex: 0
  });

  // 8. Investor 1 requests redemption of 50 shares
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('requestRedeem', [50_000_000n]),
    senderIndex: 1
  });

  // Simulate strategy profit: vault assets increase from 300 AUSD to 330 AUSD (+10% gain)
  await sendTx({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('mint', [vaultAddress, 30_000_000n]),
    senderIndex: 0
  });

  // 9. Close and settle epoch 1
  // Total assets = 330 AUSD, total shares = 250 (300 - 50 redeemed).
  // Performance fee will be calculated on gain above HWM (1.0).
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('closeAndSettleEpoch', [330_000_000n, 3600]),
    senderIndex: 0
  });

  // Check investor 1 claimable amount
  const claim1 = vaultIface.decodeFunctionResult('claimableAmounts', await callRead({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('claimableAmounts', [addresses[1].toString()])
  }))[0];
  assert.ok(claim1 > 50_000_000n, 'Investor 1 should receive > 50 AUSD due to profitable epoch');

  // 10. Investor 1 claims redemption
  await sendTx({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('claimRedemption', []),
    senderIndex: 1
  });

  const finalBal1 = tokenIface.decodeFunctionResult('balanceOf', await callRead({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('balanceOf', [addresses[1].toString()])
  }))[0];
  assert.equal(finalBal1, claim1);

  // Check that fee recipient received performance fee
  const feeBal = tokenIface.decodeFunctionResult('balanceOf', await callRead({
    to: tokenAddress,
    data: tokenIface.encodeFunctionData('balanceOf', [addresses[3].toString()])
  }))[0];
  assert.ok(feeBal > 0n, 'Fee recipient must receive performance fee on profitable round');

  // Check epoch 2 is open for funding
  const epoch2 = vaultIface.decodeFunctionResult('epochs', await callRead({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData('epochs', [2n])
  }));
  assert.equal(epoch2[0], 2n); // sequence 2
  assert.equal(epoch2[1], 0n); // EpochStatus.Funding
});
