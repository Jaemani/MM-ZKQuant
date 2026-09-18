import { readFileSync, existsSync } from 'node:fs';
import solc from 'solc';
import { createLocalPilotChain, createRpcPilotChain, atomicJson } from '../pilot/chain.js';
import { digest } from '../pilot/policy.js';

let cached;
export function compileOmnibus() {
  if (cached) return cached;
  const source=readFileSync(new URL('../../contracts/sleeves/OmnibusVault.sol',import.meta.url),'utf8');
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'OmnibusVault.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}})));
  const errors=output.errors?.filter(x=>x.severity==='error')||[];
  if(errors.length)throw new Error(errors.map(x=>x.formattedMessage).join('\n'));
  cached=Object.fromEntries(Object.entries(output.contracts['OmnibusVault.sol']).map(([name,a])=>[name,{abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,runtimeBytecode:'0x'+a.evm.deployedBytecode.object,immutableReferences:a.evm.deployedBytecode.immutableReferences,sourceHash:digest(source),compiler:solc.version()}]));
  return cached;
}
// Deterministic local EVM replay is durable across server restarts. Journal an
// intent BEFORE executing it, including reverts (which consume nonce and gas).
export async function durableLocalChain(path) {
  const artifacts=compileOmnibus(),chain=await createLocalPilotChain(artifacts);
  const journal=path&&existsSync(path)?JSON.parse(readFileSync(path)):[];
  const save=()=>{if(path)atomicJson(path,journal);};
  async function perform(row) {
    const previousStatus=row.status,previousError=row.error;
    chain.advanceTo(row.time);
    try {
      const result=await chain[row.method](...row.args);
      if(row.status==='REVERTED')throw new Error('Replay changed a previously reverted transaction');
      const receipt=row.method==='deploy'?result.deployment:result;
      if(row.hash&&row.hash!==receipt.transactionHash)throw new Error('Local EVM replay hash mismatch');
      row.status='CONFIRMED';row.hash=receipt.transactionHash;save();return result;
    }catch(error){if(previousStatus==='CONFIRMED'||error.message==='Replay changed a previously reverted transaction'||(previousStatus==='REVERTED'&&error.message!==previousError))throw error;row.status='REVERTED';row.error=error.message;save();throw error;}
  }
  for(const row of journal) {const expectedError=row.status==='REVERTED'?row.error:null;try{await perform(row);}catch(e){if(!expectedError||e.message!==expectedError)throw e;}}
  async function execute(method,args) {
    args=JSON.parse(JSON.stringify(args,(_,v)=>typeof v==='bigint'?String(v):v));
    const existing=journal.find(r=>r.args[0]===args[0]);
    if(existing){if(digest(existing.args)!==digest(args)||existing.method!==method)throw new Error('Journal intent mismatch');if(existing.status==='REVERTED')throw new Error(existing.error);return chain[method](...args);}
    const row={method,args:JSON.parse(JSON.stringify(args,(_,v)=>typeof v==='bigint'?String(v):v)),time:await chain.now(),status:'PREPARED'};
    journal.push(row);save();return perform(row);
  }
  return {...chain,deploy:(...args)=>execute('deploy',args),tx:(...args)=>execute('tx',args)};
}

export async function omnibusRpc(config,directory){
  const chain=await createRpcPilotChain(compileOmnibus(),config,directory),read=chain.read;
  const finalized=chain.assertFinalized;
  chain.assertFinalized=async tx=>{
    for(let attempt=0;attempt<20;attempt++){
      try{return await finalized(tx);}catch(error){
        if(attempt===19||!/has not reached RPC finalized head/.test(error.message))throw error;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }
  };
  let queue=Promise.resolve();
  chain.read=(...args)=>{
    const next=queue.then(async()=>{
      for(let attempt=0;attempt<5;attempt++){
        await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));
        try{return await read(...args);}catch(error){
          const message=error.info?.error?.message||error.error?.message||'';
          if(attempt===4||!/requests limited|rate limit|too many/i.test(message))throw error;
        }
      }
    });queue=next.catch(()=>{});return next;
  };return chain;
}
