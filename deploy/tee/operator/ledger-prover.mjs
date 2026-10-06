import {fork} from 'node:child_process';
import {resolve} from 'node:path';
export function proveLedgerTransition(witness,artifacts,{timeoutMs=180000}={}) {
 return new Promise((resolvePromise,reject)=>{
  const child=fork(new URL('./ledger-prove-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=1024']});
  let finished=false;
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);child.kill();error?reject(error):resolvePromise(result);};
  const timer=setTimeout(()=>finish(Error('LEDGER_PROVING_TIMEOUT')),timeoutMs);
  child.once('error',()=>finish(Error('LEDGER_PROVER_UNAVAILABLE')));
  child.once('exit',()=>finish(Error('LEDGER_PROVER_EXIT')));
  child.once('message',message=>message.ok?finish(null,message):finish(Error(message.error||'LEDGER_PROVING_FAILED')));
  child.send({witness,artifacts:Object.fromEntries(Object.entries(artifacts).map(([key,path])=>[key,resolve(path)]))},error=>{if(error)finish(Error('LEDGER_PROVER_UNAVAILABLE'));});
 });
}
