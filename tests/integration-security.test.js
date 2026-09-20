import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { encryptionIdentity, encryptRequest, SealedStore } from '../src/integration/sealed.js';
import { identityBinding, verifyIdentity } from '../src/integration/attestation.js';
import { replayTdxEvents } from '../src/integration/tdx-quote.js';

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

test('large proving artifacts require explicit ingress limit; ordinary commands keep the small limit',()=>{
  const secret=Buffer.from(Wallet.createRandom().privateKey.slice(2),'hex');
  const ordinary=encryptionIdentity(secret),probe=encryptionIdentity(secret,{maxHexLength:4_000_000});
  const client=encryptRequest(probe.publicKey,{fixture:'x'.repeat(1_100_000)});
  assert.throws(()=>ordinary.open(client.packet),/Invalid encrypted payload/);
  assert.equal(probe.open(client.packet).message.fixture.length,1_100_000);
  const malformed=structuredClone(client.packet);malformed.box.data+='a';
  assert.throws(()=>probe.open(malformed),/Invalid encrypted payload/);
});

test('sealed durable journal hides plaintext and rejects corruption and other deployment context',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mm-sealed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const key=randomBytes(32),path=join(dir,'journal'),store=new SealedStore(path,key,'vault-A');
  store.write({strategy:'private-strategy',amount:'100'});assert.deepEqual(store.read(),{strategy:'private-strategy',amount:'100'});
  assert.equal(readFileSync(path,'utf8').includes('private-strategy'),false);
  assert.throws(()=>new SealedStore(path,key,'vault-B').read());
  const box=JSON.parse(readFileSync(path));box.tag=(box.tag.startsWith('00')?'01':'00')+box.tag.slice(2);writeFileSync(path,JSON.stringify(box));assert.throws(()=>store.read());
});

// Synthetic signed-report layout; mocked DCAP is policy testing, not hardware proof.
function quoteFixture(body) {
  const fields=[['tee_tcb_svn',16],['mrseam',48],['mrsignerseam',48],['seamattributes',8],['tdattributes',8],['xfam',8],['mrtd',48],['mrconfig',48],['mrowner',48],['mrownerconfig',48],['rtmr0',48],['rtmr1',48],['rtmr2',48],['rtmr3',48],['reportdata',64]];
  const bytes=Buffer.alloc(640);bytes.writeUInt16LE(4,0);bytes.writeUInt16LE(2,2);bytes.writeUInt32LE(129,4);bytes.writeUInt32LE(4,632);
  let offset=48;
  for(const [name,len] of fields){body[name]??='00'.repeat(len);Buffer.from(body[name],'hex').copy(bytes,offset);offset+=len;}
  return {raw:bytes.toString('hex'),result:{success:true,checksum:'opaque-service-identifier',quote:{verified:true,header:{version:4,ak_type:'ECDSA_P256',tee_type:'TEE_TDX',qe_vendor:'00'.repeat(16),user_data:'00'.repeat(20)},body}}};
}

test('attestation policy binds signed report, nonce, key, configuration and measurements',async()=>{
  const challenge=randomBytes(32).toString('hex'),identity={signer:Wallet.createRandom().address,configHash:'configured',encryptionPublicKey:'test-public-key'};
  const measurements=Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2','rtmr3'].map((k,i)=>[k,(i+1).toString().repeat(96)]));
  const expected={challenge,identity,measurements};
  const fixture=quoteFixture({...measurements,reportdata:identityBinding(identity,challenge).slice(2).padEnd(128,'0')});
  const attestation={mode:'DSTACK_TDX',challenge,identity,quote:fixture.raw},valid=fixture.result;
  const verify=(a,e,result=valid)=>verifyIdentity(a,e,{fetchImpl:async()=>({ok:true,json:async()=>result})});
  const checked=await verify(attestation,expected);
  assert.equal(checked.status,'VERIFIED_PINNED_TDX_VIA_PHALA');
  assert.equal(checked.quoteHash,createHash('sha256').update(Buffer.from(fixture.raw,'hex')).digest('hex'));
  await assert.rejects(()=>verify({...attestation,mode:'SIMULATED'},expected),/hardware/);
  await assert.rejects(()=>verify({...attestation,challenge:'00'.repeat(32)},expected),/fresh/);
  await assert.rejects(()=>verify({...attestation,identity:{...identity,configHash:'evil'}},expected),/substitution/);
  await assert.rejects(()=>verify(attestation,{...expected,measurements:{}}),/Pinned measurement/);
  const forged=structuredClone(valid);forged.quote.verified=false;await assert.rejects(()=>verify(attestation,expected,forged),/signature/);
  for(const field of Object.keys(valid.quote.body)){
    const substituted=structuredClone(valid);substituted.quote.body[field]='ff'.repeat(valid.quote.body[field].length/2);
    await assert.rejects(()=>verify(attestation,expected,substituted),/signed report/,field);
  }
  for(const [label,mutate,pattern] of [
    ['unbound key',b=>{b.reportdata='00'.repeat(64);},/binding/],
    ['debug TEE',b=>{b.tdattributes='0100000000000000';},/Debug/],
    ['other image',b=>{b.rtmr3='00'.repeat(48);},/Measurement/],
  ]){const changed=quoteFixture(mutateBody(valid.quote.body,mutate));await assert.rejects(()=>verify({...attestation,quote:changed.raw},expected,changed.result),pattern,label);}
  await assert.rejects(()=>verify({...attestation,quote:fixture.raw+'01'},expected),/padding/);
  assert.equal((await verify({...attestation,quote:fixture.raw+'00'.repeat(70)},expected)).status,checked.status);
  await assert.rejects(()=>verify({...attestation,quote:fixture.raw.slice(0,-2)},expected),/length/);
});
function mutateBody(body,mutate){const changed=structuredClone(body);mutate(changed);return changed;}

test('runtime event replay authenticates payload and name when digest is omitted',()=>{
  const event={imr:3,event_type:0x8000001,event:'compose-hash',event_payload:'ab'.repeat(32),digest:''};
  const type=Buffer.alloc(4);type.writeUInt32LE(event.event_type);
  const digest=createHash('sha384').update(type).update(':compose-hash:').update(Buffer.from(event.event_payload,'hex')).digest();
  const body={rtmr0:'00'.repeat(48),rtmr1:'00'.repeat(48),rtmr2:'00'.repeat(48),rtmr3:createHash('sha384').update(Buffer.alloc(48)).update(digest).digest('hex')};
  replayTdxEvents([event],body);
  replayTdxEvents([{...event,digest:digest.toString('hex')}],body);
  assert.throws(()=>replayTdxEvents([{...event,event_payload:'cd'.repeat(32)}],body),/does not match/);
  assert.throws(()=>replayTdxEvents([{...event,event:'app-id'}],body),/does not match/);
  assert.throws(()=>replayTdxEvents([{...event,digest:'00'.repeat(48)}],body),/digest mismatch/);
  assert.throws(()=>replayTdxEvents([{...event,imr:0}],body),/Missing boot/);
});
