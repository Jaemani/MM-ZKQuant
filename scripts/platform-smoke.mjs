// Public, read-only deployment verification. No credentials or test wallets required.
import assert from 'node:assert/strict';
import {Contract,JsonRpcProvider} from 'ethers';
const api=process.env.MMQ_API_URL||'https://mm-zkquant.vercel.app/api';
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,`HTTP ${r.status}: ${url}`);return r.json();}
const config=await get(`${api}/v1/config`);
assert.equal(config.chainId,10143);assert.ok(config.teeEncryptionPublicKey);assert.ok(config.vaultAddress);
const [catalog,status,metrics]=await Promise.all([get(`${api}/v1/strategies`),get(`${config.teeEndpoint}/platform/status`),get(`${config.teeEndpoint}/platform/metrics`)]);
assert.equal(status.investments.vaultAddress.toLowerCase(),config.vaultAddress.toLowerCase());
assert.equal(status.execution,'STRATEGY_EXECUTION_AVAILABLE');
const allowed=new Set(['strategyId','source','pnlBps','volatilityBps','maxDrawdownBps','managerActive','managerPending','managerWithdrawing','status','policyVersion']);
for(const m of metrics.strategies)assert.ok(Object.keys(m).every(k=>allowed.has(k)),'Private field in public metrics');
for(const s of catalog.strategies){assert.ok(s.policy);for(const k of ['targets','positions','investors','units','slots','requests','queuedExecutions'])assert.equal(s[k],undefined,`Private catalog field: ${k}`);}
const provider=new JsonRpcProvider('https://testnet-rpc.monad.xyz');
try {
 const vault=new Contract(config.vaultAddress,['function cash() view returns(address)','function operator() view returns(address)'],provider);
 assert.notEqual(await provider.getCode(config.vaultAddress),'0x');assert.equal((await vault.cash()).toLowerCase(),config.cashTokenAddress.toLowerCase());
 const legacy=await fetch(`${config.teeEndpoint}/platform/encrypted-targets`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(legacy.status,410);
 console.log({passed:true,chainId:10143,sharedVault:config.vaultAddress,publicStrategies:catalog.strategies.length,privateMetricFieldsAbsent:true,legacyTargetsRetired:true});
}finally{provider.destroy();}
