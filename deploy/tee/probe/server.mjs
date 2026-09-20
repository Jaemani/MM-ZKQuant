// Short-lived hardware experiment, no custody keys or chain broadcast.
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { groth16 } from 'snarkjs';
import { encryptionIdentity } from './sealed.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync('/app/manifest.json'));
if(process.env.DSTACK_SIMULATOR_ENDPOINT)throw Error('Simulator forbidden');
const dstack=(path,payload)=>new Promise((resolve,reject)=>{
  const body=JSON.stringify(payload),r=request({socketPath:'/var/run/dstack.sock',path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
    let data='';res.on('data',b=>{data+=b;if(data.length>2000000)r.destroy(Error('Oversize dstack response'));});
    res.on('end',()=>{try{if(res.statusCode!==200)throw Error('dstack status '+res.statusCode);const value=JSON.parse(data);if(value.error)throw Error('dstack rejected request');resolve(value);}catch(e){reject(e);}});
  });r.on('error',reject);r.setTimeout(15000,()=>r.destroy(Error('dstack timeout')));r.end(body);
});
const key=await dstack('/GetKey',{path:'mm/research-probe/'+manifest.sourceHash,purpose:'encrypted-test-ingress',algorithm:'secp256k1'});
const channel=encryptionIdentity(Buffer.from(key.key,'hex'),{maxHexLength:48_000_000});
const identity={mode:'HARDWARE_PROBE_NOT_CUSTODY',encryptionPublicKey:channel.publicKey,...manifest};
let busy=false;
const used=new Set();
const server=createServer(async(req,res)=>{
  const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health')return reply(200,{mode:identity.mode,hardwareVerification:'CLIENT_REQUIRED'});
    if(req.method==='GET'&&url.pathname==='/attestation'){
      const challenge=url.searchParams.get('challenge');if(!/^[a-f0-9]{64}$/.test(challenge||''))return reply(400,{error:'Challenge required'});
      const binding=sha(JSON.stringify({domain:'MM_TEE_PROBE_V1',identity,challenge}));
      const quote=await dstack('/GetQuote',{report_data:binding.padEnd(128,'0')});
      return reply(200,{identity,challenge,binding,quote});
    }
    if(req.method!=='POST'||!['/echo','/prove'].includes(url.pathname))return reply(404,{error:'Not found'});
    if(busy)return reply(429,{error:'Busy'});
    let size=0;const chunks=[];
    for await(const c of req){size+=c.length;if(size>48000000)return reply(413,{error:'Too large'});chunks.push(c);}
    const opened=channel.open(JSON.parse(Buffer.concat(chunks))),m=opened.message;
    if(sha(String(m.token))!==manifest.accessHash)return reply(403,{error:'Unauthorized'});
    if(!/^[a-f0-9]{64}$/.test(m.nonce||'')||used.has(m.nonce))return reply(409,{error:'Replay'});
    if(used.size>=20)return reply(429,{error:'Experiment request cap'});
    used.add(m.nonce);
    if(url.pathname==='/echo')return reply(200,opened.reply({nonce:m.nonce,receivedHash:sha(JSON.stringify(m.payload))}));
    busy=true;const dir=mkdtempSync('/work/proof-');
    try{
      const wasm=Buffer.from(m.wasm,'base64'),zkey=Buffer.from(m.zkey,'base64');
      if(sha(wasm)!==manifest.wasmSha256||sha(zkey)!==manifest.zkeySha256)throw Error('Artifact mismatch');
      // /work is tmpfs, never the persistent disk. Only synthetic test witnesses.
      writeFileSync(dir+'/circuit.wasm',wasm,{mode:0o600});writeFileSync(dir+'/circuit.zkey',zkey,{mode:0o600});
      const start=performance.now();
      const p=await groth16.fullProve(m.input,dir+'/circuit.wasm',dir+'/circuit.zkey',undefined,undefined,{singleThread:true});
      return reply(200,opened.reply({nonce:m.nonce,...p,milliseconds:Math.round(performance.now()-start),maxRssKiB:process.resourceUsage().maxRSS}));
    }catch{return reply(400,opened.reply({error:'Proof request failed'}));}
    finally{rmSync(dir,{recursive:true,force:true});busy=false;}
  }catch{return reply(400,{error:'Request rejected'});}
});
server.requestTimeout=120000;server.headersTimeout=15000;
server.listen(8080,'0.0.0.0',()=>console.log('Research probe ready; no custody or chain broadcast'));
// Ends the application, not VM billing. Operator must stop/delete the CVM.
setTimeout(()=>server.close(()=>process.exit(0)),25*60*1000).unref();
