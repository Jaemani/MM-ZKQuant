import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { Contract, ContractFactory, Interface, JsonRpcProvider, Wallet, Transaction, concat, getCreateAddress, keccak256 } from 'ethers';
import { createBlock } from '@ethereumjs/block';
import { Mainnet, Hardfork, createCustomCommon } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';
import { digest } from './policy.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
export function compilePilot() {
  const source = readFileSync(join(project, 'contracts/pilot/PilotFund.sol'), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'PilotFund.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = output.errors?.filter(e => e.severity === 'error') || [];
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return Object.fromEntries(Object.entries(output.contracts['PilotFund.sol']).map(([name, a]) => [name,
    { abi: a.abi, bytecode: '0x' + a.evm.bytecode.object, compiler: solc.version(), sourceHash: digest(source) }]));
}
export function atomicJson(path, value) {
  // Synchronous state write before an RPC send; the OS is asked to flush it.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.pending';
  writeFileSync(temporary, JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n', { mode: 0o600, flush: true });
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
export async function receiptForJournalTransaction(rpc,row,{timeoutMs=60000,pollMs=1000}={}) {
  const lookup=async()=>{
    try {return await rpc.getTransactionReceipt(row.transactionHash);}
    catch(error) {
      const message=error.error?.message||error.info?.error?.message||'';
      if(/Archive error: Error getting index data/.test(message))return null;
      throw error;
    }
  };
  let receipt=await lookup();
  // Some public Monad nodes return an archive/index error, not null, for
  // eth_getTransactionByHash on a transaction not yet broadcast. Rebroadcast
  // the identical signed bytes; never construct a replacement nonce here.
  try {if(!receipt)await rpc.broadcastTransaction(row.raw);}
  catch(error) {
    const message=error.error?.message||error.info?.error?.message||error.shortMessage||'';
    if(error.code!=='NONCE_EXPIRED'&&!/already known|known transaction|already imported|nonce too low/i.test(message))throw error;
  }
  // "Already known"/"nonce too low" is not success: only this exact hash's
  // receipt may satisfy the journal entry.
  const deadline=Date.now()+timeoutMs;
  do {
    if(receipt&&(receipt.status===0||await rpc.getBlockNumber()>=receipt.blockNumber+1))return receipt;
    if(Date.now()>=deadline)return null;
    await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,deadline-Date.now())));
    receipt=await lookup();
  } while(true);
}
export async function createLocalPilotChain(artifacts, { startAt = 1800000000 } = {}) {
  const common = createCustomCommon({ chainId: 31337, name: 'mm-pilot-test' }, Mainnet, { hardfork: Hardfork.Shanghai });
  const vm = await createVM({ common });
  const keys = Array.from({ length: 6 }, (_, i) => new Uint8Array(32).fill(0x51 + i));
  const addresses = keys.map(createAddressFromPrivateKey);
  for (const a of addresses) await vm.stateManager.putAccount(a, createAccount({ nonce: 0n, balance: 10n ** 24n }));
  let number = 0n, timestamp = startAt, readQueue = Promise.resolve();
  const transactions = [], done = new Map(), handles = new Map();
  const block = () => createBlock({ header: { number, timestamp: BigInt(timestamp), gasLimit: 30000000n, baseFeePerGas: 1n } }, { common, skipConsensusFormatValidation: true });
  function success(result, iface) {
    if (!result.execResult.exceptionError) return;
    let reason;
    try { reason = iface.parseError(bytesToHex(result.execResult.returnValue)); } catch {}
    throw new Error('EVM revert: ' + (reason?.args?.[0] || reason?.name || result.execResult.exceptionError.error));
  }
  async function send(tag, handle, data, account = 0) {
    const intent = digest({ address: handle?.address || null, data, account });
    if (done.has(tag)) { const prev = done.get(tag); if (prev.intent !== intent) throw new Error('Transaction tag reused with different intent'); return prev; }
    number++;
    const sender = await vm.stateManager.getAccount(addresses[account]);
    const tx = createLegacyTx({ nonce: sender.nonce, gasLimit: 15000000n, gasPrice: 10n,
      ...(handle?.address ? { to: createAddressFromString(handle.address) } : {}), data: hexToBytes(data) }, { common }).sign(keys[account]);
    const result = await runTx(vm, { tx, block: block() });
    success(result, new Interface(handle?.abi || []));
    const row = { tag, intent, transactionHash: bytesToHex(tx.hash()), blockNumber: Number(number), blockTimestamp: timestamp,
      status: 1, environment: 'LOCAL_EVM', sender: addresses[account].toString(),
      gasUsed:String(result.totalGasSpent),gasPriceWei:'10',nativeGasCostWei:String(result.totalGasSpent*10n),
      contractAddress: result.createdAddress?.toString() || null,
      logs: result.execResult.logs.map(([address, topics, data]) => ({ address: bytesToHex(address), topics: topics.map(bytesToHex), data: bytesToHex(data) })) };
    done.set(tag, row); transactions.push(row); return row;
  }
  return { environment: 'LOCAL_EVM', chainId: 31337, transactions, accounts: addresses.map(a => a.toString()),
    resume: async tag => done.get(tag),
    now: async () => timestamp,
    advanceTo(time) { if (time < timestamp) throw new Error('Clock cannot go backwards'); timestamp = time; },
    async deploy(tag, type, args) {
      if (handles.has(tag)) return handles.get(tag);
      const a = artifacts[type], iface = new Interface(a.abi);
      const result = await send(tag, { abi: a.abi }, concat([a.bytecode, iface.encodeDeploy(args)]));
      const handle = { address: result.contractAddress, abi: a.abi, type, deployment: result };
      handles.set(tag, handle); return handle;
    },
    tx: (tag, h, method, args = [], account = 0) => send(tag, h, new Interface(h.abi).encodeFunctionData(method, args), account),
    async read(h, method, args = []) {
      // EthereumJS shares transient execution state and a checkpoint stack.
      // Concurrent eth_call-like reads must never interleave that stack.
      const pending=readQueue.then(async()=>{
        const iface = new Interface(h.abi); await vm.stateManager.checkpoint();
        try {
          const result = await vm.evm.runCall({ to: createAddressFromString(h.address), caller: addresses[0],
            data: hexToBytes(iface.encodeFunctionData(method, args)), gasLimit: 15000000n, isStatic: true, block: block() });
          success(result, iface); return iface.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue));
        } finally { await vm.stateManager.revert(); }
      });
      readQueue=pending.catch(()=>{});return pending;
    },
    async codeHash(h) { return keccak256(await vm.stateManager.getCode(createAddressFromString(h.address))); },
    close() {},
  };
}
export async function createRpcPilotChain(artifacts, config, directory) {
  if(!/^0x[0-9a-fA-F]{64}$/.test(config.privateKey||''))throw new Error('Invalid testnet key configuration');
  const rpc = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
  const network = await rpc.getNetwork();
  if (network.chainId !== 10143n) { rpc.destroy(); throw new Error('Only Monad testnet 10143 is allowed'); }
  const wallet = new Wallet(config.privateKey, rpc);
  const journalPath = join(directory, 'transactions.json');
  const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath)) : {};
  const transactions = [];
  async function send(tag, h, data) {
    const intent = digest({ address: h?.address || null, data, account: wallet.address });
    let row = journal[tag];
    if (row && row.intent !== intent) throw new Error(`Different intent for persisted transaction ${tag}`);
    if (!row) {
      const nonce = await rpc.getTransactionCount(wallet.address, 'pending');
      const request = await wallet.populateTransaction({ to: h?.address, data, nonce });
      const raw = await wallet.signTransaction(request);
      row = journal[tag] = { tag, intent, raw, transactionHash: keccak256(raw),
        contractAddress: h?.address ? null : getCreateAddress({ from: wallet.address, nonce }), sender: wallet.address,
        environment: 'MONAD_TESTNET', status: 'PREPARED' };
      atomicJson(journalPath, journal);
    }
    const receipt = await receiptForJournalTransaction(rpc,row);
    if (!receipt) throw new Error(`Transaction pending: ${row.transactionHash}; resume with the same journal`);
    if (receipt.status !== 1) throw new Error(`Transaction reverted: ${row.transactionHash}`);
    const b = await rpc.getBlock(receipt.blockNumber);
    Object.assign(row, { status: 1, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, blockTimestamp: b.timestamp,
      gasUsed:String(receipt.gasUsed),gasPriceWei:String(receipt.gasPrice),nativeGasCostWei:String(receipt.gasUsed*receipt.gasPrice),
      logs: receipt.logs.map(l => ({ address: l.address, topics: [...l.topics], data: l.data })) });
    // Two confirmations are a policy; finality is additionally required via the
    // RPC finalized tag before accepting an anchor as prior external evidence.
    atomicJson(journalPath, journal);
    const { raw, ...publicRow } = row; transactions.push(publicRow); return publicRow;
  }
  return { environment: 'MONAD_TESTNET', chainId: 10143, transactions, accounts: [wallet.address], rpc,
    async resume(tag) {const row=journal[tag];if(!row)return undefined;const tx=Transaction.from(row.raw);return send(tag,{address:tx.to},tx.data);},
    now: async () => (await rpc.getBlock('latest')).timestamp,
    async deploy(tag, type, args) {
      const a = artifacts[type], data = new ContractFactory(a.abi, a.bytecode).getDeployTransaction(...args);
      const result = await send(tag, { abi: a.abi }, (await data).data);
      return { address: result.contractAddress, abi: a.abi, type, deployment: result };
    },
    async tx(tag, h, method, args = [], account = 0) {
      if (account !== 0) throw new Error('External signer must submit their own transactions');
      return send(tag, h, new Interface(h.abi).encodeFunctionData(method, args));
    },
    async read(h, method, args = []) { const c = new Contract(h.address, h.abi, rpc); return c.getFunction(method).staticCallResult(...args); },
    async codeHash(h) { return keccak256(await rpc.getCode(h.address)); },
    async assertFinalized(tx) {
      const b = await rpc.getBlock('finalized');
      if (!b || b.number < tx.blockNumber) throw new Error('Anchor has not reached RPC finalized head');
      const original = await rpc.getBlock(tx.blockNumber);
      if (original.hash !== tx.blockHash) throw new Error('Anchor was reorganized');
      return { finalizedHead: b.number, finalizedHash: b.hash, anchorHash: original.hash };
    },
    close() { rpc.destroy(); },
  };
}
