import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {encryptRequest} from '../src/integration/sealed.js';
export const environment={...(existsSync('.env')?Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^['"]|['"]$/g,'')])):{}),...process.env};
const configuredRpc=environment.MONAD_TESTNET_RPC_URL||'https://testnet-rpc.monad.xyz';
export const rpcUrl=configuredRpc.includes('://')?configuredRpc:`https://${configuredRpc}`;
export const apiBase=(environment.MMQ_API_URL||'https://mm-zkquant.vercel.app/api').replace(/\/$/,'');
export function savePrivate(path,value){mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path+'.pending',JSON.stringify(value,null,2)+'\n',{mode:0o600,flush:true});renameSync(path+'.pending',path);}
export async function api(path,{body,token}={}){
 const response=await fetch(apiBase+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(28000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||`API_HTTP_${response.status}`);return result;
}
export async function tee(config,path,message){
 const channel=encryptRequest(config.teeEncryptionPublicKey,message),response=await fetch(config.teeEndpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(channel.packet),signal:AbortSignal.timeout(45000)}),result=await response.json();
 if(!response.ok||!result.reply)throw Error(result.error||`TEE_HTTP_${response.status}`);
 const opened=channel.openReply(result.reply);if(opened.error)throw Error(opened.error);return opened;
}
