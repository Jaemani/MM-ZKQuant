import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { encryptionIdentity, encryptRequest, SealedStore } from '../src/integration/sealed.js';
import { identityBinding, verifyIdentity } from '../src/integration/attestation.js';

test('encrypted ingress and response reject tampering, wrong recipient and reflection',()=>{
  const secret=Buffer.from(Wallet.createRandom().privateKey.slice(2),'hex'),recipient=encryptionIdentity(secret);
  const client=encryptRequest(recipient.publicKey,{privateAlpha:'LONG',strategy:'A'}),opened=recipient.open(client.packet);
  assert.equal(opened.message.privateAlpha,'LONG');
  assert.deepEqual(client.openReply(opened.reply({received:true})),{received:true});
  assert.throws(()=>client.openReply(client.packet.box));
  const tampered=structuredClone(client.packet);tampered.box.data=(tampered.box.data.startsWith('00')?'01':'00')+tampered.box.data.slice(2);
  assert.throws(()=>recipient.open(tampered));
  assert.throws(()=>encryptionIdentity(Buffer.from(Wallet.createRandom().privateKey.slice(2),'hex')).open(client.packet));
});

test('sealed durable journal hides plaintext and rejects corruption and other deployment context',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mm-sealed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const key=randomBytes(32),path=join(dir,'journal'),store=new SealedStore(path,key,'vault-A');
  store.write({strategy:'private-strategy',amount:'100'});assert.deepEqual(store.read(),{strategy:'private-strategy',amount:'100'});
  assert.equal(readFileSync(path,'utf8').includes('private-strategy'),false);
  assert.throws(()=>new SealedStore(path,key,'vault-B').read());
  const box=JSON.parse(readFileSync(path));box.tag=(box.tag.startsWith('00')?'01':'00')+box.tag.slice(2);writeFileSync(path,JSON.stringify(box));assert.throws(()=>store.read());
});

// Synthetic verifier responses exercise admission policy, NOT hardware proof.
test('attestation policy binds exact quote, nonce, key, configuration and all measurements',async()=>{
  const challenge=randomBytes(32).toString('hex'),identity={signer:Wallet.createRandom().address,configHash:'configured',encryptionPublicKey:'test-public-key'};
  const attestation={mode:'DSTACK_TDX',challenge,identity,quote:'ab'.repeat(1024)};
  const measurements=Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2','rtmr3'].map((k,i)=>[k,(i+1).toString().repeat(96)]));
  const expected={challenge,identity,measurements};
  const valid={success:true,checksum:createHash('sha256').update(Buffer.from(attestation.quote,'hex')).digest('hex'),quote:{verified:true,header:{tee_type:129},body:{...measurements,tdattributes:'0000000000000000',reportdata:identityBinding(identity,challenge).slice(2).padEnd(128,'0')}}};
  const verify=(a,e,result=valid)=>verifyIdentity(a,e,{fetchImpl:async()=>({ok:true,json:async()=>result})});
  assert.equal((await verify(attestation,expected)).status,'VERIFIED_PINNED_TDX_VIA_PHALA');
  await assert.rejects(()=>verify({...attestation,mode:'SIMULATED'},expected),/hardware/);
  await assert.rejects(()=>verify({...attestation,challenge:'00'.repeat(32)},expected),/fresh/);
  await assert.rejects(()=>verify({...attestation,identity:{...identity,configHash:'evil'}},expected),/substitution/);
  await assert.rejects(()=>verify(attestation,{...expected,measurements:{}}),/Pinned measurement/);
  for(const [label,mutate,pattern] of [
    ['forged status',r=>{r.quote.verified=false;},/signature/],
    ['different quote',r=>{r.checksum='00'.repeat(32);},/checksum/],
    ['unbound key',r=>{r.quote.body.reportdata='00'.repeat(64);},/binding/],
    ['debug TEE',r=>{r.quote.body.tdattributes='0100000000000000';},/Debug/],
    ['other image',r=>{r.quote.body.rtmr3='00'.repeat(48);},/Measurement/],
  ]){const result=structuredClone(valid);mutate(result);await assert.rejects(()=>verify(attestation,expected,result),pattern,label);}
});
