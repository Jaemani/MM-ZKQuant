import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface, Wallet, getAddress, hexlify, randomBytes } from 'ethers';
import { PrivateInvestments } from '../deploy/tee/operator/investments.mjs';
import { investmentMessage } from '../src/platform/investment-message.js';

const vaultAddress = '0x1111111111111111111111111111111111111111';
const tokenAddress = '0x2222222222222222222222222222222222222222';
const operator = '0x3333333333333333333333333333333333333333';
const strategyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const events = new Interface(['event Deposit(bytes32 indexed id,address indexed investor,uint256 amount)']);

async function signed(wallet, action, values = {}) {
  const payload = { action, wallet: wallet.address, strategyId: null, amount: null, depositId: null, txHash: null, nonce: hexlify(randomBytes(32)), ...values };
  return { ...payload, signature: await wallet.signMessage(investmentMessage(payload)) };
}

test('strategy selection and units remain in the sealed TEE investment store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmq-private-investments-'));
  const wallet = Wallet.createRandom();
  const transactionHash = hexlify(randomBytes(32));
  let depositId;
  const provider = {
    getTransactionReceipt: async hash => {
      assert.equal(hash, transactionHash);
      const encoded = events.encodeEventLog(events.getEvent('Deposit'), [depositId, wallet.address, 10_000_000n]);
      return { status: 1, blockNumber: 42, logs: [{ address: vaultAddress, topics: encoded.topics, data: encoded.data }] };
    },
    getTransaction: async () => ({ from: wallet.address, to: vaultAddress })
  };
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ strategies: [{ id: strategyId, status: 'FUNDING',strategist_wallet:wallet.address,fee_bps:2000 }] }) });
  try {
    const investments = new PrivateInvestments({ secret: randomBytes(32), storeDir: directory, provider, operator, accessHash: null, catalogUrl: 'https://catalog.invalid' });
    investments.store.write({ version: 1, config: { vaultAddress: getAddress(vaultAddress), cashTokenAddress: getAddress(tokenAddress) }, usedNonces: {}, intents: {}, units: {} });
    const prepared = await investments.prepare(await signed(wallet, 'PREPARE', { strategyId, amount: '10000000' }));
    depositId = prepared.depositId;
    assert.deepEqual(Object.keys(investments.state().intents), [depositId]);
    assert.equal(investments.state().intents[depositId].strategyId, strategyId);

    const completed = await investments.complete(await signed(wallet, 'COMPLETE', { depositId, txHash: transactionHash }));
    assert.equal(completed.status, 'CONFIRMED');
    assert.equal(completed.units, '0');
    assert.equal(completed.pending, '10000000');

    const portfolio = await investments.portfolio(await signed(wallet, 'PORTFOLIO'));
    assert.equal(portfolio.positions[0].strategyId,strategyId);
    assert.equal(portfolio.positions[0].units,'0');
    assert.equal(portfolio.positions[0].pending,'10000000');
    assert.equal(portfolio.positions[0].value,'0');
    assert.equal(portfolio.deposits[0].txHash, transactionHash);
    const invalidView = { ...(await signed(wallet, 'PORTFOLIO')), signature: '0x00' };
    await assert.rejects(() => investments.portfolio(invalidView), /INVALID_SIGNATURE/);
  } finally {
    globalThis.fetch = priorFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('vault transition preserves history and refuses to redirect investors with existing funds',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mmq-vault-transition-'));
  const next='0x4444444444444444444444444444444444444444';let paused=false;
  const contract=address=>address===tokenAddress?{balanceOf:async()=>0n}:{operator:async()=>operator,cash:async()=>tokenAddress,paused:async()=>paused,accountCount:async()=>0n};
  const investments=new PrivateInvestments({secret:randomBytes(32),storeDir:directory,provider:{getBlockNumber:async()=>42},operator,accessHash:null,catalogUrl:'https://catalog.invalid',contract});
  const state={version:2,config:{vaultAddress,cashTokenAddress:tokenAddress},books:{s:{cash:'0',equity:'0',feesDue:'0',totalUnits:'1',slots:{16:'old'},investors:{alice:{pending:'0',units:'1',paid:'100'}},withdrawals:{},requests:{},marks:[{time:0,nav:'100'}]}},intents:{old:{status:'PREPARED'}},usedNonces:{},units:{}};
  try {
    investments.store.write(state);await assert.rejects(()=>investments.pin({vaultAddress:next,cashTokenAddress:tokenAddress}),/ACTIVE_INVESTMENTS/);
    assert.equal(investments.state().config.vaultAddress,vaultAddress);
    state.books.s.totalUnits='0';state.books.s.investors.alice.units='0';investments.store.write(state);
    await assert.rejects(()=>investments.pin({vaultAddress:next,cashTokenAddress:tokenAddress}),/MUST_BE_PAUSED/);
    paused=true;await investments.pin({vaultAddress:next,cashTokenAddress:tokenAddress});
    const migrated=investments.state();assert.equal(migrated.config.vaultAddress,next);assert.deepEqual(migrated.books.s.slots,{});
    assert.equal(migrated.books.s.investors.alice.paid,'100');assert.deepEqual(migrated.books.s.marks,state.books.s.marks);assert.equal(migrated.intents.old.status,'RETIRED');
    assert.equal(migrated.retiredVaults[0].vaultAddress,vaultAddress);
  }finally{await rm(directory,{recursive:true,force:true});}
});
