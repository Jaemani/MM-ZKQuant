import { readFileSync } from 'node:fs';
import { JsonRpcProvider,keccak256,Interface,Contract } from 'ethers';
import assert from 'node:assert/strict';
import { compileOmnibus } from '../src/sleeves/chain.js';
import { atomicJson } from '../src/pilot/chain.js';
const report=JSON.parse(readFileSync('docs/evidence/omnibus-testnet.json'));
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{cacheTimeout:-1});
const pause=()=>new Promise(r=>setTimeout(r,250));
try{
  assert.equal((await rpc.getNetwork()).chainId,10143n);const artifacts=compileOmnibus();
  assert.equal(report.sourceHash,artifacts.OmnibusVault.sourceHash);
  const deployed=await rpc.getCode(report.vault);assert.equal(keccak256(deployed),report.codeHash);
  const mask=hex=>{const chars=hex.slice(2).split('');for(const refs of Object.values(artifacts.OmnibusVault.immutableReferences))for(const ref of refs)chars.fill('0',ref.start*2,(ref.start+ref.length)*2);return chars.join('');};
  assert.equal(mask(deployed),mask(artifacts.OmnibusVault.runtimeBytecode),'Deployed code differs from compiled source');
  const finalized=await rpc.getBlock('finalized'),iface=new Interface(artifacts.OmnibusVault.abi),hashes=[];
  for(const operation of report.transactions){
    for(const recorded of [operation.anchor,operation.receipt].filter(Boolean)){
      await pause();const actual=await rpc.getTransactionReceipt(recorded.transactionHash);
      assert.equal(actual.status,1);assert.equal(actual.blockHash,recorded.blockHash);assert.ok(actual.blockNumber<=finalized.number);
      assert.equal(actual.to.toLowerCase(),report.vault.toLowerCase());
      assert.deepEqual(actual.logs.map(l=>({address:l.address.toLowerCase(),topics:[...l.topics],data:l.data})),recorded.logs.map(l=>({...l,address:l.address.toLowerCase()})));
      hashes.push(actual.hash);
    }
    const events=operation.receipt.logs.filter(l=>l.address.toLowerCase()===report.vault.toLowerCase()).map(l=>iface.parseLog(l));
    assert.ok(events.some(e=>e.name===({ALLOCATE:'Deposit',REDEEM:'Withdrawal',PAY_PROVIDER:'Withdrawal',ORDER:'Fill'}[operation.type])));
    if(operation.anchor)assert.ok(operation.receipt.blockNumber>operation.anchor.blockNumber);
  }
  const cash=new Contract(report.cash,artifacts.SleeveToken.abi,rpc);await pause();assert.equal(String(await cash.balanceOf(report.vault)),report.finalReconciliation.vaultEquity);
  const result={verdict:'RPC_REVERIFICATION_PASS',chainId:10143,vault:report.vault,confirmedTransactions:hashes.length,finalizedHead:finalized.number,verifiedAt:new Date().toISOString(),sourceHash:report.sourceHash,transactionHashes:hashes,scope:'Independently fetched receipts, block hashes, finalized head, compiled runtime bytecode (immutable slots masked), bytecode hash and current final cash; private attribution still trusts the operator without TEE.'};
  atomicJson('docs/evidence/omnibus-rpc-verification.json',result);console.log(JSON.stringify(result));
}finally{rpc.destroy();}
