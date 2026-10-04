import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildPoseidon} from 'circomlibjs';
import {groth16} from 'snarkjs';
import {AbiCoder} from 'ethers';
import {settleCohort} from './accounting.mjs';
export async function createLedgerProver(dir='artifacts/cohort-zk'){
 const build=JSON.parse(readFileSync(dir+'/build.json'));
 for(const [file,hash]of Object.entries(build.sha256))if(createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw Error('Stale artifact '+file);
 const p=await buildPoseidon(),hash=x=>p.F.toObject(p(x));
 const input=({chainId,vault,venueNonce,deposits,recovered,feeBps})=>{
  const s=settleCohort(deposits,recovered,feeBps);
  const oldRoot=hash([2026100401n,chainId,BigInt(vault),...s.deposits,s.totalShares]);
  const newRoot=hash([oldRoot,venueNonce,s.recovered,...s.claims,s.totalFee]);
  return {pub:[chainId,BigInt(vault),oldRoot,newRoot,venueNonce,...s.deposits,s.recovered,s.feeBps,...s.claims,s.totalFee,s.totalShares],
   gross:s.gross,profits:s.profits,fees:s.fees,allocationRemainder:s.allocationRemainder,feeRemainders:s.feeRemainders};
 };
 const prove=async witness=>{
  const result=await groth16.fullProve(JSON.parse(JSON.stringify(witness,(_,v)=>typeof v==='bigint'?String(v):v)),dir+'/perpl-cohort-ledger_js/perpl-cohort-ledger.wasm',dir+'/perpl-cohort-ledger.zkey',undefined,undefined,{singleThread:true});
  const args=JSON.parse('['+await groth16.exportSolidityCallData(result.proof,result.publicSignals)+']');
  return {...result,encodedProof:AbiCoder.defaultAbiCoder().encode(['uint256[2]','uint256[2][2]','uint256[2]'],args.slice(0,3))};
 };
 return{input,prove};
}
