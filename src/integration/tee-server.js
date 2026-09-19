import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DstackClient } from '@phala/dstack-sdk';
import { Wallet, JsonRpcProvider } from 'ethers';
import { SealedStore, encryptionIdentity } from './sealed.js';
import { ConfidentialCoordinator } from './coordinator.js';
import { hash, compileApprovedVault } from './protocol.js';
import { identityBinding } from './attestation.js';

// There is intentionally no development fallback in this server. A missing
// hardware socket is a startup error, never a green "TEE" indicator.
if(process.env.DSTACK_SIMULATOR_ENDPOINT)throw Error('Simulator forbidden in hardware service');
const config=JSON.parse(process.env.MM_TEE_CONFIG_JSON||readFileSync(process.env.MM_TEE_CONFIG||'/run/config/integration.json','utf8'));
if(![143,10143].includes(config.chainId))throw Error('Hardware service requires a public-network config');
const dstack=new DstackClient('/var/run/dstack.sock');
const signing=await dstack.getKey('mm/approval/'+hash(config),'vault-approval','secp256k1');
const encryption=await dstack.getKey('mm/ingress/'+hash(config),'encrypted-input','secp256k1');
const storage=await dstack.getKey('mm/storage/'+hash(config),'ledger-storage','secp256k1');
const wallet=new Wallet('0x'+Buffer.from(signing.key).toString('hex')),channel=encryptionIdentity(encryption.key);
const identity={signer:wallet.address,encryptionPublicKey:channel.publicKey,configHash:hash(config),policyHash:hash(config.policy),vault:config.vault,chainId:config.chainId,contractSourceHash:compileApprovedVault().sourceHash};
const provider=new JsonRpcProvider(config.rpcUrl,undefined,{batchMaxCount:1,cacheTimeout:-1});
const store=new SealedStore(resolve(process.env.MM_SEALED_STATE||'/data/ledger.sealed.json'),storage.key,hash(config));
let runtime;
async function coordinator(){if(!runtime)runtime=await new ConfidentialCoordinator({provider,wallet,store,config}).initialize();return runtime;}
const server=createServer(async(req,res)=>{
  const respond=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health')return respond(200,{service:'MM confidential execution PoC',hardwareVerification:'CLIENT_REQUIRED',configured:true});
    if(req.method==='GET'&&url.pathname==='/attestation'){
      const challenge=url.searchParams.get('challenge');if(!/^[0-9a-f]{64}$/i.test(challenge||''))return respond(400,{error:'32-byte challenge required'});
      const quote=await dstack.getQuote(Buffer.from(identityBinding(identity,challenge).slice(2),'hex'));
      return respond(200,{mode:'DSTACK_TDX',challenge,identity,quote:quote.quote,event_log:quote.event_log,vm_config:quote.vm_config});
    }
    if(req.method!=='POST'||url.pathname!=='/command')return respond(404,{error:'Not found'});
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>131072)return respond(413,{error:'Payload too large'});chunks.push(chunk);}
    const opened=channel.open(JSON.parse(Buffer.concat(chunks)));
    // All command results, including semantic failures and investor data, are
    // encrypted to the ephemeral client session. No plaintext request logging.
    try {return respond(200,opened.reply({ok:true,result:await (await coordinator()).command(opened.message)}));}
    catch(error){return respond(200,opened.reply({ok:false,error:error.message}));}
  }catch{return respond(400,{error:'Request could not be processed'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Confidential execution endpoint ready; client attestation verification required'));
