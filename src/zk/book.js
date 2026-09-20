import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildEddsa, buildPoseidon } from 'circomlibjs';
import { groth16 } from 'snarkjs';

export const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const PUBLIC_FIELDS=['phase','chainId','vault','config','batch','oldRoot','newRoot','buy','amount','minOut','deadline','amountOut','cashTotal','assetTotal','maxSpendBps'];
export const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2);
export const salt=()=>BigInt('0x'+randomBytes(31).toString('hex'));

export async function createBookProver(dir='artifacts/zk') {
  const poseidon=await buildPoseidon(),eddsa=await buildEddsa();
  const hash=values=>poseidon.F.toObject(poseidon(values.map(BigInt)));
  const root=state=>hash([...state.books.map((b,i)=>hash([i+1,...b])),state.salt,state.pending]);
  const publicKey=key=>eddsa.prv2pub(key).map(n=>eddsa.F.toObject(n));
  const initial=(amounts,keys)=>({books:amounts.map((cash,i)=>[BigInt(cash),0n,0n,0n,...publicKey(keys[i])]),salt:salt(),pending:0n});
  const orderHash=(context,order,providerSequence)=>hash([20260920,context.chainId,context.vault,context.config,order.batch,order.selected,providerSequence,order.buy,order.amount,order.minOut,order.deadline,context.maxSpendBps]);
  const sign=(context,order,providerSequence,key)=>{
    const m=orderHash(context,order,providerSequence),s=eddsa.signPoseidon(key,eddsa.F.e(m));
    return {sigR8x:eddsa.F.toObject(s.R8[0]),sigR8y:eddsa.F.toObject(s.R8[1]),sigS:s.S};
  };
  function transition(state,context,order,signature,output=null) {
    const settling=output!==null,phase=settling?2n:1n,next=structuredClone(state),b=next.books[order.selected];
    if(!b)throw Error('Unknown book');
    const amount=BigInt(order.amount),out=settling?BigInt(output):0n;
    if(settling){
      if(BigInt(order.buy)===1n){b[0]-=amount;b[1]+=out;}else{b[0]+=out;b[1]-=amount;}
      b[2]=0n;next.pending=0n;
    }else{b[2]=amount;b[3]++;next.pending=orderHash(context,order,b[3]);}
    next.salt=salt();
    const input={phase,chainId:BigInt(context.chainId),vault:BigInt(context.vault),config:BigInt(context.config),batch:BigInt(order.batch),oldRoot:root(state),newRoot:root(next),buy:BigInt(order.buy),amount,minOut:BigInt(order.minOut),deadline:BigInt(order.deadline),amountOut:out,cashTotal:next.books[0][0]+next.books[1][0],assetTotal:next.books[0][1]+next.books[1][1],maxSpendBps:BigInt(context.maxSpendBps),before:state.books,after:next.books,oldSalt:state.salt,newSalt:next.salt,selected:BigInt(order.selected),...signature};
    return {input,next};
  }
  async function prove(input) {
    const manifest=JSON.parse(readFileSync(`${dir}/build.json`));
    const sha=createHash('sha256').update(readFileSync('circuits/book-transition.circom')).digest('hex');
    if(sha!==manifest.circuitSha256)throw Error('Stale ZK build; run build:zk');
    const start=performance.now();
    const result=await groth16.fullProve(JSON.parse(json(input)),`${dir}/book-transition_js/book-transition.wasm`,`${dir}/book-transition.zkey`,undefined,undefined,{singleThread:true});
    const args=JSON.parse('['+await groth16.exportSolidityCallData(result.proof,result.publicSignals)+']');
    return {...result,contractProof:{a:args[0],b:args[1],c:args[2]},milliseconds:Math.round(performance.now()-start)};
  }
  return {hash,root,initial,publicKey,orderHash,sign,transition,prove};
}
