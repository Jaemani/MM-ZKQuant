import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { groth16, curves } from 'snarkjs';
import { verifiedTdxBody, replayTdxEvents } from '../src/integration/tdx-quote.js';
import { encryptRequest } from '../src/integration/sealed.js';
import { createBookProver, json, PUBLIC_FIELDS } from '../src/zk/book.js';

const endpoint=process.argv[2],composeHash=process.argv[3];
assert.equal(new URL(endpoint).protocol,'https:');
assert.match(composeHash||'',/^[a-f0-9]{64}$/, 'Pass the expected control-plane compose hash as the second argument');
const client=JSON.parse(readFileSync('.data/tee-probe/client.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const challenge=randomBytes(32).toString('hex');
const get=async path=>{const r=await fetch(new URL(path,endpoint),{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r.json();};
const att=await get('/attestation?challenge='+challenge);
assert.equal(att.challenge,challenge);
for(const [k,v] of Object.entries(client.manifest))assert.equal(att.identity[k],v,'Unexpected '+k);
const binding=sha(JSON.stringify({domain:'MM_TEE_PROBE_V1',identity:att.identity,challenge}));
assert.equal(att.binding,binding);
const raw=att.quote.quote.replace(/^0x/,'');
const vr=await fetch('https://cloud-api.phala.com/api/v1/attestations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hex:raw}),signal:AbortSignal.timeout(30000)});
assert.equal(vr.status,200);const verified=await vr.json();
// Keep vendor response local for reproducible inspection without accepting an
// application's self-reported "TEE verified" flag.
writeFileSync('.data/tee-probe/attestation.json',json({att,verified})+'\n',{mode:0o600});
assert.equal(verified.success,true);assert.equal(verified.quote?.verified,true);
const {body,quoteHash}=verifiedTdxBody(raw,verified),hex=x=>String(x).replace(/^0x/,'').toLowerCase();
assert.ok([129,'TEE_TDX'].includes(verified.quote.header.tee_type));
assert.equal(hex(body.reportdata),binding.padEnd(128,'0'));
assert.match(hex(body.tdattributes),/^[0-9a-f]{16}$/);assert.equal(parseInt(hex(body.tdattributes).slice(0,2),16)&1,0);
const events=typeof att.quote.event_log==='string'?JSON.parse(att.quote.event_log):att.quote.event_log;
replayTdxEvents(events,body);
assert.equal(events.find(e=>e.imr===3&&e.event==='compose-hash')?.event_payload,composeHash);
assert.equal(hex(body.mrconfig),'01'+composeHash+'00'.repeat(15));
console.log('TDX quote signature, fresh key binding and RTMR event-log replay passed');
const post=async(path,message)=>{
  const session=encryptRequest(att.identity.encryptionPublicKey,{token:client.token,nonce:randomBytes(32).toString('hex'),...message});
  const response=await fetch(new URL(path,endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(session.packet),signal:AbortSignal.timeout(180000)});
  assert.equal(response.status,200,await response.clone().text());return {result:session.openReply(await response.json()),packet:session.packet};
};
const payload={type:'SYNTHETIC_INTENT',targetBps:2500,book:'test-a',nonce:randomBytes(32).toString('hex')};
const echo=await post('/echo',{payload});assert.equal(echo.result.receivedHash,sha(JSON.stringify(payload)));
const replay=await fetch(new URL('/echo',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(echo.packet),signal:AbortSignal.timeout(30000)});assert.equal(replay.status,409);
const bad=structuredClone(echo.packet);bad.box.tag='00'.repeat(16);
const tamper=await fetch(new URL('/echo',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bad),signal:AbortSignal.timeout(30000)});assert.equal(tamper.status,400);
const prover=await createBookProver(),keys=[randomBytes(32),randomBytes(32)];
const state=prover.initial([1000000n,1000000n],keys),context={chainId:31337,vault:12345,config:42,maxSpendBps:2500};
const order={batch:1,selected:0,buy:1,amount:250000,minOut:100,deadline:1800000000};
const signature=prover.sign(context,order,1,keys[0]),transition=prover.transition(state,context,order,signature);
console.log('Sending encrypted synthetic witness and pinned proving artifacts to TDX');
const proofResponse=await post('/prove',{input:JSON.parse(json(transition.input)),wasm:readFileSync('artifacts/zk/book-transition_js/book-transition.wasm').toString('base64'),zkey:readFileSync('artifacts/zk/book-transition.zkey').toString('base64')});
try{
  const result=proofResponse.result;assert.deepEqual(result.publicSignals,PUBLIC_FIELDS.map(f=>String(transition.input[f])));
  const vk=JSON.parse(readFileSync('artifacts/zk/verification-key.json'));
  assert.equal(await groth16.verify(vk,result.publicSignals,result.proof),true);
  const evidence={createdAt:new Date().toISOString(),status:'PASS_HARDWARE_PROBE_VIA_PHALA_DCAP',hardwareQuoteVerified:true,productionEnrollment:false,externalNetworkBroadcast:false,endpoint,manifest:client.manifest,composeSha256:client.composeSha256,quoteHash,controlPlaneComposeHash:composeHash,measurements:Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2','rtmr3'].map(k=>[k,body[k]])),checks:['Phala hosted DCAP verification of exact quote','Fresh challenge and encryption key binding','TDX debug bit disabled','RTMR event log replay','Control-plane compose hash matches signed mrconfig and replayed event','Encrypted synthetic input/response','Encrypted request replay rejected','Ciphertext tamper rejected','Groth16 proof generated by remote research service and verified locally'],proof:{proof:result.proof,publicSignals:result.publicSignals,milliseconds:result.milliseconds,maxRssKiB:result.maxRssKiB},limitations:['Hosted Phala DCAP verifier trusted','OS/KMS governance and independent measurement allowlist enrollment not completed','Reported source/lock/artifact hashes match local manifest; complete measured boot-to-application provenance still requires enrollment review','Synthetic fixture only: not a live TEE-to-DEX custody session','No persistent ledger recovery or production keys','CVM must be stopped/deleted after experiment; application timeout does not stop billing']};
  writeFileSync('docs/evidence/tee-hardware-probe.json',json(evidence)+'\n');
  console.log(json({status:evidence.status,milliseconds:result.milliseconds,maxRssKiB:result.maxRssKiB,evidence:'docs/evidence/tee-hardware-probe.json'}));
}finally{await(await curves.getCurveFromName('bn128')).terminate();}
