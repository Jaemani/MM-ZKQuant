// Verify the deployed control-plane compose, exact source files and fresh DCAP quote before updating pins.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {environment,savePrivate} from './platform-ops.mjs';
import {teeAttestationPolicy as previous} from '../src/platform/tee-attestation-policy.js';
import {verifyPlatformTee} from '../src/platform/tee-attestation.js';
import {verifiedTdxBody,replayTdxEvents} from '../src/integration/tdx-quote.js';
const hex=value=>String(value).replace(/^0x/,'').toLowerCase();
const sha=value=>createHash('sha256').update(value).digest('hex');
const directory=process.argv[2]||'.data/'+readdirSync('.data').filter(x=>/^platform-tee-\d+$/.test(x)).sort().at(-1);
const expected=JSON.parse(readFileSync(directory+'/client.json')),composeFile=readFileSync(directory+'/compose.yaml','utf8'),id=environment.PHALA_CVM_ID;
assert.ok(id,'Set PHALA_CVM_ID to the active deployment');
assert.equal(expected.reusedIdentity,true);
const response=await fetch(`https://cloud-api.phala.com/api/v1/cvms/${id}/compose_file`,{headers:{'X-API-Key':environment.PHALA_API_TOKEN,'X-Phala-Version':'2026-05-22'},signal:AbortSignal.timeout(20000)});
assert.equal(response.status,200,'Phala control-plane compose unavailable');const compose=await response.json();
assert.deepEqual(JSON.parse(compose.docker_compose_file),JSON.parse(composeFile),'Deployed compose differs from prepared update');
// Current dstack AppCompose uses compact JSON with recursively sorted keys.
const sort=o=>Array.isArray(o)?o.map(sort):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,sort(o[k])])):o;
const normalized={...compose};if(normalized.runner==='docker-compose')delete normalized.bash_script;if(normalized.runner==='bash')delete normalized.docker_compose_file;if(!normalized.pre_launch_script)delete normalized.pre_launch_script;
const composeHash=sha(JSON.stringify(sort(normalized)));
const infoResponse=await fetch(`https://cloud-api.phala.com/api/v1/cvms/${id}`,{headers:{'X-API-Key':environment.PHALA_API_TOKEN,'X-Phala-Version':'2026-05-22'},signal:AbortSignal.timeout(20000)});
assert.equal(infoResponse.status,200);const controlInfo=await infoResponse.json();assert.equal(controlInfo.compose_hash,composeHash,'Canonical hash differs from Phala control-plane hash');
const challenge=randomBytes(32).toString('hex'),attestation=await(await fetch(`${environment.PLATFORM_TEE_URL}/attestation?challenge=${challenge}`,{signal:AbortSignal.timeout(20000)})).json();
assert.equal(attestation.challenge,challenge);const identity=attestation.identity;
for(const field of ['operator','encryptionPublicKey','omnibusVault'])assert.equal(String(identity[field]).toLowerCase(),String(field==='omnibusVault'?previous.vault:previous[field]).toLowerCase());
for(const [path,hash] of Object.entries(expected.manifest.sourceHashes)){
 assert.equal(identity.sourceHashes[path],hash,`Deployed runtime mismatch: ${path}`);
 if(path!=='artifacts/platform/shared-account.json')assert.equal(sha(readFileSync(path)),hash,`Local runtime changed after preparation: ${path}`);
}
const vendor=await fetch('https://cloud-api.phala.com/api/v1/attestations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hex:attestation.quote.quote}),signal:AbortSignal.timeout(25000)});
assert.equal(vendor.status,200);const {body,quoteHash}=verifiedTdxBody(attestation.quote.quote,await vendor.json());
const events=typeof attestation.quote.event_log==='string'?JSON.parse(attestation.quote.event_log):attestation.quote.event_log;
replayTdxEvents(events,body);
const osUpgrade=process.argv.find(arg=>arg.startsWith('--expected-os-image-hash='))?.split('=')[1];
if(osUpgrade){
 assert.match(osUpgrade,/^[a-f0-9]{64}$/);
 assert.equal(controlInfo.os?.is_dev,false,'Migration requires a production OS image');
 assert.equal(controlInfo.os?.os_image_hash,osUpgrade,'Selected OS differs from expected official image');
 const imageEvents=events.filter(event=>event.imr===3&&event.event==='os-image-hash');
 assert.equal(imageEvents.length,1);assert.equal(hex(imageEvents[0].event_payload),osUpgrade,'Quote does not bind the selected OS image');
}else for(const field of ['mrtd','rtmr0','rtmr1','rtmr2'])assert.equal(hex(body[field]),hex(previous.measurements[field]),`Boot measurement changed: ${field}`);
assert.deepEqual(identity.identityMigration,expected.manifest.identityMigration,'Identity migration provenance differs from prepared deployment');
const policy={...previous,composeHash,...(osUpgrade?{osImageHash:osUpgrade}:{}),...(identity.identityMigration?{identityMigration:identity.identityMigration}:{}),measurements:Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2','rtmr3'].map(field=>[field,hex(body[field])])),sourceHashes:expected.manifest.sourceHashes};
const result=await verifyPlatformTee({endpoint:environment.PLATFORM_TEE_URL,publicKey:identity.encryptionPublicKey,vault:identity.omnibusVault,policy});
assert.equal(result.quoteHash.length,64);
writeFileSync('src/platform/tee-attestation-policy.js',`// Verified Phala control-plane compose, fresh DCAP quote and exact deployed runtime.\nexport const teeAttestationPolicy = Object.freeze(${JSON.stringify(policy,null,2)});\n`);
savePrivate(directory+'/enrollment.json',{verified:true,quoteHash,composeHash,sourceHashesMatch:true,identityPreserved:true,genesisPreserved:true,verifiedAt:result.verifiedAt});
console.log(JSON.stringify({verified:true,composeHash,identityPreserved:true,genesisPreserved:true,runtimeFiles:Object.keys(policy.sourceHashes).length}));
