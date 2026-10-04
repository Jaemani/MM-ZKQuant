// Historical hardware evidence recheck; live client challenge was checked during execution.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifiedTdxBody,replayTdxEvents} from '../src/integration/tdx-quote.js';
const report=JSON.parse(readFileSync('docs/evidence/perpl-tee-testnet-mvp.json'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>String(x).replace(/^0x/,'').toLowerCase();
const expectedCompose='ade408600a55ad9d302ae86c05be8855a17bf00a60b495c3bb7e600a6e67489e';
const result={observedAt:new Date().toISOString(),status:'RUNNING',quotes:[],proofCount:0,
 limitations:['Historical quote verification is not a fresh live challenge','Archived proof responses are not separately hardware-signed; live encrypted response binding was checked by the client','Client signing and public relaying remain outside TEE']};
try {
 assert.equal(report.hardwareTEE,true);assert.equal(report.status,'PASS_PUBLIC_TESTNET_ZK_ROUNDTRIP');
 const quotes=new Map();
 for(const proof of Object.values(report.proofs)){
  assert.ok(proof.tee,'Missing per-proof hardware provenance');result.proofCount++;
  if(quotes.has(proof.tee.quoteHash))assert.deepEqual(quotes.get(proof.tee.quoteHash),proof.tee,'Conflicting metadata for one quote');
  quotes.set(proof.tee.quoteHash,proof.tee);
 }
 assert.ok(result.proofCount>=4);
 for(const [hash,e] of quotes){
  assert.equal(e.composeHash,expectedCompose);
  assert.equal(e.identity.mode,'HARDWARE_PROBE_NOT_CUSTODY');
  const binding=sha(JSON.stringify({domain:'MM_TEE_PROBE_V1',identity:e.identity,challenge:e.challenge}));
  assert.equal(binding,e.binding);
  assert.equal(e.identity.sourceHash,sha(Buffer.concat([readFileSync('deploy/tee/probe/server.mjs'),readFileSync('src/integration/sealed.js')])));
  assert.equal(e.identity.lockSha256,sha(readFileSync('deploy/tee/probe/package-lock.json')));
  assert.equal(e.identity.circuitSha256,sha(readFileSync('circuits/perpl-target-mvp.circom')));
  const raw=e.quote.quote.replace(/^0x/,'');
  const response=await fetch('https://cloud-api.phala.com/api/v1/attestations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hex:raw}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);const verified=await response.json();
  assert.equal(verified.success,true);assert.equal(verified.quote?.verified,true);
  const {body,quoteHash}=verifiedTdxBody(raw,verified);assert.equal(quoteHash,hash);
  assert.ok([129,'TEE_TDX'].includes(verified.quote.header.tee_type));
  assert.equal(hex(body.reportdata),binding.padEnd(128,'0'));
  assert.equal(parseInt(hex(body.tdattributes).slice(0,2),16)&1,0);
  const events=typeof e.quote.event_log==='string'?JSON.parse(e.quote.event_log):e.quote.event_log;
  replayTdxEvents(events,body);
  assert.equal(events.find(x=>x.imr===3&&x.event==='compose-hash')?.event_payload,expectedCompose);
  assert.equal(hex(body.mrconfig),'01'+expectedCompose+'00'.repeat(15));
  result.quotes.push({quoteHash,composeHash:e.composeHash,verified:true});
 }
 result.status='PASS_HISTORICAL_TDX_QUOTE_REVERIFICATION';
} catch(e){result.status='FAIL';result.error=e.message;process.exitCode=1;}
writeFileSync('docs/evidence/perpl-tee-testnet-attestation-audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
