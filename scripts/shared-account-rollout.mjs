// Read-only preflight by default. Pausing and activation are explicit steps.
import { readFileSync,writeFileSync } from 'node:fs';
import { Contract,JsonRpcProvider,getAddress } from 'ethers';
import { encryptRequest } from '../src/integration/sealed.js';
import { assertVaultRetirable } from '../src/platform/vault-retirement.js';
import { PlatformDatabase } from '../src/platform/database.js';
import { databaseUrl } from '../src/platform/environment.js';

const env={...process.env};
try{for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const entry=line.match(/^([A-Z_0-9]+)=(.*)$/);if(entry&&!env[entry[1]])env[entry[1]]=entry[2].trim().replace(/^['"]|['"]$/g,'');}}catch{}
const api=(env.MMQ_API_URL||'https://mm-zkquant.vercel.app/api').replace(/\/$/,'');
async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('ROLLOUT_ENDPOINT_UNAVAILABLE');return response.json();}
async function admin(config,action){
  const client=JSON.parse(readFileSync(env.MMQ_TEE_CLIENT_PATH||'.data/cohort-tee/client.json','utf8'));
  if(!client.token)throw Error('ORIGINAL_TEE_ADMIN_TOKEN_REQUIRED');
  const request=encryptRequest(config.teeEncryptionPublicKey,{action,accessToken:client.token});
  const response=await fetch(`${config.teeEndpoint}/platform/encrypted-investments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.packet),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('TEE_ADMIN_ENDPOINT_UNAVAILABLE');const result=request.openReply((await response.json()).reply);
  if(result.error&&!Object.hasOwn(result,'ready'))throw Error(result.error);return result;
}
async function main(){
  const action=process.argv[2]||'check';
  if(!['check','pause','activate'].includes(action))throw Error('INVALID_ROLLOUT_ACTION');
  const config=await get(`${api}/v1/config`);
  if(action==='check'||action==='pause')return admin(config,action==='check'?'RETIREMENT_CHECK':'PAUSE_FOR_RETIREMENT');
  const candidate=JSON.parse(readFileSync('.data/platform-live/shared-deployment.json','utf8'));
  const provider=new JsonRpcProvider(env.MONAD_TESTNET_RPC_URL||'https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
  let database;
  try{
    if((await provider.getNetwork()).chainId!==10143n)throw Error('WRONG_ROLLOUT_CHAIN');
    const vault=new Contract(candidate.vaultAddress,['function executionAccountVersion() view returns(uint256)','function cash() view returns(address)','function operator() view returns(address)','function paused() view returns(bool)'],provider);
    if(await vault.executionAccountVersion()!==2n||getAddress(await vault.operator())!==getAddress(candidate.operator)||getAddress(await vault.cash())!==getAddress(candidate.token)||await vault.paused())throw Error('CANDIDATE_VAULT_CONFIGURATION_MISMATCH');
    if(config.vaultAddress&&getAddress(config.vaultAddress)!==getAddress(candidate.vaultAddress))await assertVaultRetirable({provider,vaultAddress:config.vaultAddress,cashTokenAddress:config.cashTokenAddress});
    const status=await get(`${config.teeEndpoint}/platform/status`);
    if(status.execution!=='STRATEGY_EXECUTION_AVAILABLE'||getAddress(status.investments?.vaultAddress||'')!==getAddress(candidate.vaultAddress)||status.accountSharing!=='COMPATIBLE_MARKET_DIRECTIONS')throw Error('TEE_SHARED_VAULT_NOT_READY');
    database=new PlatformDatabase({databaseUrl:databaseUrl(env)});
    await database.transaction(async client=>{
      const rows=await client.query("SELECT value FROM platform_settings WHERE key='omnibus_vault_address' FOR UPDATE");
      if(rows.rows[0]?.value&&getAddress(rows.rows[0].value)!==getAddress(config.vaultAddress)&&getAddress(rows.rows[0].value)!==getAddress(candidate.vaultAddress))throw Error('ACTIVE_VAULT_CHANGED');
      await client.query("INSERT INTO platform_settings(key,value) VALUES('omnibus_vault_address',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[candidate.vaultAddress]);
      await client.query("INSERT INTO platform_settings(key,value) VALUES('cash_token_address',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[candidate.token]);
    });
    writeFileSync('.data/platform-live/deployment.json',JSON.stringify(candidate,null,2),{mode:0o600});
    return {activated:true,vaultAddress:candidate.vaultAddress,accountSharing:'COMPATIBLE_MARKET_DIRECTIONS'};
  }finally{await database?.close();provider.destroy();}
}
main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(/^[A-Z_]+$/.test(error.message)?error.message:'ROLLOUT_CONNECTION_OR_CONFIGURATION_FAILED');process.exitCode=1;});
