import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { JsonRpcProvider } from 'ethers';

const originUrl=process.env.MM_MONAD_READ_RPC||'https://rpc2.monad.xyz';
const origin=new JsonRpcProvider(originUrl,undefined,{batchMaxCount:1});
let block;
try{if((await origin.getNetwork()).chainId!==143n)throw Error('Monad mainnet source required');block=process.env.MM_FORK_BLOCK||String(await origin.getBlockNumber());}finally{origin.destroy();}
if(!/^[0-9]+$/.test(block))throw Error('Invalid fork block');
const port=await new Promise((resolvePort,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolvePort(port));});});
const require=createRequire(import.meta.url),wrapper=resolve(dirname(require.resolve('@foundry-rs/anvil/package.json')),'bin.mjs');
const anvil=spawn(process.execPath,[wrapper,'--fork-url',originUrl,'--fork-block-number',block,'--chain-id','31337','--host','127.0.0.1','--port',String(port),'--silent'],{stdio:['ignore','ignore','pipe']});
let failure='';anvil.stderr.on('data',b=>{failure=(failure+b.toString()).slice(-4000);});
const rpcUrl=`http://127.0.0.1:${port}`;
try {
  const deadline=Date.now()+60000;let ready=false;
  while(Date.now()<deadline){
    if(anvil.exitCode!==null)throw Error('Anvil failed: '+failure);
    try{const r=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'web3_clientVersion',params:[]}),signal:AbortSignal.timeout(1000)});if((await r.json()).result){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  if(!ready)throw Error('Fork startup timeout: '+failure);
  for(const script of ['scripts/prove-external-fork.mjs','scripts/verify-external-fork.mjs']){
    const child=spawn(process.execPath,[script],{stdio:'inherit',env:{...process.env,MM_FORK_RPC:rpcUrl}});
    const code=await new Promise((r,j)=>{child.on('error',j);child.on('exit',r);});if(code!==0)throw Error(script+' failed');
  }
}finally{anvil.kill('SIGTERM');}
