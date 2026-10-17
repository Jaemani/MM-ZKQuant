// Temporary, authenticated TEE-to-TEE transfer agent. No plaintext key or
// ledger snapshot is returned to the migration client or written to logs.
import {createServer,request} from 'node:http';
import {createHash,createECDH,timingSafeEqual} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync,renameSync,existsSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {SealedStore,encryptionIdentity,encryptRequest} from '../../../src/integration/sealed.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const publicKey=secret=>{const key=createECDH('secp256k1');key.setPrivateKey(secret);return key.getPublicKey('hex','compressed');};
const maxBytes=180_000_000;

export function snapshotFiles(directory) {
  const files={};let bytes=0;
  function walk(relative='') {
    for(const name of readdirSync(join(directory,relative)).sort()){
      if(name.startsWith('.migration-')||name==='operator-identity.json')continue;
      const path=relative?relative+'/'+name:name,stat=lstatSync(join(directory,path));
      if(stat.isSymbolicLink())throw Error('SNAPSHOT_SYMLINK');
      if(stat.isDirectory()){walk(path);continue;}
      if(!stat.isFile())throw Error('SNAPSHOT_FILE_TYPE');
      bytes+=stat.size;if(bytes>100_000_000)throw Error('SNAPSHOT_SIZE');
      files[path]=gzipSync(readFileSync(join(directory,path))).toString('base64');
    }
  }
  walk();return {encoding:'gzip-base64-v1',files,sha256:sha(JSON.stringify(files))};
}

export function validateSnapshot(snapshot,{sourceAppId,targetAppId,sourceEncryptionPublicKey}) {
  if(snapshot?.version!==1||snapshot.sourceAppId!==sourceAppId||snapshot.targetAppId!==targetAppId)throw Error('SNAPSHOT_DOMAIN');
  if(snapshot.encoding!=='gzip-base64-v1')throw Error('SNAPSHOT_ENCODING');
  if(!/^[a-f0-9]{64}$/.test(snapshot.secret||'')||publicKey(Buffer.from(snapshot.secret,'hex'))!==sourceEncryptionPublicKey)throw Error('SNAPSHOT_IDENTITY');
  if(!snapshot.files||Object.getPrototypeOf(snapshot.files)!==Object.prototype||sha(JSON.stringify(snapshot.files))!==snapshot.sha256)throw Error('SNAPSHOT_HASH');
  let bytes=0;
  for(const[path,data]of Object.entries(snapshot.files)){
    if(!/^[a-zA-Z0-9_.\/-]+$/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||path==='operator-identity.json'||path.startsWith('.migration-'))throw Error('SNAPSHOT_PATH');
    if(typeof data!=='string'||data.length>140_000_000||Buffer.from(data,'base64').toString('base64')!==data)throw Error('SNAPSHOT_ENCODING');
    bytes+=gunzipSync(Buffer.from(data,'base64'),{maxOutputLength:100_000_000}).length;if(bytes>100_000_000)throw Error('SNAPSHOT_SIZE');
  }
  if(!Object.keys(snapshot.files).length)throw Error('SNAPSHOT_EMPTY');
  return {sha256:snapshot.sha256,files:Object.keys(snapshot.files).length,bytes};
}

export function restoreSnapshot(snapshot,{storeDir,derivedSecret,...domain}) {
  const summary=validateSnapshot(snapshot,domain),marker=join(storeDir,'.migration-complete.json');
  if(existsSync(marker)){
    const prior=JSON.parse(readFileSync(marker));
    if(prior.sha256!==summary.sha256)throw Error('MIGRATION_ALREADY_IMPORTED');
    return {...summary,replayed:true};
  }
  const incoming=join(storeDir,'.migration-incoming');mkdirSync(incoming,{recursive:true,mode:0o700});
  for(const[path,data]of Object.entries(snapshot.files)){
    const target=join(incoming,path);mkdirSync(join(target,'..'),{recursive:true,mode:0o700});
    writeFileSync(target,gunzipSync(Buffer.from(data,'base64'),{maxOutputLength:100_000_000}),{mode:0o600,flush:true});
  }
  for(const path of Object.keys(snapshot.files)){
    const target=join(storeDir,path);mkdirSync(join(target,'..'),{recursive:true,mode:0o700});renameSync(join(incoming,path),target);
  }
  for(const directory of new Set([storeDir,...Object.keys(snapshot.files).map(path=>join(storeDir,path,'..'))])){
    const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  }
  new SealedStore(join(storeDir,'operator-identity.json'),derivedSecret,'operator-identity-migration-v1').write({version:1,sourceAppId:snapshot.sourceAppId,targetAppId:snapshot.targetAppId,secret:snapshot.secret});
  writeFileSync(marker,JSON.stringify({...summary,sourceAppId:snapshot.sourceAppId,targetAppId:snapshot.targetAppId}),{mode:0o600,flush:true});
  const fd=openSync(storeDir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  return {...summary,replayed:false};
}

function socketJson(socketPath,path,body,method='POST') {
  return new Promise((resolve,reject)=>{
    const data=body===undefined?undefined:JSON.stringify(body);
    const req=request({socketPath,path,method,headers:data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;if(text.length>8_000_000)req.destroy(Error('SOCKET_RESPONSE_SIZE'));});
      res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('SOCKET_HTTP_'+res.statusCode));try{resolve(text?JSON.parse(text):{});}catch{reject(Error('SOCKET_JSON'));}});
    });req.on('error',reject);req.setTimeout(20000,()=>req.destroy(Error('SOCKET_TIMEOUT')));req.end(data);
  });
}

async function pauseOperator(resume=false) {
  const filters=encodeURIComponent(JSON.stringify({label:['com.docker.compose.service=operator']}));
  const containers=await socketJson('/var/run/docker.sock','/containers/json?all=1&filters='+filters,undefined,'GET');
  if(containers.length!==1)throw Error('OPERATOR_CONTAINER_COUNT');
  const container=containers[0];
  if(resume){if(container.State==='paused')await socketJson('/var/run/docker.sock',`/containers/${container.Id}/unpause`);return;}
  if(container.State==='running')await socketJson('/var/run/docker.sock',`/containers/${container.Id}/pause`);
  else if(!['paused','exited','created'].includes(container.State))throw Error('OPERATOR_NOT_QUIESCENT');
  return container.Id;
}

export async function runAgent(config) {
  const dstack=(path,body)=>socketJson('/var/run/dstack.sock',path,body);
  const derived=await dstack('/GetKey',{path:'mm/cohort/'+config.experimentId,purpose:'testnet-operator',algorithm:'secp256k1'});
  const derivedSecret=Buffer.from(derived.key,'hex');let secret=derivedSecret;
  if(config.mode==='source'&&config.identityMigration){const saved=new SealedStore('/state/operator-identity.json',derivedSecret,'operator-identity-migration-v1').read();if(!saved)throw Error('SOURCE_IDENTITY_MISSING');secret=Buffer.from(saved.secret,'hex');}
  if(publicKey(secret)!==config.identity.encryptionPublicKey)throw Error('AGENT_IDENTITY_MISMATCH');
  const channel=encryptionIdentity(secret,{maxHexLength:maxBytes*2});let busy=false;
  const authenticate=token=>{
    const expected=Buffer.from(config.accessHash,'hex'),actual=createHash('sha256').update(String(token||'')).digest();
    if(expected.length!==32||!timingSafeEqual(expected,actual))throw Error('MIGRATION_AUTH');
  };
  const server=createServer(async(req,res)=>{
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/attestation'){
        const challenge=url.searchParams.get('challenge');if(!/^[a-f0-9]{64}$/.test(challenge||''))throw Error('CHALLENGE');
        const identity={...config.identity,migrationAgentHash:sha(readFileSync(new URL(import.meta.url))),migrationConfigHash:sha(JSON.stringify(config))};
        const binding=sha(JSON.stringify({domain:'MM_COHORT_OPERATOR_V1',identity,challenge}));
        const quote=await dstack('/GetQuote',{report_data:binding.padEnd(128,'0')});return reply(200,{identity,challenge,binding,quote});
      }
      if(req.method!=='POST'||url.pathname!=='/migration')return reply(404,{error:'NOT_FOUND'});
      if(busy)return reply(409,{error:'MIGRATION_BUSY'});busy=true;
      try{
        let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Error('REQUEST_SIZE');chunks.push(chunk);}
        const opened=channel.open(JSON.parse(Buffer.concat(chunks))),input=opened.message;authenticate(input.accessToken);
        if(config.mode==='source'&&input.action==='EXPORT'){
          if(!/^[a-f0-9]{64}$/.test(input.targetAccessToken||''))throw Error('TARGET_TOKEN');
          await pauseOperator();
          const snapshot={version:1,sourceAppId:config.sourceAppId,targetAppId:config.targetAppId,secret:secret.toString('hex'),...snapshotFiles('/state')};
          const packet=encryptRequest(config.targetEncryptionPublicKey,{action:'IMPORT',accessToken:input.targetAccessToken,snapshot}).packet;
          return reply(200,{packet,sha256:snapshot.sha256,files:Object.keys(snapshot.files).length});
        }
        if(config.mode==='source'&&input.action==='RESUME'){
          await pauseOperator(true);return reply(200,{reply:opened.reply({resumed:true})});
        }
        if(config.mode==='target'&&input.action==='STATUS'){
          const path='/state/.migration-complete.json';
          return reply(200,{reply:opened.reply(existsSync(path)?{imported:true,...JSON.parse(readFileSync(path))}:{imported:false})});
        }
        if(config.mode==='target'&&input.action==='IMPORT'){
          validateSnapshot(input.snapshot,config);
          const containerId=existsSync('/state/.migration-complete.json')?null:await pauseOperator();
          const result=restoreSnapshot(input.snapshot,{...config,storeDir:'/state',derivedSecret});
          // Discard only the empty standby container, never its persistent volume.
          // It must not resume with its old in-memory, pre-import journal.
          if(containerId)await socketJson('/var/run/docker.sock',`/containers/${containerId}?force=true`,undefined,'DELETE');
          return reply(200,{reply:opened.reply({imported:true,...result})});
        }
        throw Error('MIGRATION_ACTION');
      }finally{busy=false;}
    }catch{reply(400,{error:'MIGRATION_REJECTED'});}
  });
  server.listen(8090,'0.0.0.0');return server;
}

if(process.env.MMQ_MIGRATION_CONFIG)await runAgent(JSON.parse(process.env.MMQ_MIGRATION_CONFIG));
