import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{randomBytes,createHash}from'node:crypto';
import {verifiedTdxBody,replayTdxEvents} from '../../src/integration/tdx-quote.js';
import {encryptRequest} from '../../src/integration/sealed.js';
export async function connectCohortHardware(){
 const endpoint=process.env.MM_COHORT_TEE_ENDPOINT,client=JSON.parse(readFileSync('.data/cohort-tee/client.json'));
 assert.equal(new URL(endpoint).protocol,'https:');assert.match(client.composeSha256||'',/^[a-f0-9]{64}$/);
 const sha=x=>createHash('sha256').update(x).digest('hex'),challenge=randomBytes(32).toString('hex');
 const response=await fetch(new URL('/attestation?challenge='+challenge,endpoint),{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
 const att=await response.json();assert.equal(att.challenge,challenge);assert.equal(att.identity.mode,'COHORT_TESTNET_OPERATOR');assert.equal(att.identity.chainId,10143);
 for(const [k,v]of Object.entries(client.manifest))assert.deepEqual(att.identity[k],v,'Unexpected manifest '+k);
 const binding=sha(JSON.stringify({domain:'MM_COHORT_OPERATOR_V1',identity:att.identity,challenge}));assert.equal(att.binding,binding);
 const raw=att.quote.quote.replace(/^0x/,'');
 const v=await fetch('https://cloud-api.phala.com/api/v1/attestations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hex:raw}),signal:AbortSignal.timeout(30000)});assert.equal(v.status,200);
 const verified=await v.json(),{body,quoteHash}=verifiedTdxBody(raw,verified),hex=x=>String(x).replace(/^0x/,'').toLowerCase();
 assert.equal(hex(body.reportdata),binding.padEnd(128,'0'));assert.equal(parseInt(hex(body.tdattributes).slice(0,2),16)&1,0);
 const events=typeof att.quote.event_log==='string'?JSON.parse(att.quote.event_log):att.quote.event_log;replayTdxEvents(events,body);
 assert.equal(events.find(x=>x.imr===3&&x.event==='compose-hash')?.event_payload,client.composeSha256);assert.equal(hex(body.mrconfig),'01'+client.composeSha256+'00'.repeat(15));
 const call=async(path,payload={})=>{
  const nonce=randomBytes(32).toString('hex'),session=encryptRequest(att.identity.encryptionPublicKey,{token:client.token,nonce,...payload});
  const r=await fetch(new URL(path,endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(session.packet),signal:AbortSignal.timeout(180000)});
  const result=session.openReply(await r.json());assert.equal(result.nonce,nonce);assert.ok(!result.error,result.error);assert.equal(r.status,200);return result.result;
 };
 return {identity:att.identity,evidence:{...att,quoteHash,composeHash:client.composeSha256,vendorVerification:verified},call};
}
