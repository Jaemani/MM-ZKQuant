import { readFileSync, existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { Wallet } from 'ethers';
import { OmnibusRuntime,signCommand,localWallet } from '../src/sleeves/runtime.js';
import { compileOmnibus, omnibusRpc } from '../src/sleeves/chain.js';
import { atomicJson } from '../src/pilot/chain.js';
import { digest } from '../src/pilot/policy.js';
import { money } from '../src/sleeves/ledger.js';
import assert from 'node:assert/strict';

const rpc=process.argv.includes('--testnet');
const directory=resolve(rpc?'.data/omnibus-testnet-v02':'.data/omnibus-proof-local');
let chain,r;
if(rpc){
  const wallet=JSON.parse(readFileSync(resolve('.data/testnet-pilot/wallet.json')));
  chain=await omnibusRpc({privateKey:wallet.privateKey,rpcUrl:'https://testnet-rpc.monad.xyz'},directory);
  const balance=await chain.rpc.getBalance(chain.accounts[0]);if(balance<10n**17n)throw new Error('Insufficient test MON for isolated deployment');
  r=await OmnibusRuntime.create(chain,directory);
}else{r=await OmnibusRuntime.local(directory);chain=r.chain;}
const a=rpc?new Wallet(JSON.parse(readFileSync(resolve('.data/testnet-pilot/wallet.json'))).privateKey):localWallet(1);
const b=rpc?a:localWallet(2),pa=localWallet(3),pb=localWallet(4);
const commandPath=join(directory,'proof-commands.json');
const commands=existsSync(commandPath)?JSON.parse(readFileSync(commandPath)):{};
async function run(name,w,type,strategyId,data={}){
  if(!commands[name]){commands[name]=await signCommand(r,w,type,strategyId,data);atomicJson(commandPath,commands);}
  const e=commands[name],id=digest({signer:e.payload.signer,nonce:e.payload.nonce});
  if(!r.state.used.includes(id)){
    if(e.payload.expiresAt<Math.floor(Date.now()/1000)){commands[name]=await signCommand(r,w,type,strategyId,data);atomicJson(commandPath,commands);}
    await r.submit(commands[name]);
  }
  console.log(name+' confirmed');
}
try{
  await run('allocate-trend',a,'ALLOCATE','btc-trend',{amount:'100000'});
  await run('allocate-reserve',a,'ALLOCATE','cash-reserve',{amount:'30000'});
  await run('allocate-hedge',b,'ALLOCATE','btc-hedge',{amount:rpc?'50000':'100000'});
  await run('open-trend',pa,'ORDER','btc-trend',{side:'BUY',amount:'25000'});
  await run('open-hedge',pb,'ORDER','btc-hedge',{side:'SHORT_OPEN',amount:rpc?'12500':'25000'});
  const marketTag='omnibus-market-buy';
  const resumed=await chain.resume(marketTag);
  if(!resumed)await chain.tx(marketTag,r.venue,'swap',[0,true,money(500000),1,await chain.now()+300]);
  await run('close-trend',pa,'ORDER','btc-trend',{side:'SELL'});
  await run('close-hedge',pb,'ORDER','btc-hedge',{side:'SHORT_CLOSE'});
  const beforePath=join(directory,'before-redemption.json');
  if(!existsSync(beforePath))atomicJson(beforePath,{a:await r.view(await signCommand(r,a,'VIEW','')),b:await r.view(await signCommand(r,b,'VIEW',''))});
  const before=JSON.parse(readFileSync(beforePath));
  const trend=before.a.portfolio.find(p=>p.strategyId==='btc-trend'),hedge=before.b.portfolio.find(p=>p.strategyId==='btc-hedge');
  assert.ok(BigInt(trend.claim)>money(100000));assert.ok(BigInt(hedge.claim)<money(rpc?50000:100000));
  await run('redeem-trend',a,'REDEEM','btc-trend');
  await run('pay-provider',pa,'PAY_PROVIDER','btc-trend');
  const after={a:await r.view(await signCommand(r,a,'VIEW','')),b:await r.view(await signCommand(r,b,'VIEW',''))};
  assert.ok(!after.a.portfolio.some(p=>p.strategyId==='btc-trend'));
  assert.equal(after.a.portfolio.find(p=>p.strategyId==='cash-reserve').claim,String(money(30000)));
  assert.equal(after.b.portfolio.find(p=>p.strategyId==='btc-hedge').claim,hedge.claim);
  await run('redeem-hedge',b,'REDEEM','btc-hedge');await run('redeem-reserve',a,'REDEEM','cash-reserve');
  const rec=await r.reconcile();assert.equal(rec.vaultEquity,'0');
  const report={version:'CONFIDENTIAL_ALPHA_V02',verdict:'SIGNED_OMNIBUS_EXECUTION_PASS',environment:chain.environment,chainId:chain.chainId,tee:false,testAssetsOnly:true,controlledParticipants:true,controlledMarketTrade:true,operatorTrusted:true,vault:r.vault.address,venue:r.venue.address,cash:r.cash.address,compiler:compileOmnibus().OmnibusVault.compiler,sourceHash:compileOmnibus().OmnibusVault.sourceHash,codeHash:await chain.codeHash(r.vault),before,after,finalReconciliation:rec,transactions:r.state.receipts.map(x=>({type:x.type,strategyId:x.strategyId,receipt:x.receipt,anchor:x.anchor})),limitations:['Test tokens and self-hosted constant-product venue; not production DEX integration','Reference signers, not independent users or provider performance validation','Private ledger and authorization trust the operator; no TEE','Short insolvency fails closed; automated liquidation and bankruptcy resolution are not implemented']};
  const output=resolve('docs/evidence/omnibus-'+(rpc?'testnet':'local')+'.json');atomicJson(output,report);console.log(JSON.stringify({verdict:report.verdict,environment:report.environment,vault:report.vault,operations:report.transactions.length,output}));
}finally{chain.close();}
