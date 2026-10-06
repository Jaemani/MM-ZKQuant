// Witnesses arrive only through IPC and never touch plaintext files or logs.
import {readFileSync} from 'node:fs';
import {groth16} from 'snarkjs';
import {createRequire} from 'node:module';
const snarkRequire=createRequire(createRequire(import.meta.url).resolve('snarkjs'));
const {buildBn128}=snarkRequire('ffjavascript');
process.on('message',async({witness,artifacts})=>{
 try {
  const started=Date.now();
  const result=await groth16.fullProve(witness,artifacts.wasm,artifacts.zkey,undefined,undefined,{singleThread:true});
  // Pinned ffjavascript cache lets verification reuse a single-thread curve.
  globalThis.curve_bn128=await buildBn128(true);
  if(!await groth16.verify(JSON.parse(readFileSync(artifacts.verificationKey)),result.publicSignals,result.proof))throw Error('INVALID_PROOF');
  const calldata=JSON.parse('['+await groth16.exportSolidityCallData(result.proof,result.publicSignals)+']');
  process.send({ok:true,...result,calldata,provingMs:Date.now()-started},()=>process.exit(0));
 }catch{process.send({ok:false,error:'LEDGER_PROVING_FAILED'},()=>process.exit(1));}
});
