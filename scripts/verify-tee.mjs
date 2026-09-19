import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { verifyIdentity } from '../src/integration/attestation.js';
import { encryptRequest } from '../src/integration/sealed.js';

const [endpoint,policyPath,envelopePath]=process.argv.slice(2);
if(!endpoint||!policyPath)throw Error('Usage: node scripts/verify-tee.mjs https://CVM EXPECTED-POLICY.json [SIGNED-ENVELOPE.json]');
if(new URL(endpoint).protocol!=='https:')throw Error('HTTPS endpoint required');
// Expected measurements/config are reviewed independently, never copied from
// this endpoint and automatically accepted. Keys can be newly attested.
const policy=JSON.parse(readFileSync(policyPath)),challenge=randomBytes(32).toString('hex');
const response=await fetch(new URL('/attestation?challenge='+challenge,endpoint),{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Attestation endpoint failed');const attestation=await response.json();
for(const field of ['configHash','policyHash','vault','chainId','contractSourceHash'])if(policy.identity?.[field]===undefined)throw Error('Missing expected identity '+field);
const expected={challenge,measurements:policy.measurements,identity:{...policy.identity,signer:attestation.identity.signer,encryptionPublicKey:attestation.identity.encryptionPublicKey}};
const verified=await verifyIdentity(attestation,expected);
const output=policyPath+'.verified.json';writeFileSync(output,JSON.stringify({...verified,rawAttestation:attestation},null,2),{mode:0o600});
console.log(JSON.stringify({status:verified.status,evidence:output,signer:verified.identity.signer}));
if(envelopePath){
  const client=encryptRequest(verified.identity.encryptionPublicKey,JSON.parse(readFileSync(envelopePath)));
  const r=await fetch(new URL('/command',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(client.packet),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Encrypted command transport failed');
  const result=client.openReply(await r.json());
  const resultPath=envelopePath+'.result.json';writeFileSync(resultPath,JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({ok:result.ok,result:resultPath,chainBroadcast:false}));
}
