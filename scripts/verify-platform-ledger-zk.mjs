// Public inputs only. No API token, investor login, plaintext ledger or witness.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {JsonRpcProvider,Contract,Interface,keccak256,verifyMessage} from 'ethers';
import {groth16} from 'snarkjs';
import {checkpointAbi,proofMessage} from '../deploy/tee/operator/ledger-proofs.mjs';
import {verifyPlatformTee} from '../src/platform/tee-attestation.js';
import {teeAttestationPolicy} from '../src/platform/tee-attestation-policy.js';

const base=(process.env.MMQ_API_URL||'https://mm-zkquant.vercel.app/api').replace(/\/$/,'');
const web=base.replace(/\/api$/,'');
const get=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,`Public resource unavailable: ${new URL(url).pathname}`);return response;};
const [status,manifest,deployment]=await Promise.all([get(base+'/v1/ledger-proof-status').then(r=>r.json()),get(web+'/zk/platform-ledger-v1/manifest.json').then(r=>r.json()),get(web+'/zk/platform-ledger-v1/deployment.json').then(r=>r.json())]);
assert.equal(status.enabled,true);assert.equal(status.ready,true);assert.ok(status.checkpoint?.onchainVerified,'No complete onchain checkpoint yet');
const pinned=JSON.parse(readFileSync('public/zk/platform-ledger-v1/deployment.json'));
for(const field of ['checkpoint','verifier','vault','operator','verificationKeyHash','checkpointCodeHash','verifierCodeHash'])assert.equal(deployment[field].toLowerCase(),pinned[field].toLowerCase(),`Deployment pin mismatch: ${field}`);
assert.equal(status.registry.toLowerCase(),deployment.checkpoint.toLowerCase());assert.equal(status.verificationKeyHash,deployment.verificationKeyHash);
const bytes=Buffer.from(await (await get(web+manifest.artifacts.verificationKey.path)).arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'),deployment.verificationKeyHash);const key=JSON.parse(bytes);
const requireSnark=createRequire(createRequire(import.meta.url).resolve('snarkjs'));
globalThis.curve_bn128=await requireSnark('ffjavascript').buildBn128(true);
const provider=new JsonRpcProvider(process.env.MMQ_LEDGER_RPC_URL||'https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
 assert.equal((await provider.getNetwork()).chainId,10143n);
 const registry=new Contract(deployment.checkpoint,checkpointAbi,provider),iface=new Interface(checkpointAbi);
 const [registryCode,verifierCode,operator,vault,vkHash,genesis]=await Promise.all([provider.getCode(deployment.checkpoint),provider.getCode(deployment.verifier),registry.operator(),registry.vault(),registry.verificationKeyHash(),registry.genesisRoot()]);
 assert.equal(keccak256(registryCode),deployment.checkpointCodeHash);assert.equal(keccak256(verifierCode),deployment.verifierCodeHash);
 assert.equal(operator.toLowerCase(),deployment.operator.toLowerCase());assert.equal(vault.toLowerCase(),deployment.vault.toLowerCase());assert.equal(vkHash,'0x'+deployment.verificationKeyHash);assert.equal(String(genesis),status.genesisRoot);
 let root=status.genesisRoot,sequence=0,records=[];
 while(sequence<status.checkpoint.lastSequence){
  const page=await (await get(`${base}/v1/ledger-proofs?after=${sequence}&limit=50`)).json();assert.ok(page.records.length,'Missing public proof history');
  for(const record of page.records){
   if(record.payload.sequence>status.checkpoint.lastSequence)break;
   const {payload,signature,anchored}=record,pub=payload.publicSignals;
   assert.equal(verifyMessage(proofMessage(payload),signature).toLowerCase(),operator.toLowerCase());
   assert.equal(payload.verificationKeyHash,deployment.verificationKeyHash);assert.equal(pub.length,7);assert.equal(pub[0],'10143');assert.equal(BigInt(pub[1]),BigInt(vault));assert.equal(Number(pub[2]),sequence+1);assert.equal(payload.sequence,sequence+1);assert.equal(pub[4],root);assert.equal(Number(pub[3]),payload.checkpointAt);
   assert.ok(await groth16.verify(key,pub,payload.proof),`Proof ${payload.sequence} is invalid`);
   const calldata=JSON.parse('['+await groth16.exportSolidityCallData(payload.proof,pub)+']');assert.deepEqual(payload.calldata,calldata);
   assert.ok(anchored?.txHash);const [receipt,tx]=await Promise.all([provider.getTransactionReceipt(anchored.txHash),provider.getTransaction(anchored.txHash)]);
   assert.equal(receipt.status,1);assert.equal(receipt.blockNumber,anchored.blockNumber);assert.equal(tx.from.toLowerCase(),operator.toLowerCase());assert.equal(tx.to.toLowerCase(),deployment.checkpoint.toLowerCase());
   assert.equal(tx.data,iface.encodeFunctionData('append',calldata));
   const event=receipt.logs.filter(log=>log.address.toLowerCase()===deployment.checkpoint.toLowerCase()).map(log=>{try{return iface.parseLog(log);}catch{return null;}}).find(event=>event?.name==='TransitionVerified');
   assert.ok(event);assert.equal(String(event.args.sequence),pub[2]);assert.equal(String(event.args.oldRoot),pub[4]);assert.equal(String(event.args.newRoot),pub[5]);assert.equal(String(event.args.eventsRoot),pub[6]);
   root=pub[5];sequence++;records.push({sequence,checkpointAt:payload.checkpointAt,provingMs:payload.provingMs,txHash:anchored.txHash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed)});
  }
 }
 assert.equal(root,status.checkpoint.root);const [head,headRoot]=await Promise.all([registry.sequence(),registry.root()]);assert.ok(head>=BigInt(sequence));if(head===BigInt(sequence))assert.equal(String(headRoot),root);
 const config=await (await get(base+'/v1/config')).json();
 const tee=await verifyPlatformTee({endpoint:config.teeEndpoint,publicKey:config.teeEncryptionPublicKey,vault:config.vaultAddress});
 assert.equal(tee.operator.toLowerCase(),operator.toLowerCase());
 assert.equal(status.genesisRoot,teeAttestationPolicy.ledgerGenesis.genesisRoot);
 assert.equal(deployment.verificationKeyHash,teeAttestationPolicy.ledgerGenesis.verificationKeyHash);
 const checkpoints=[...new Set(records.map(record=>record.checkpointAt))];
 const report={verified:true,chainId:10143,vault,operator,checkpoint:deployment.checkpoint,verifier:deployment.verifier,verificationKeyHash:deployment.verificationKeyHash,genesisRoot:status.genesisRoot,verifiedRoot:root,verifiedSequence:sequence,onchainHead:Number(head),teeQuoteHash:tee.quoteHash,intervalSeconds:status.intervalSeconds,checkpointTimes:checkpoints,records,limitations:['Attested TEE genesis; earlier history is not proven','Phala HTTPS DCAP verifier and initial compose enrollment remain trusted','Prices, fills, exit costs and investor authorization are supplied by the TEE','Single-party testnet Groth16 phase 2; production needs a multiparty ceremony']};
 mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/platform-ledger-zk.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({verified:true,proofs:sequence,checkpoints:checkpoints.length,latestTransaction:records.at(-1).txHash,checkpoint:deployment.checkpoint}));
}finally{provider.destroy();await globalThis.curve_bn128.terminate();}
