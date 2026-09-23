import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildEddsa,buildPoseidon } from 'circomlibjs';
import { groth16 } from 'snarkjs';
import { AbiCoder } from 'ethers';
export const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const field=x=>{x=BigInt(x);return x<0n?FIELD+x:x;};
export async function createTargetProver(dir='artifacts/perpl-zk') {
  const manifest=JSON.parse(readFileSync(dir+'/build.json'));
  for(const [path,expected]of Object.entries(manifest.sha256))if(createHash('sha256').update(readFileSync(path)).digest('hex')!==expected)throw Error('Stale artifact: '+path);
  const eddsa=await buildEddsa(),poseidon=await buildPoseidon();
  const publicKey=key=>eddsa.prv2pub(key).map(x=>eddsa.F.toObject(x));
  const input=(context,key)=>{
    const pub=[context.chainId,context.account,context.market,context.nonce,field(context.target),field(context.position),context.limitPrice,context.deadline,context.maxLots,...publicKey(key)].map(BigInt);
    const msg=poseidon.F.toObject(poseidon([2026092301n,...pub]));
    const sig=eddsa.signPoseidon(key,eddsa.F.e(msg));
    return {pub,sigR8x:eddsa.F.toObject(sig.R8[0]),sigR8y:eddsa.F.toObject(sig.R8[1]),sigS:sig.S};
  };
  const prove=async witness=>{
    const started=performance.now();
    const result=await groth16.fullProve(JSON.parse(JSON.stringify(witness,(_,v)=>typeof v==='bigint'?v.toString():v)),dir+'/perpl-target-mvp_js/perpl-target-mvp.wasm',dir+'/perpl-target-mvp.zkey',undefined,undefined,{singleThread:true});
    const args=JSON.parse('['+await groth16.exportSolidityCallData(result.proof,result.publicSignals)+']');
    return {...result,milliseconds:Math.round(performance.now()-started),encodedProof:AbiCoder.defaultAbiCoder().encode(['uint256[2]','uint256[2][2]','uint256[2]'],args.slice(0,3))};
  };
  return {publicKey,input,prove,manifest};
}
