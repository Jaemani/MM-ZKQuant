import { generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { signObject, signingPublicKey, encryptEnvelope, verifyObject } from '../src/server/crypto.js';
import { digest, alphaCommitment, ASSETS, validateVector } from '../src/pilot/policy.js';
import { collectMarket } from '../src/pilot/market.js';
const args=process.argv.slice(2),command=args.shift()||'help';
const opt=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const base=opt('server','http://127.0.0.1:8790');
if(!/^https:\/\//.test(base)&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw new Error('Remote providers require HTTPS');
const keyfile=resolve(opt('key-file','.data/pilot-provider.json'));
async function request(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Local-Client':'mm-alpha-sdk'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
function save(value){mkdirSync(dirname(keyfile),{recursive:true,mode:0o700});writeFileSync(keyfile,JSON.stringify(value,null,2),{mode:0o600,flush:true});}
async function vectorFor(strategy){
  if(!['momentum','reversion','relative'].includes(strategy))throw new Error('strategy: momentum, reversion, relative');
  const market=await collectMarket();
  const returns=ASSETS.map(asset=>{const o=market.observations.find(o=>o.asset===asset),series=Object.entries(JSON.parse(o.raw).result).find(([k])=>k!=='last')[1];const prior=series.find(r=>Number(r[0])+60===market.boundary-60);if(!prior)throw new Error('Prior closed candle missing');return Number(o.price)/Number(prior[4])-1;});
  const average=returns.reduce((s,v)=>s+v,0)/4;
  const scores=returns.map(v=>strategy==='reversion'?-v:strategy==='relative'?v-average:v);
  const scale=Math.max(0.0001,...scores.map(Math.abs));
  return {vectorBps:scores.map(v=>Math.trunc(v/scale*10000)),inputDataHash:digest(market)};
}
async function main(){
  if(command==='help'){console.log('enroll --name NAME --payout 0x... --key-file PATH; submit --vector [10000,0,0,0]; watch --strategy momentum|reversion|relative --cycles 2; receipt --epoch 0x...');return;}
  let identity=existsSync(keyfile)?JSON.parse(readFileSync(keyfile)):null;
  if(command==='enroll'){
    const name=opt('name'),payoutAddress=opt('payout');if(!name||!payoutAddress)throw new Error('enroll needs --name and --payout');
    if(!identity){const privateKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});identity={privateKey,publicKey:signingPublicKey(privateKey),receipts:{}};}
    const payload=identity.enrollment||{domain:'MM_PILOT_ENROLL_V1',name,payoutAddress,publicKey:identity.publicKey,nonce:randomBytes(32).toString('hex')};
    identity.enrollment=payload;save(identity);
    const signed={payload,signature:signObject(payload,identity.privateKey)};
    if(args.includes('--offline')){const path=resolve(opt('output','pilot-enrollment.json'));writeFileSync(path,JSON.stringify(signed,null,2),{mode:0o600});console.log(JSON.stringify({requestId:digest(payload),file:path,privateKeyNotExported:true}));return;}
    const result=await request('/api/pilot/enroll',signed);
    console.log(JSON.stringify({requestId:result.id,status:result.status,publicKey:identity.publicKey,message:'운영자가 경제적 운영자 단위로 검토·승인해야 제출할 수 있습니다.'}));return;
  }
  if(!identity)throw new Error('Enroll first; private key remains only in the chosen local file');
  if(command==='prepare'){
    const contextFile=opt('context');if(!contextFile)throw new Error('prepare requires --context exported-public-context.json');
    const state=JSON.parse(readFileSync(resolve(contextFile))),e=state.epochs.find(e=>e.status==='OPEN');
    if(!e)throw new Error('No open epoch in context');
    const actor=state.actors.find(a=>a.providerKeys.includes(identity.publicKey));if(!actor)throw new Error('Approved actor not present');
    if(identity.serverSigningKey&&identity.serverSigningKey!==state.signingPublicKey)throw new Error('Server key changed');identity.serverSigningKey=state.signingPublicKey;
    let payload=identity.payloads?.[e.id];
    if(!payload){const data=opt('vector')?{vectorBps:JSON.parse(opt('vector'))}:await vectorFor(opt('strategy','momentum'));validateVector(data.vectorBps);payload={domain:'MM_PILOT_ALPHA_V2',epochId:e.id,actorId:actor.id,publicKey:identity.publicKey,policyHash:e.policyHash,...data,nonce:randomBytes(32).toString('hex')};identity.payloads||={};identity.payloads[e.id]=payload;save(identity);}
    const envelope=encryptEnvelope({payload,signature:signObject(payload,identity.privateKey),commitmentSignature:signObject(alphaCommitment(payload),identity.privateKey)},createPublicKey({key:state.serverPublicKey,format:'jwk'}));
    const path=resolve(opt('output','pilot-alpha.encrypted.json'));writeFileSync(path,JSON.stringify(envelope,null,2),{mode:0o600});console.log(JSON.stringify({epoch:e.id,file:path,cutoffAt:e.cutoffAt,accepted:false}));return;
  }
  if(command==='receipt'){
    const epoch=opt('epoch');if(!epoch)throw new Error('--epoch required');
    const receipt=await request(`/api/pilot/receipt?epoch=${encodeURIComponent(epoch)}&key=${encodeURIComponent(identity.publicKey)}`);
    const p=resolve(opt('output',keyfile+'.receipt.json'));writeFileSync(p,JSON.stringify(receipt,null,2),{mode:0o600});console.log(p);return;
  }
  async function submit(state,e){
    if(identity.serverSigningKey&&identity.serverSigningKey!==state.signingPublicKey)throw new Error('Pinned server signing key changed');
    identity.serverSigningKey=state.signingPublicKey;
    const actor=state.actors.find(a=>a.providerKeys.includes(identity.publicKey));if(!actor)throw new Error('Economic actor approval pending');
    let payload=identity.payloads?.[e.id];
    if(!payload){const data=opt('vector')?{vectorBps:JSON.parse(opt('vector'))}:await vectorFor(opt('strategy','momentum'));validateVector(data.vectorBps);
      payload={domain:'MM_PILOT_ALPHA_V2',epochId:e.id,actorId:actor.id,publicKey:identity.publicKey,policyHash:e.policyHash,...data,nonce:randomBytes(32).toString('hex')};
      identity.payloads||={};identity.payloads[e.id]=payload;save(identity);}
    const receipt=await request('/api/pilot/submit',encryptEnvelope({payload,signature:signObject(payload,identity.privateKey),commitmentSignature:signObject(alphaCommitment(payload),identity.privateKey)},createPublicKey({key:state.serverPublicKey,format:'jwk'})));
    const {serverSignature,...body}=receipt;if(!verifyObject(body,serverSignature,state.signingPublicKey)||body.payloadHash!==digest(payload))throw new Error('Server receipt does not bind original payload');
    identity.receipts[e.id]=receipt;save(identity);console.log(JSON.stringify({epoch:e.id,acceptedAt:receipt.acceptedAt,payloadHash:receipt.payloadHash}));
  }
  if(command==='submit'){const state=await request('/api/pilot/status'),e=state.epochs.find(e=>e.status==='OPEN');if(!e)throw new Error('No open pilot epoch');await submit(state,e);return;}
  if(command!=='watch')throw new Error('Unknown provider command');
  const cycles=Number(opt('cycles','2'));if(!Number.isInteger(cycles)||cycles<1||cycles>100)throw new Error('cycles must be 1–100');
  const deadline=Date.now()+Number(opt('timeout-seconds','1800'))*1000;let completed=0;
  while(completed<cycles&&Date.now()<deadline){const state=await request('/api/pilot/status');for(const e of state.epochs.filter(e=>e.status==='OPEN'&&Date.now()/1000<e.cutoffAt&&!identity.receipts[e.id])){await submit(state,e);completed++;}if(completed<cycles)await delay(3000);}
  if(completed<cycles)throw new Error('No further eligible epochs before timeout');
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
