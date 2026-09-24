import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { JsonRpcProvider } from 'ethers';

const publicZkRehearsal=process.argv.includes('--public-zk-rehearsal');
const testnetRehearsal=process.argv.includes('--testnet-rehearsal');
const originUrl='https://testnet-rpc.monad.xyz';
const origin=new JsonRpcProvider(originUrl,undefined,{batchMaxCount:1});
let block;
try {
  if((await origin.getNetwork()).chainId!==10143n)throw Error('Monad testnet required');
  block=process.env.MM_PERPL_FORK_BLOCK||String(await origin.getBlockNumber());
} finally { origin.destroy(); }
if(!/^[0-9]+$/.test(block))throw Error('Invalid block');
const port=await new Promise((res,rej)=>{const s=createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});
const require=createRequire(import.meta.url),wrapper=resolve(dirname(require.resolve('@foundry-rs/anvil/package.json')),'bin.mjs');
const anvil=spawn(process.execPath,[wrapper,'--fork-url',originUrl,'--fork-block-number',block,'--chain-id',(testnetRehearsal||publicZkRehearsal)?'10143':'31337','--host','127.0.0.1','--port',String(port),'--silent'],{stdio:['ignore','ignore','pipe']});
let failure='';anvil.stderr.on('data',b=>failure=(failure+b.toString()).slice(-4000));
const rpcUrl=`http://127.0.0.1:${port}`;
try {
  let ready=false;
  for(let i=0;i<120;i++) {
    if(anvil.exitCode!==null)throw Error('Anvil exited: '+failure);
    try{const r=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'web3_clientVersion',params:[]}),signal:AbortSignal.timeout(1000)});if((await r.json()).result){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  if(!ready)throw Error('Fork timeout: '+failure);
  const child=spawn(process.execPath,publicZkRehearsal?['scripts/prove-public-zk.mjs','--rehearsal','--execute']:testnetRehearsal?['scripts/prove-perpl-testnet.mjs','--fork-rehearsal']:['scripts/prove-perpl-fork.mjs',...process.argv.slice(2).filter(x=>['--zk','--tee','--atomic'].includes(x))],{stdio:'inherit',env:{...process.env,MM_PERPL_FORK_RPC:rpcUrl}});
  const code=await new Promise((res,rej)=>{child.on('error',rej);child.on('exit',res);});
  if(code!==0)throw Error(`Perpl fork check failed (${code})`);
  if(testnetRehearsal){const resumed=spawn(process.execPath,['scripts/prove-perpl-testnet.mjs','--fork-rehearsal','--resume-rehearsal'],{stdio:'inherit',env:{...process.env,MM_PERPL_FORK_RPC:rpcUrl}});const result=await new Promise((resolve,reject)=>{resumed.on('error',reject);resumed.on('exit',resolve);});if(result!==0)throw Error('Rehearsal resume failed');}
} finally { anvil.kill('SIGTERM'); }
