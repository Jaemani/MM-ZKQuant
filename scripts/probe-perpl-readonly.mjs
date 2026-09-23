// Public testnet reads only: no signer, keys, deployments, orders, or funds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Interface, keccak256 } from 'ethers';

const rpcUrl='https://testnet-rpc.monad.xyz';
const exchange='0x1964C32f0bE608E7D29302AFF5E61268E72080cc';
const sdkCommit='5b5be46a3349d719fbb59a08cf3955194bc8dfd8';
const abiUrl=`https://raw.githubusercontent.com/PerplFoundation/dex-sdk/${sdkCommit}/crates/sdk/abi/dex/Exchange.json`;
let id=0;
async function rpc(method,params) {
  assert.ok(['eth_chainId','eth_getBlockByNumber','eth_call','eth_getCode','eth_getStorageAt'].includes(method),'read-only RPC whitelist');
  const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});
  assert.ok(response.ok,`RPC HTTP ${response.status}`);
  const result=await response.json();
  if(result.error) throw new Error(JSON.stringify(result.error));
  return result.result;
}
const abiResponse=await fetch(abiUrl,{signal:AbortSignal.timeout(20000)});
assert.ok(abiResponse.ok,'pinned official ABI download');
const abiText=await abiResponse.text(),abiJson=JSON.parse(abiText),iface=new Interface(abiJson.abi??abiJson);
assert.equal(BigInt(await rpc('eth_chainId',[])),10143n);
const block=await rpc('eth_getBlockByNumber',['latest',false]);
const call=tx=>rpc('eth_call',[tx,block.number]);
const code=await rpc('eth_getCode',[exchange,block.number]);
assert.notEqual(code,'0x','exchange must have code');
async function read(name,args=[]) {
  return Array.from(iface.decodeFunctionResult(name,await call({to:exchange,data:iface.encodeFunctionData(name,args)})));
}
const version=await read('getContractVersion');
const allowance=await read('getWithdrawAllowanceData',[BigInt(block.number)]);
// Pin both proxy and standard EIP-1967 implementation when present; not a code audit.
const implSlot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const implWord=await rpc('eth_getStorageAt',[exchange,implSlot,block.number]);
const implementation=BigInt(implWord)===0n?null:`0x${implWord.slice(-40)}`;
const implementationCode=implementation?await rpc('eth_getCode',[implementation,block.number]):null;

const randao=await call({data:'0x4460005260206000f3'});
assert.equal(BigInt(randao),BigInt(block.mixHash),'PREVRANDAO/header match');
assert.notEqual(BigInt(randao),0n);
const word=x=>BigInt(x).toString(16).padStart(64,'0');
const add=await call({to:'0x0000000000000000000000000000000000000006',data:'0x'+[1,2,1,2].map(word).join('')});
const mul=await call({to:'0x0000000000000000000000000000000000000007',data:'0x'+[1,2,2].map(word).join('')});
// Independent affine doubling on the BN254 BASE field, not the scalar modulus.
const p=21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const mod=n=>((n%p)+p)%p;
function power(n,e) { let r=1n; for(;e;e>>=1n,n=mod(n*n)) if(e&1n)r=mod(r*n); return r; }
const slope=mod(3n*power(4n,p-2n)),x=mod(slope*slope-2n),y=mod(slope*(1n-x)-2n);
assert.equal(add,'0x'+word(x)+word(y)); assert.equal(mul,add);
for(const pairs of [1,4]) {
  const result=await call({to:'0x0000000000000000000000000000000000000008',data:'0x'+'00'.repeat(192*pairs)});
  assert.equal(BigInt(result),1n,`${pairs} infinity pairing dispatch`);
}
assert.equal((await rpc('eth_getBlockByNumber',[block.number,false])).hash,block.hash,'sample block reorged');
const report={
  createdAt:new Date().toISOString(),status:'PASS_READ_ONLY_BASIC_COMPATIBILITY',m0Complete:false,
  network:'Monad testnet',chainId:10143,rpcUrl,blockNumber:BigInt(block.number).toString(),blockHash:block.hash,blockGasLimit:BigInt(block.gasLimit).toString(),
  sdkCommit,abiUrl,abiSha256:createHash('sha256').update(abiText).digest('hex'),exchange,exchangeRuntimeKeccak:keccak256(code),implementation,implementationRuntimeKeccak:implementationCode?keccak256(implementationCode):null,
  version,withdrawAllowance:allowance,randao,checks:['version read','withdraw allowance read','PREVRANDAO equals block.mixHash','BN254 G1 add equals independent doubling','BN254 G1 mul equals independent doubling','BN254 infinity pairing 1 and 4 pairs'],
  limitations:['No state-changing transactions or contract-account test','No Groth16 proof verification or gas benchmark','Infinity pairings check dispatch only, not a nontrivial pairing relation','Runtime hashes record observed code, not reviewed or approved implementations','No private submission or slot accounting/withdrawal latency validation'],
};
const json=JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
if(process.argv.includes('--write-evidence')) writeFileSync('docs/evidence/perpl-readonly.json',json);
console.log(json);
