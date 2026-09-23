import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { groth16 } from 'snarkjs';
import { AbiCoder } from 'ethers';
import { verifiedTdxBody, replayTdxEvents } from '../../src/integration/tdx-quote.js';
import { encryptRequest } from '../../src/integration/sealed.js';
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
export async function createHardwareTargetProver() {
const endpoint=process.env.MM_PERPL_TEE_ENDPOINT;
const client=JSON.parse(readFileSync('.data/perpl-tee-mvp/client.json'));
const composeHash=client.composeSha256;
assert.equal(new URL(endpoint).protocol,'https:');
assert.match(composeHash||'',/^[a-f0-9]{64}$/, 'Pass the expected control-plane compose hash as the second argument');

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
writeFileSync('.data/perpl-tee-mvp/attestation.json',json({att,verified})+'\n',{mode:0o600});
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
const vk=JSON.parse(readFileSync('artifacts/perpl-zk/verification-key.json'));
const wasm=readFileSync('artifacts/perpl-zk/perpl-target-mvp_js/perpl-target-mvp.wasm');
const zkey=readFileSync('artifacts/perpl-zk/perpl-target-mvp.zkey');
assert.equal(sha(wasm),client.manifest.wasmSha256);
assert.equal(sha(zkey),client.manifest.zkeySha256);
const evidence={provider:'Phala',mode:att.identity.mode,challenge,binding,quoteHash,composeHash,identity:att.identity,quote:att.quote,vendorVerification:verified,scope:'Fresh vendor-verified TDX quote, bound encryption key, RTMR replay; remote proving only. Relayer and Perpl fork remain local.'};
let count=0;
const prove=async witness=>{
  assert.ok(++count<=12,'Hardware experiment request limit');
  const nonce=randomBytes(32).toString('hex');
  const session=encryptRequest(att.identity.encryptionPublicKey,{token:client.token,nonce,input:JSON.parse(json(witness)),wasm:wasm.toString('base64'),zkey:zkey.toString('base64')});
  const response=await fetch(new URL('/prove',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(session.packet),signal:AbortSignal.timeout(180000)});
  assert.equal(response.status,200,'TEE proof request failed');
  const result=session.openReply(await response.json());
  assert.equal(result.nonce,nonce);
  assert.deepEqual(result.publicSignals,witness.pub.map(String));
  assert.equal(await groth16.verify(vk,result.publicSignals,result.proof),true);
  const args=JSON.parse('['+await groth16.exportSolidityCallData(result.proof,result.publicSignals)+']');
  return {...result,encodedProof:AbiCoder.defaultAbiCoder().encode(['uint256[2]','uint256[2][2]','uint256[2]'],args.slice(0,3))};
};
return {prove,evidence};
}
