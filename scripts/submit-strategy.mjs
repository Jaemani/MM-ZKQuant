// MMQ_API_TOKEN is read only from the environment, never printed or sent in plaintext to Vercel.
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {encryptRequest} from '../src/integration/sealed.js';
const strategyId=process.argv[2],file=process.argv[3];
if(!strategyId||!process.env.MMQ_API_TOKEN)throw Error('Usage: MMQ_API_TOKEN=... node scripts/submit-strategy.mjs STRATEGY_UUID [targets.json]');
const config=await(await fetch('https://mm-zkquant.vercel.app/api/v1/config')).json();
async function send(message){const channel=encryptRequest(config.teeEncryptionPublicKey,{apiKey:process.env.MMQ_API_TOKEN,strategyId,...message});const r=await fetch(`${config.teeEndpoint}/platform/encrypted-strategy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(channel.packet)});const body=await r.json();if(!r.ok)throw Error(body.error);const result=channel.openReply(body.reply);if(result.error)throw Error(result.error);return result;}
const status=await send({action:'STATUS'});
if(!file)console.log(JSON.stringify(status,null,2));
else{const targets=JSON.parse(readFileSync(file,'utf8'));console.log(JSON.stringify(await send({action:'TARGET',targets,sequence:status.sequence+1,requestId:randomUUID()}),null,2));}
