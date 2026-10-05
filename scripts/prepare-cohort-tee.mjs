import {gzipSync} from 'node:zlib';
import { compilePlatformSharedAccount } from './deploy-omnibus-vault.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import{createHash,randomBytes}from'node:crypto';
const dir=process.env.MM_TEE_DIR||'.data/cohort-tee';mkdirSync(dir,{recursive:true,mode:0o700});
if(existsSync(dir+'/client.json'))throw Error('Existing experiment: do not overwrite keys/manifest; inspect or resume it');
const sha=x=>createHash('sha256').update(x).digest('hex');
const reuseEndpoint=process.env.MM_TEE_REUSE_ENDPOINT?.replace(/\/$/,'');
let reused=null;
if(reuseEndpoint){
 const response=await fetch(`${reuseEndpoint}/attestation?challenge=${randomBytes(32).toString('hex')}`,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Cannot read existing TEE identity');
 reused=(await response.json()).identity;
 if(!reused?.experimentId||!reused?.accessHash||!reused?.controller)throw Error('Existing TEE identity is incomplete');
}
const token=reused?null:randomBytes(32).toString('hex');
const runtime=['deploy/tee/operator/server.mjs','deploy/tee/operator/engine.mjs','deploy/tee/operator/platform.mjs','deploy/tee/operator/investments.mjs','protocol/cohort/durable-submitter.mjs','protocol/perpl/target-prover.mjs','src/platform/investment-message.js','src/integration/sealed.js'];
const files=Object.fromEntries(runtime.map(p=>[p,readFileSync(p)]));
for(const p of ['deploy/tee/operator/execution.mjs','deploy/tee/operator/shared-accounts.mjs','deploy/tee/operator/ledger.mjs','src/platform/policy.js','src/platform/execution-errors.js','src/platform/vault-retirement.js','protocol/perpl/exchange-abi.json']) {runtime.push(p);files[p]=readFileSync(p);}
files['package.json']=readFileSync('deploy/tee/operator/package.json');files['package-lock.json']=readFileSync('deploy/tee/operator/package-lock.json');
const sharedArtifact='artifacts/platform/shared-account.json';
files[sharedArtifact]=Buffer.from(JSON.stringify(await compilePlatformSharedAccount()));runtime.push(sharedArtifact);
for(const p of ['circuits/perpl-target-mvp.circom','artifacts/perpl-zk/TargetVerifier.sol','artifacts/perpl-zk/verification-key.json'])files[p]=readFileSync(p);
// R1CS is a build input, not needed by the enclave. Pin the proving runtime files only.
const hashes=Object.fromEntries(['circuits/perpl-target-mvp.circom','artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm','artifacts/perpl-zk/perpl-target-mvp.zkey','artifacts/perpl-zk/TargetVerifier.sol'].map(p=>[p,sha(readFileSync(p))]));
files['artifacts/perpl-zk/build.json']=Buffer.from(JSON.stringify({sha256:hashes}));
const manifest={controller:reused?.controller||'0xA761529aE65a0966125C47911DEDCC7F23951D57',experimentId:reused?.experimentId||randomBytes(16).toString('hex'),sourceHashes:Object.fromEntries(runtime.map(p=>[p,sha(files[p])])),lockSha256:sha(files['package-lock.json']),wasmSha256:hashes['artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm'],zkeySha256:hashes['artifacts/perpl-zk/perpl-target-mvp.zkey'],accessHash:reused?.accessHash||sha(token),...(process.env.OMNIBUS_VAULT_ADDRESS&&process.env.PLATFORM_CASH_TOKEN_ADDRESS?{omnibusVault:process.env.OMNIBUS_VAULT_ADDRESS,cashToken:process.env.PLATFORM_CASH_TOKEN_ADDRESS}:{})};
files['manifest.json']=Buffer.from(JSON.stringify(manifest));
const entries=Object.entries(files).map(([p,b])=>[p,b.toString('base64')]);
const bootstrap=`const fs=require('fs'),path=require('path');for(const [p,b] of ${JSON.stringify(entries)}){fs.mkdirSync(path.dirname('/app/'+p),{recursive:true});fs.writeFileSync('/app/'+p,Buffer.from(b,'base64'));}`;
const boot=`node -e 'eval(require("zlib").gunzipSync(Buffer.from("${gzipSync(Buffer.from(bootstrap)).toString('base64')}","base64")).toString())'`;
const compose={services:{operator:{image:'node:22.23.0-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2',working_dir:'/app',entrypoint:['sh','-c',`${boot} && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && exec node deploy/tee/operator/server.mjs`],ports:['8080:8080'],volumes:['/var/run/dstack.sock:/var/run/dstack.sock','operator-state:/state'],tmpfs:['/app:rw,size=1024m'],restart:'no',mem_limit:'1536m'}},volumes:{'operator-state':{}}};
writeFileSync(dir+'/compose.yaml',JSON.stringify(compose,null,2)+'\n',{mode:0o600});
writeFileSync(dir+'/client.json',JSON.stringify({token,manifest,composeSha256:null,reusedIdentity:Boolean(reused)},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({prepared:true,reusedIdentity:Boolean(reused),runtimeFiles:runtime,composeBytes:JSON.stringify(compose).length,budgetUSD:2}));
