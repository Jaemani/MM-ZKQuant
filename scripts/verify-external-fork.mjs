import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Contract, JsonRpcProvider, Interface, keccak256, verifyTypedData } from 'ethers';
import { compileApprovedVault, domain, TYPES, approvalDigest, nextCheckpoint } from '../src/integration/protocol.js';
import { INITIAL_CHECKPOINT } from '../src/integration/coordinator.js';

const evidence=JSON.parse(readFileSync('docs/evidence/external-fork.json'));
assert.equal(evidence.mode,'MONAD_MAINNET_FORK');assert.equal(evidence.hardwareTEE,false);assert.equal(evidence.externalNetworkBroadcast,false);
const rpc=new JsonRpcProvider(process.env.MM_FORK_RPC||'http://127.0.0.1:18545',undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
  const info=await rpc.send('anvil_nodeInfo',[]);assert.equal(info.forkConfig.forkBlockNumber,evidence.forkBlock);
  assert.equal((await rpc.getBlock(evidence.forkBlock)).hash,evidence.forkBlockHash);
  const artifact=compileApprovedVault(),iface=new Interface(artifact.abi),vault=new Contract(evidence.vault,artifact.abi,rpc);
  assert.equal(artifact.sourceHash,evidence.contractSourceHash);assert.equal(keccak256(await rpc.getCode(evidence.vault)),evidence.vaultCodeHash);
  for(const value of Object.values(evidence.contractCodeHashes))assert.equal(keccak256(await rpc.getCode(value.address)),value.codeHash);
  assert.equal(await vault.signer(),evidence.signer);assert.equal(await vault.policyHash(),evidence.policyHash);
  let previous=INITIAL_CHECKPOINT,sequence=0;
  for(const row of evidence.trace){
    const receipt=await rpc.getTransactionReceipt(row.transactionHash),tx=await rpc.getTransaction(row.transactionHash);
    assert.equal(receipt.status,1);assert.equal(receipt.blockHash,(await rpc.getBlock(receipt.blockNumber)).hash);assert.equal(tx.to,evidence.vault);
    const parsed=iface.parseTransaction({data:tx.data,value:tx.value});assert.equal(parsed.name,'executeApproved');
    const a=Object.fromEntries(TYPES.Approval.map(f=>[f.name,parsed.args[0][f.name]]));
    const context={chainId:31337,vault:evidence.vault,policyHash:evidence.policyHash};
    assert.equal(verifyTypedData(domain(31337,evidence.vault,evidence.policyHash),TYPES,a,parsed.args[1]),evidence.signer);
    const events=receipt.logs.filter(l=>l.address.toLowerCase()===evidence.vault.toLowerCase()).map(l=>iface.parseLog(l)).filter(e=>e.name==='Applied');assert.equal(events.length,1);
    const e=events[0];assert.equal(Number(a.sequence),++sequence);assert.equal(a.previous,previous);
    assert.equal(e.args.approvalHash,approvalDigest(context,a));assert.equal(row.approvalHash,e.args.approvalHash);assert.equal(String(e.args.amountOut),row.out);
    previous=nextCheckpoint(previous,e.args.approvalHash,e.args.amountOut);assert.equal(previous,e.args.checkpoint);assert.equal(previous,row.checkpoint);
  }
  assert.equal(Number(await vault.sequence()),sequence);assert.equal(await vault.checkpoint(),previous);
  assert.equal(await vault.cashAccounted(),0n);assert.equal(await vault.assetAccounted(),0n);
  for(const row of evidence.transactions)assert.equal((await rpc.getTransactionReceipt(row.hash)).status,1);
  const report={status:'PASS_INDEPENDENT_FORK_RECEIPT_VERIFICATION',verifiedAt:new Date().toISOString(),forkBlock:evidence.forkBlock,vault:evidence.vault,signedTransitions:sequence,verifiedTransactions:evidence.transactions.length,checks:['RPC receipts','canonical fork block hashes','EIP-712 signatures','fixed signer and policy','sequence/checkpoint hash chain','deployed code hashes','zero final accounted balances'],hardwareTEE:false,mainnetBroadcast:false};
  writeFileSync('docs/evidence/external-fork-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{rpc.destroy();}
