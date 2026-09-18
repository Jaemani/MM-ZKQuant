import { createBlock } from '@ethereumjs/block';
import { Mainnet, Hardfork, createCustomCommon } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';
import { Interface, concat } from 'ethers';

// Deterministic throwaway test accounts. These keys must never hold real funds.
const fixtureKeys = [new Uint8Array(32).fill(0x20), new Uint8Array(32).fill(0x21)];

/** Signed transactions against real EVM bytecode, entirely in memory. */
export async function createLocalRegistry(artifact) {
  const common = createCustomCommon({ chainId: 31337, name: 'mm-alpha-local' }, Mainnet, { hardfork: Hardfork.Shanghai });
  const vm = await createVM({ common });
  const iface = new Interface(artifact.abi);
  const addresses = fixtureKeys.map(createAddressFromPrivateKey);
  for (const address of addresses) {
    await vm.stateManager.putAccount(address, createAccount({ nonce: 0n, balance: 10n ** 20n }));
  }
  let blockNumber = 0n;
  let contractAddress;
  const makeBlock = () => createBlock({
    header: {
      number: blockNumber,
      timestamp: 1_800_000_000n + blockNumber,
      gasLimit: 30_000_000n,
      baseFeePerGas: 1n,
    },
  }, { common, skipConsensusFormatValidation: true });
  function assertSuccess(result) {
    if (!result.execResult.exceptionError) return;
    const data = bytesToHex(result.execResult.returnValue);
    let decoded;
    try { decoded = iface.parseError(data)?.name; } catch { /* EVM errors may have no ABI data. */ }
    throw new Error(`EVM reverted: ${decoded ?? result.execResult.exceptionError.error}`);
  }
  async function send({ data = '0x', to, senderIndex = 0, value = 0n }) {
    const account = await vm.stateManager.getAccount(addresses[senderIndex]);
    blockNumber += 1n;
    const block = makeBlock();
    const tx = createLegacyTx({
      nonce: account.nonce, gasLimit: 5_000_000n, gasPrice: 10n,
      ...(to ? { to: createAddressFromString(to) } : {}),
      data: hexToBytes(data), value,
    }, { common }).sign(fixtureKeys[senderIndex]);
    const result = await runTx(vm, { tx, block });
    assertSuccess(result);
    return {
      ...result,
      transactionHash: bytesToHex(tx.hash()),
      blockNumber: Number(blockNumber),
      logs: (result.execResult.logs ?? []).map(([address, topics, logData]) => ({
        address: bytesToHex(address), topics: topics.map(bytesToHex), data: bytesToHex(logData),
      })),
    };
  }
  return {
    publisher: addresses[0].toString(),
    outsider: addresses[1].toString(),
    iface,
    get address() { return contractAddress; },
    async deploy(publisher = addresses[0].toString()) {
      const result = await send({ data: concat([artifact.bytecode, iface.encodeDeploy([publisher])]) });
      contractAddress = result.createdAddress.toString();
      return result;
    },
    async transact(method, args, senderIndex = 0) {
      if (!contractAddress) throw new Error('Deploy the registry first.');
      return send({ to: contractAddress, data: iface.encodeFunctionData(method, args), senderIndex });
    },
    async sendValue(value) {
      return send({ to: contractAddress, value });
    },
    async read(method, args = []) {
      if (!contractAddress) throw new Error('Deploy the registry first.');
      await vm.stateManager.checkpoint();
      try {
        const result = await vm.evm.runCall({
          to: createAddressFromString(contractAddress),
          caller: addresses[0],
          data: hexToBytes(iface.encodeFunctionData(method, args)),
          gasLimit: 5_000_000n,
          isStatic: true,
          block: makeBlock(),
        });
        assertSuccess(result);
        return iface.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue));
      } finally {
        await vm.stateManager.revert();
      }
    },
  };
}
