// Testnet-only enclave operator. Never prints inputs, keys, witnesses or signed bytes.
import {createServer,request} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {encryptionIdentity} from '../../../src/integration/sealed.js';
import {operatorKeys,createOperator} from './engine.mjs';
import {TestnetPlatform} from './platform.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(readFileSync('/app/manifest.json'));
if(process.env.DSTACK_SIMULATOR_ENDPOINT)throw Error('SIMULATOR_FORBIDDEN');
const dstack=(path,payload)=>new Promise((resolve,reject)=>{
  const body=JSON.stringify(payload),r=request({socketPath:'/var/run/dstack.sock',path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
    let data='';res.on('data',b=>{data+=b;if(data.length>2000000)r.destroy(Error('Oversize dstack response'));});
    res.on('end',()=>{try{if(res.statusCode!==200)throw Error('dstack status '+res.statusCode);const value=JSON.parse(data);if(value.error)throw Error('dstack rejected request');resolve(value);}catch(e){reject(e);}});
  });r.on('error',reject);r.setTimeout(15000,()=>r.destroy(Error('dstack timeout')));r.end(body);
});

const derived=await dstack('/GetKey',{path:'mm/cohort/'+manifest.experimentId,purpose:'testnet-operator',algorithm:'secp256k1'});
const secret=Buffer.from(derived.key,'hex'),channel=encryptionIdentity(secret,{maxHexLength:48_000_000}),keys=await operatorKeys(secret);
const identity={mode:'COHORT_TESTNET_OPERATOR',chainId:10143,encryptionPublicKey:channel.publicKey,operator:keys.wallet.address,managerKeys:[keys.publicKey(0),keys.publicKey(1)],...manifest};
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
let engine,busy=false;const seen=new Set();
const platform=new TestnetPlatform({secret,storeDir:'/state'});
const platformOrigins=new Set(['https://mm-zkquant.vercel.app','http://localhost:5173']);
const server=createServer(async(req,res)=>{
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
  const url=new URL(req.url,'http://localhost');
  const platformReply=(code,value)=>{const origin=req.headers.origin;if(origin&&platformOrigins.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname.startsWith('/platform/')){
   if(req.method==='OPTIONS'){platformReply(204,{});return;}
   let size=0,body={};
   if(req.method==='POST'){
    const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>64_000)throw Error('SIZE');chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks));}catch{throw Error('JSON');}
   }
   if(req.method==='GET'&&url.pathname==='/platform/status')return platformReply(200,platform.status());
   if(req.method==='GET'&&url.pathname==='/platform/strategies')return platformReply(200,{strategies:platform.strategies()});
   const detail=url.pathname.match(/^\/platform\/strategies\/([a-z][a-z0-9-]{2,47})$/);
   if(req.method==='GET'&&detail){const strategy=platform.strategies().find(item=>item.id===detail[1]);return platformReply(strategy?200:404,strategy||{error:'STRATEGY_NOT_FOUND'});}
   if(req.method==='POST'&&url.pathname==='/platform/auth/challenge')return platformReply(200,platform.challenge(body));
   if(req.method==='POST'&&url.pathname==='/platform/strategists')return platformReply(201,platform.enroll(body));
   if(req.method==='POST'&&url.pathname==='/platform/api-keys')return platformReply(201,platform.issueKey(body));
   if(req.method==='POST'&&url.pathname==='/platform/strategies')return platformReply(201,platform.createStrategy(req.headers.authorization,body));
   const submit=url.pathname.match(/^\/platform\/strategies\/([a-z][a-z0-9-]{2,47})\/targets$/);
   if(req.method==='POST'&&submit)return platformReply(202,platform.submitTarget(req.headers.authorization,submit[1],body));
   return platformReply(404,{error:'NOT_FOUND'});
  }
  if(req.method==='GET'&&url.pathname==='/health')return reply(200,{mode:identity.mode,initialized:Boolean(engine)});
  if(req.method==='GET'&&url.pathname==='/attestation'){
   const challenge=url.searchParams.get('challenge');if(!/^[a-f0-9]{64}$/.test(challenge||''))return reply(400,{error:'CHALLENGE'});
   const binding=sha(JSON.stringify({domain:'MM_COHORT_OPERATOR_V1',identity,challenge}));
   const quote=await dstack('/GetQuote',{report_data:binding.padEnd(128,'0')});return reply(200,{identity,challenge,binding,quote});
  }
  if(req.method!=='POST'||!['/initialize','/configure','/execute','/status'].includes(url.pathname))return reply(404,{error:'NOT_FOUND'});
  if(busy)return reply(429,{error:'BUSY'});busy=true;
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>48000000)throw Error('SIZE');chunks.push(chunk);}
   const opened=channel.open(JSON.parse(Buffer.concat(chunks))),m=opened.message;
   if(sha(String(m.token))!==manifest.accessHash||!/^[a-f0-9]{64}$/.test(m.nonce||''))return reply(403,{error:'AUTH'});
   if(seen.has(m.nonce)||seen.size>=40)return reply(409,{error:'REPLAY_OR_CAP'});seen.add(m.nonce);
   try{
    let result;
    if(url.pathname==='/initialize'){
     if(!engine){
      const wasm=Buffer.from(m.wasm,'base64'),zkey=Buffer.from(m.zkey,'base64');
      if(sha(wasm)!==manifest.wasmSha256||sha(zkey)!==manifest.zkeySha256)throw Error('ARTIFACT_MISMATCH');
      mkdirSync('/app/artifacts/perpl-zk/perpl-target-mvp_js',{recursive:true});
      writeFileSync('/app/artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm',wasm,{mode:0o600});
      writeFileSync('/app/artifacts/perpl-zk/perpl-target-mvp.zkey',zkey,{mode:0o600});
      engine=await createOperator({secret,provider:rpc,controller:manifest.controller,chainId:10143,storeDir:'/state'});
     }result={initialized:true};
    }else{
     if(!engine)throw Error('INITIALIZE_REQUIRED');
     if(url.pathname==='/configure'){await engine.configure(m.vault);result={configured:true};}
     if(url.pathname==='/execute')result=await engine.execute(m.intent,m.signature);
     if(url.pathname==='/status')result=engine.status();
    }
    return reply(200,opened.reply({nonce:m.nonce,result}));
   }catch(e){return reply(400,opened.reply({nonce:m.nonce,error:e.shortMessage||e.message}));}
  }finally{busy=false;}
 }catch{return reply(400,{error:'REQUEST_REJECTED'});}
});
server.requestTimeout=180000;server.headersTimeout=15000;
server.listen(8080,'0.0.0.0',()=>console.log('Testnet cohort operator ready; client attestation required'));
