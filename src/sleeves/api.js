import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { omnibusRpc } from './chain.js';
import { OmnibusRuntime, signCommand, localWallet } from './runtime.js';
export class SleeveExecutionApi {
  constructor(directory){this.directory=directory;this.ready=null;}
  runtime(){return this.ready||(this.ready=this.initialize().catch(e=>{this.ready=null;throw e;}));}
  async initialize(){
    if(process.env.SLEEVE_NETWORK!=='monad-testnet')return OmnibusRuntime.local(this.directory);
    const directory=resolve(this.directory,'../omnibus-testnet-v02');
    const wallet=JSON.parse(readFileSync(resolve(this.directory,'../testnet-pilot/wallet.json')));
    const chain=await omnibusRpc({privateKey:wallet.privateKey,rpcUrl:process.env.SLEEVE_RPC_URL||'https://testnet-rpc.monad.xyz'},directory);
    try{return await OmnibusRuntime.create(chain,directory);}catch(error){chain.close();throw error;}
  }
  async get(){return (await this.runtime()).view();}
  async post(action,body){
    const r=await this.runtime();
    if(action==='inspect-local-domains')return r.inspectLocalDomains();
    if(action==='prepare')return r.prepare(body);
    if(action==='complete')return r.complete(body.envelope,body.transactionHash);
    if(action==='submit')return r.submit(body);
    if(action==='view')return r.view(body);
    // Explicit local EVM fixture controls. Never enabled for an RPC runtime.
    if(action==='local-fixture'){
      if(r.chain.environment!=='LOCAL_EVM')throw new Error('Local fixtures are disabled outside local EVM');
      if(!['a','b'].includes(body.investor))throw new Error('Choose a local test wallet');
      const investor=localWallet(body.investor==='a'?1:2);
      if(body.action==='view')return {...await r.view(await signCommand(r,investor,'VIEW','')),fixtureWallet:true};
      if(['ALLOCATE','REDEEM'].includes(body.action))return r.submit(await signCommand(r,investor,body.action,body.strategyId,body.action==='ALLOCATE'?{amount:body.amount}:{}));
      const provider=localWallet(body.strategyId==='btc-hedge'?4:3);
      if(body.action==='REGISTER')return r.submit(await signCommand(r,localWallet(3),'REGISTER',body.strategyId,{name:body.name,description:body.description}));
      if(body.action==='ORDER')return r.submit(await signCommand(r,provider,'ORDER',body.strategyId,{side:body.side,asset:'BTC',...(body.amount!==undefined?{amount:body.amount}:{})}));
      if(body.action==='PAY_PROVIDER')return r.submit(await signCommand(r,provider,'PAY_PROVIDER',body.strategyId,{}));
      throw new Error('Unknown fixture action');
    }
    throw new Error('Unknown execution operation');
  }
}
