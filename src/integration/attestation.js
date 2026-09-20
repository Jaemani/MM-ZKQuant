import { verifiedTdxBody } from './tdx-quote.js';
import { hash } from './protocol.js';

const hex=x=>String(x||'').replace(/^0x/,'').toLowerCase();
const must=(ok,message)=>{if(!ok)throw Error(message);};
export const identityBinding=(identity,challenge)=>hash({domain:'MM_TEE_IDENTITY_V1',identity,challenge});

// PoC explicitly trusts Phala's HTTPS quote-verification service for Intel DCAP
// signature/collateral validation. Never accept the application's "verified"
// field. The response is obtained by this verifier, bound to exact quote bytes.
// Full OS/KMS governance auditing remains a separate enrollment requirement.
export async function verifyIdentity(attestation,expected,{fetchImpl=fetch}={}) {
  must(expected&&/^[0-9a-f]{64}$/i.test(expected.challenge||''),'Fresh challenge required');
  must(attestation.mode==='DSTACK_TDX'&&attestation.challenge===expected.challenge,'Not a fresh hardware attestation');
  must(hash(attestation.identity)===hash(expected.identity),'Identity/config substitution');
  const raw=hex(attestation.quote);must(/^[0-9a-f]+$/.test(raw)&&raw.length%2===0&&raw.length>=1024&&raw.length<=65536,'Invalid quote');
  for(const field of ['mrtd','rtmr0','rtmr1','rtmr2','rtmr3'])must(/^[0-9a-f]{96}$/.test(hex(expected.measurements?.[field])),'Pinned measurement required: '+field);
  const response=await fetchImpl('https://cloud-api.phala.com/api/v1/attestations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hex:raw}),signal:AbortSignal.timeout(30000)});
  must(response.ok,'Hardware verification service failed');const result=await response.json();
  must(result.success===true&&result.quote?.verified===true,'Hardware signature/collateral rejected');
  const {body,quoteHash}=verifiedTdxBody(raw,result);
  must(hex(body.reportdata)===hex(identityBinding(attestation.identity,expected.challenge)).padEnd(128,'0'),'Quote key/challenge binding mismatch');
  // TDX attributes are serialized little endian; bit zero enables debug.
  const attributes=hex(body.tdattributes);must(/^[0-9a-f]{16}$/.test(attributes)&&!(parseInt(attributes.slice(0,2),16)&1),'Debug TEE or missing attributes');
  for(const field of ['mrtd','rtmr0','rtmr1','rtmr2','rtmr3'])must(hex(body[field])===hex(expected.measurements[field]),'Measurement mismatch: '+field);
  return {status:'VERIFIED_PINNED_TDX_VIA_PHALA',quoteHash,identity:attestation.identity,challenge:expected.challenge,measurements:expected.measurements,verifiedAt:new Date().toISOString(),trust:'Phala HTTPS DCAP verifier; enrollment must independently approve OS, compose/image and KMS governance'};
}
