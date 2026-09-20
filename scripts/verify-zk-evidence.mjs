import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { groth16, curves } from 'snarkjs';
import { Contract, Interface, JsonRpcProvider, keccak256 } from 'ethers';
import { json } from '../src/zk/book.js';

try {
const e=JSON.parse(readFileSync('docs/evidence/zk-book-fork.json'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(e.build.circuitSha256,sha('circuits/book-transition.circom'));
assert.equal(e.vaultSourceSha256,sha('contracts/integration/ZkBookVault.sol'));
assert.equal(e.build.setup,'LOCAL_SINGLE_PARTY_TEST_ONLY');
assert.equal(e.status,'PASS_LOCAL_ZK_FORK_ONLY');
assert.equal(e.hardwareTEE,false);assert.equal(e.externalNetworkBroadcast,false);
for(const p of e.proofs){
  assert.equal(await groth16.verify(e.verificationKey,p.publicSignals,p.proof),true,p.label);
  assert.equal(p.publicSignals[1],'31337');assert.equal(BigInt(p.publicSignals[2]),BigInt(e.vault));
  assert.equal(p.publicSignals[3],e.config);
}
const tampered=[...e.proofs[0].publicSignals];tampered[6]=String(BigInt(tampered[6])+1n);
assert.equal(await groth16.verify(e.verificationKey,tampered,e.proofs[0].proof),false);
// The evidence key is not an independently trusted production key. The build
// hash and optional live verifier binding describe exactly what was checked.
const result={createdAt:new Date().toISOString(),status:'PASS_OFFLINE_PROOFS_ONLY',proofs:e.proofs.length,circuitSha256:e.build.circuitSha256,liveReceiptsVerified:false,productionSetup:false,hardwareTEE:false};
if(process.env.MM_FORK_RPC){
  const url=new URL(process.env.MM_FORK_RPC);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  const rpc=new JsonRpcProvider(url.href,undefined,{batchMaxCount:1,cacheTimeout:-1});
  try{
    assert.equal(Number((await rpc.getNetwork()).chainId),31337);
    const info=await rpc.send('anvil_nodeInfo',[]);assert.equal(info.forkConfig.forkBlockNumber,e.forkBlock);
    assert.equal(keccak256(await rpc.getCode(e.vault)),e.vaultCodeHash);
    assert.equal(keccak256(await rpc.getCode(e.verifier)),e.verifierCodeHash);
    const iface=new Interface([
      'event Executed(uint256 indexed batch,uint256 reservedRoot,bytes32 plan,uint256 amountOut)',
      'event Settled(uint256 indexed batch,uint256 settledRoot)',
      'function root() view returns(uint256)','function settledCursor() view returns(uint256)','function pending() view returns(bool)',
      'function verifier() view returns(address)',
      'function authorizeAndExecute((uint256[2] a,uint256[2][2] b,uint256[2] c),uint256[15])',
      'function settle((uint256[2] a,uint256[2][2] b,uint256[2] c),uint256[15])'
    ]);
    let root=e.initialRoot,cursor=0n,pending=null;
    for(const t of e.transactions){
      const receipt=await rpc.getTransactionReceipt(t.hash);assert.ok(receipt);assert.equal(receipt.status,1);assert.equal(receipt.blockNumber,t.block);
      if(!/^(execute|settle)-/.test(t.label))continue;
      const transaction=await rpc.getTransaction(t.hash);assert.equal(transaction.to.toLowerCase(),e.vault.toLowerCase());
      const decoded=iface.parseTransaction({data:transaction.data}),signals=decoded.args[1].map(String);
      const label=t.label.replace('execute-','authorize-'),proof=e.proofs.find(p=>p.label===label);assert.ok(proof);
      assert.deepEqual(signals,proof.publicSignals);assert.equal(signals[5],root);
      const event=receipt.logs.filter(l=>l.address.toLowerCase()===e.vault.toLowerCase()).map(l=>{try{return iface.parseLog(l);}catch{return null;}}).filter(Boolean);
      assert.equal(event.length,1);
      if(t.label.startsWith('execute-')){
        assert.equal(pending,null);assert.equal(event[0].name,'Executed');assert.equal(event[0].args.batch,cursor+1n);
        assert.equal(String(event[0].args.reservedRoot),signals[6]);pending={batch:String(event[0].args.batch),out:String(event[0].args.amountOut)};
      }else{
        assert.ok(pending);assert.equal(event[0].name,'Settled');assert.equal(String(event[0].args.batch),pending.batch);
        assert.equal(signals[11],pending.out);assert.equal(String(event[0].args.settledRoot),signals[6]);cursor++;pending=null;
      }
      root=signals[6];
    }
    assert.equal(pending,null);assert.equal(root,e.finalRoot);assert.equal(String(cursor),e.settledCursor);
    const vault=new Contract(e.vault,iface,rpc);
    assert.equal(await vault.root(),BigInt(root));assert.equal(await vault.settledCursor(),cursor);assert.equal(await vault.pending(),false);
    assert.equal((await vault.verifier()).toLowerCase(),e.verifier.toLowerCase());
    Object.assign(result,{status:'PASS_PROOFS_AND_LIVE_FORK_RECEIPTS',liveReceiptsVerified:true,transactions:e.transactions.length,settledCursor:String(cursor)});
  }finally{rpc.destroy();}
}
const output=process.env.MM_FORK_RPC?'docs/evidence/zk-book-verification.json':'artifacts/zk/offline-verification.json';
if(!process.env.MM_FORK_RPC)mkdirSync('artifacts/zk',{recursive:true});
writeFileSync(output,json(result)+'\n');console.log(json(result));
} finally {
  // snarkjs verification keeps a shared worker pool alive unless terminated.
  await (await curves.getCurveFromName('bn128')).terminate();
}
