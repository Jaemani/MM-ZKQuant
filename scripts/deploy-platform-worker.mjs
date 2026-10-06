import {existsSync,readFileSync} from 'node:fs';
import {teeAttestationPolicy} from '../src/platform/tee-attestation-policy.js';
import {isAddress} from 'ethers';
import {spawn} from 'node:child_process';
const values=Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^['"]|['"]$/g,'')]));
const shared=process.argv.includes('--shared');
const deploymentPath=shared?'.data/platform-live/shared-deployment.json':'.data/platform-live/deployment.json';
if(shared&&!existsSync(deploymentPath))throw Error('--shared requires a staged .data/platform-live/shared-deployment.json; omit --shared to keep the existing Vault');
const deployment=existsSync(deploymentPath)?JSON.parse(readFileSync(deploymentPath,'utf8')):{vaultAddress:process.env.OMNIBUS_VAULT_ADDRESS||values.OMNIBUS_VAULT_ADDRESS,token:process.env.PLATFORM_CASH_TOKEN_ADDRESS||values.PLATFORM_CASH_TOKEN_ADDRESS};
if(!isAddress(deployment.vaultAddress||'')||!isAddress(deployment.token||''))throw Error('Set the existing OMNIBUS_VAULT_ADDRESS and PLATFORM_CASH_TOKEN_ADDRESS in .env, or restore .data/platform-live/deployment.json');
values.PLATFORM_TEE_URL=process.env.PLATFORM_TEE_URL||values.PLATFORM_TEE_URL;
if(!values.PLATFORM_TEE_URL||!URL.canParse(values.PLATFORM_TEE_URL)||new URL(values.PLATFORM_TEE_URL).protocol!=='https:')throw Error('Set PLATFORM_TEE_URL to the existing HTTPS Phala endpoint; identity must be reused');
const dir=`.data/platform-tee-${Date.now()}`;
const env={...process.env,MM_TEE_PINNED_WASM_SHA256:teeAttestationPolicy.wasmSha256,MM_TEE_PINNED_ZKEY_SHA256:teeAttestationPolicy.zkeySha256,MM_TEE_REUSE_ENDPOINT:values.PLATFORM_TEE_URL,MM_TEE_DIR:dir,OMNIBUS_VAULT_ADDRESS:deployment.vaultAddress,PLATFORM_CASH_TOKEN_ADDRESS:deployment.token,PHALA_CLOUD_API_KEY:values.PHALA_API_TOKEN};
const recovery=process.argv.find(arg=>arg.startsWith('--resume-manifest='));
if(recovery)env.MM_TEE_REUSE_MANIFEST_PATH=recovery.slice('--resume-manifest='.length);
async function run(command,args){const c=spawn(command,args,{env,stdio:'inherit'});const code=await new Promise((resolve,reject)=>{c.on('exit',resolve);c.on('error',reject);});if(code)throw Error(`Deployment step failed: ${command}`);}
await run(process.execPath,['scripts/prepare-cohort-tee.mjs']);
await run('npx',['phala','deploy','--cvm-id','633b691dbe00185be471da9f57b145aba58cbd77','--compose',`${dir}/compose.yaml`,'--wait']);
// A staged v2 Vault intentionally precedes the public config activation.
if(!process.argv.includes('--shared'))await run(process.execPath,['scripts/verify-platform-gas.mjs']);
