import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptForJournalTransaction } from '../src/pilot/chain.js';

test('journal recovery broadcasts identical bytes without querying the unreliable missing-transaction index',async()=>{
  const row={raw:'signed-bytes',transactionHash:'expected-hash'},receipt={status:1,blockNumber:10};let sends=0,reads=0;
  const lookup=async hash=>{assert.equal(hash,row.transactionHash);if(reads++===0)throw Object.assign(new Error(),{error:{message:'Internal error: Archive error: Error getting index data'}});return receipt;};
  const rpc={getTransactionReceipt:lookup,getBlockNumber:async()=>11,getTransaction:async()=>{throw new Error('Archive error: Error getting index data');},
    broadcastTransaction:async raw=>{assert.equal(raw,row.raw);sends++;}};
  assert.equal(await receiptForJournalTransaction(rpc,row,{pollMs:1}),receipt);assert.equal(sends,1);
  reads=0;
  rpc.broadcastTransaction=async()=>{throw Object.assign(new Error(),{error:{message:'already known'}});};
  assert.equal(await receiptForJournalTransaction(rpc,row,{pollMs:1}),receipt);
  rpc.broadcastTransaction=async()=>{throw Object.assign(new Error(),{code:'NONCE_EXPIRED'});};
  rpc.getTransactionReceipt=async()=>null;assert.equal(await receiptForJournalTransaction(rpc,row,{timeoutMs:0}),null);
  rpc.broadcastTransaction=async()=>{throw new Error('invalid signature');};
  await assert.rejects(()=>receiptForJournalTransaction(rpc,row),/invalid signature/);
  rpc.getTransactionReceipt=async()=>receipt;
  let heads=0;rpc.getBlockNumber=async()=>10+heads++;
  assert.equal(await receiptForJournalTransaction(rpc,row,{pollMs:1}),receipt);assert.equal(heads,2);
});
