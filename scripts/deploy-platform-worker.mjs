import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const values=Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^['"]|['"]$/g,'')]));
const deployment=JSON.parse(readFileSync('.data/platform-live/deployment.json'));
const dir=`.data/platform-tee-${Date.now()}`;
const env={...process.env,MM_TEE_REUSE_ENDPOINT:values.PLATFORM_TEE_URL,MM_TEE_DIR:dir,OMNIBUS_VAULT_ADDRESS:deployment.vaultAddress,PLATFORM_CASH_TOKEN_ADDRESS:deployment.token,PHALA_CLOUD_API_KEY:values.PHALA_API_TOKEN};
async function run(command,args){const c=spawn(command,args,{env,stdio:'inherit'});const code=await new Promise((resolve,reject)=>{c.on('exit',resolve);c.on('error',reject);});if(code)throw Error(`Deployment step failed: ${command}`);}
await run(process.execPath,['scripts/prepare-cohort-tee.mjs']);
await run('npx',['phala','deploy','--cvm-id','633b691dbe00185be471da9f57b145aba58cbd77','--compose',`${dir}/compose.yaml`,'--wait']);
