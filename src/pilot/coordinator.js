import { existsSync, readFileSync, mkdirSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createPublicKey } from 'node:crypto';
import { AbiCoder, keccak256, isAddress } from 'ethers';
import { makeKeys, decryptEnvelope, hash, leafHash, merkleTree, signObject, signingPublicKey, verifyObject, parsePublicKey } from '../server/crypto.js';
import { POLICY, POLICY_HASH, digest, alphaCommitment, validateActors, validateVector, groupSignals, aggregateActors, chooseActorWeights } from './policy.js';
import { atomicJson } from './chain.js';

export class PilotCoordinator {
  constructor(directory, { clock = () => Math.floor(Date.now() / 1000) } = {}) {
    this.directory = directory; this.clock = clock;
    this.path = join(directory, 'coordinator.json');
    this.keyPath = join(directory, 'coordinator-keys.json');
    mkdirSync(directory,{recursive:true,mode:0o700});
    if (!existsSync(this.keyPath)) {try {writeFileSync(this.keyPath,JSON.stringify(makeKeys()),{mode:0o600,flag:'wx',flush:true});} catch(error) {if(error.code!=='EEXIST')throw error;}}
    this.keys = JSON.parse(readFileSync(this.keyPath));
    if (!existsSync(this.path)) atomicJson(this.path, { actors: [], epochs: [], history: [], requests: [] });
  }
  read() { return JSON.parse(readFileSync(this.path)); }
  write(state) { atomicJson(this.path, state); }
  mutate(fn) {
    const lock=openSync(this.path+'.lock','wx',0o600);
    try { const state = this.read(); const result = fn(state); this.write(state); return result; }
    finally {closeSync(lock);unlinkSync(this.path+'.lock');}
  }
  enroll({ payload, signature }) {
    if (!payload || payload.domain !== 'MM_PILOT_ENROLL_V1' || !isAddress(payload.payoutAddress) || typeof payload.name !== 'string' || payload.name.length < 2 || payload.name.length > 60 || !/^[0-9a-f]{64}$/.test(payload.nonce)) throw new Error('Invalid enrollment');
    parsePublicKey(payload.publicKey);
    if (!verifyObject(payload, signature, payload.publicKey)) throw new Error('Enrollment signature invalid');
    return this.mutate(s => {
      const existing = s.requests.find(r => r.payload.publicKey === payload.publicKey);
      if (existing) { if (digest(existing.payload) !== digest(payload)) throw new Error('Different enrollment for same key'); return existing; }
      const request = { id: digest(payload), payload, signature, status: 'PENDING' }; s.requests.push(request); return request;
    });
  }
  approve(requestId, { subject, evidenceHash, kind = 'HUMAN_REVIEWED' }) {
    if (!subject || !/^0x[0-9a-f]{64}$/.test(evidenceHash) || !['HUMAN_REVIEWED', 'INTERNAL_REFERENCE'].includes(kind)) throw new Error('Admission needs an economic subject and evidence digest');
    return this.mutate(s => {
      const r = s.requests.find(r => r.id === requestId); if (!r) throw new Error('Enrollment not found');
      if (r.status === 'APPROVED') return s.actors.find(a => a.providerKeys.includes(r.payload.publicKey));
      const subjectHash = digest(subject);
      if (s.actors.some(a => a.admissionSubject === subjectHash || a.payoutAddress.toLowerCase() === r.payload.payoutAddress.toLowerCase())) throw new Error('Economic actor already approved; link additional provider keys to that actor');
      const a = { id: digest({ subjectHash, payout: r.payload.payoutAddress }), name: r.payload.name,
        payoutAddress: r.payload.payoutAddress, providerKeys: [r.payload.publicKey], admissionSubject: subjectHash,
        admissionEvidenceHash: evidenceHash, admissionKind: kind, admissionStatus: 'APPROVED', enrollment: r };
      s.actors.push(a); validateActors(s.actors); r.status = 'APPROVED'; return a;
    });
  }
  linkKey(actorId, requestId) {
    return this.mutate(s => {
      const a = s.actors.find(a => a.id === actorId), r = s.requests.find(r => r.id === requestId);
      if (!a || !r || r.payload.payoutAddress.toLowerCase() !== a.payoutAddress.toLowerCase()) throw new Error('Additional key must retain the approved payout identity');
      if (!a.providerKeys.includes(r.payload.publicKey)) a.providerKeys.push(r.payload.publicKey);
      validateActors(s.actors); r.status = 'APPROVED'; return a;
    });
  }
  open({ id = '0x' + randomBytes(32).toString('hex'), cutoffAt, startAt, endAt }) {
    return this.mutate(s => {
      if (s.epochs.some(e => !['SETTLED', 'CANCELLED'].includes(e.status))) throw new Error('Finish active pilot epoch');
      validateActors(s.actors); if (s.actors.length < 3) throw new Error('Three approved actors required');
      if (!(this.clock() < cutoffAt && cutoffAt < startAt && startAt < endAt)) throw new Error('Invalid epoch schedule');
      const actors = structuredClone(s.actors).sort((a,b)=>a.id.localeCompare(b.id));
      const weights = chooseActorWeights(actors, s.history);
      const e = { id, sequence: s.epochs.length + 1, status: 'OPEN', cutoffAt, startAt, endAt,
        policy: POLICY, policyHash: POLICY_HASH, actors, rosterHash: digest(actors), weights, weightsHash: digest(weights),
        payoutsHash: keccak256(AbiCoder.defaultAbiCoder().encode(['address[]'],[actors.map(a=>a.payoutAddress)])),
        previousManifestHash: s.epochs.at(-1)?.manifestHash || null, submissions: {}, receipts: {}, chain: {} };
      s.epochs.push(e); return e;
    });
  }
  submit(envelope) {
    const { payload, signature, commitmentSignature } = decryptEnvelope(envelope, this.keys.encryptionPrivateKey);
    return this.mutate(s => {
      const e = s.epochs.find(e=>e.id===payload.epochId);
      const actor = e?.actors.find(a=>a.id===payload.actorId && a.providerKeys.includes(payload.publicKey));
      if (!actor || payload.domain !== 'MM_PILOT_ALPHA_V2' || payload.policyHash !== e.policyHash || !/^[0-9a-f]{64}$/.test(payload.nonce)) throw new Error('Wrong alpha epoch, policy or approved identity');
      validateVector(payload.vectorBps);
      if (!verifyObject(payload,signature,payload.publicKey)) throw new Error('Alpha signature invalid');
      if (!verifyObject(alphaCommitment(payload),commitmentSignature,payload.publicKey)) throw new Error('Public alpha commitment signature invalid');
      const h=digest(payload), existing=e.submissions[payload.publicKey];
      if(existing) { if(existing.payloadHash!==h) throw new Error('Submission replacement rejected'); return existing.receipt; }
      if(e.status!=='OPEN' || this.clock()>=e.cutoffAt) throw new Error('Submission cutoff passed');
      const body={domain:'MM_PILOT_RECEIPT_V2',epochId:e.id,actorId:actor.id,publicKey:payload.publicKey,payloadHash:h,acceptedAt:this.clock(),cutoffAt:e.cutoffAt,policyHash:e.policyHash,commitmentSignature};
      const receipt={...body,serverSignature:signObject(body,this.keys.signingPrivateKey)};
      e.submissions[payload.publicKey]={payloadHash:h,envelope,receipt};return receipt;
    });
  }
  inputs(epoch) {
    if(digest(epoch.actors)!==epoch.rosterHash || digest(epoch.weights)!==epoch.weightsHash || digest(epoch.policy)!==epoch.policyHash) throw new Error('Frozen epoch changed');
    return Object.entries(epoch.submissions).map(([key,s])=>{
      const {payload,signature,commitmentSignature}=decryptEnvelope(s.envelope,this.keys.encryptionPrivateKey);
      const actor=epoch.actors.find(a=>a.id===payload.actorId&&a.providerKeys.includes(key));
      if(!actor || payload.publicKey!==key || payload.epochId!==epoch.id || payload.policyHash!==epoch.policyHash || payload.domain!=='MM_PILOT_ALPHA_V2' || digest(payload)!==s.payloadHash || !verifyObject(payload,signature,key)) throw new Error('Stored alpha differs from signed commitment');
      if(!verifyObject(alphaCommitment(payload),commitmentSignature,key)||s.receipt.commitmentSignature!==commitmentSignature)throw new Error('Stored public commitment changed');
      validateVector(payload.vectorBps);return {...payload,signature};
    });
  }
  seal(id) {
    return this.mutate(s=>{
      const e=s.epochs.find(e=>e.id===id);if(!e)throw new Error('Epoch not found');
      if(e.status==='SEALED') {this.verify(e);return e;}
      if(e.status!=='OPEN'||this.clock()<e.cutoffAt||this.clock()>=e.startAt)throw new Error('Outside seal window');
      const inputs=this.inputs(e), groups=groupSignals(e.actors,inputs);
      const targets=aggregateActors(groups,e.weights);
      e.leaves=e.actors.flatMap(a=>a.providerKeys.map(publicKey=>({domain:'MM_PILOT_LEAF_V2',epochId:id,actorId:a.id,publicKey,
        status:e.submissions[publicKey]?'SUBMITTED':'MISSED',payloadHash:e.submissions[publicKey]?.payloadHash||digest({id,publicKey,missing:true})})));
      const tree=merkleTree(e.leaves);e.root=tree.root;e.proofs=tree.proofs;e.targets=targets;
      e.targetHash=keccak256(AbiCoder.defaultAbiCoder().encode(['int256[4]'],[targets]));
      e.manifest={domain:'MM_PILOT_MANIFEST_V2',epochId:id,policyHash:e.policyHash,rosterHash:e.rosterHash,weightsHash:e.weightsHash,
        payoutsHash:e.payoutsHash,root:e.root,targetHash:e.targetHash,cutoffAt:e.cutoffAt,startAt:e.startAt,endAt:e.endAt,previousManifestHash:e.previousManifestHash};
      e.manifestHash=digest(e.manifest);e.status='SEALED';return e;
    });
  }
  verify(e) {
    const inputs=this.inputs(e), expected=e.actors.flatMap(a=>a.providerKeys.map(publicKey=>({domain:'MM_PILOT_LEAF_V2',epochId:e.id,actorId:a.id,publicKey,
      status:e.submissions[publicKey]?'SUBMITTED':'MISSED',payloadHash:e.submissions[publicKey]?.payloadHash||digest({id:e.id,publicKey,missing:true})})));
    if(digest(expected)!==digest(e.leaves)||merkleTree(expected).root!==e.root||digest(e.manifest)!==e.manifestHash||e.manifest.root!==e.root||e.manifest.rosterHash!==e.rosterHash||e.manifest.weightsHash!==e.weightsHash)throw new Error('Frozen commitment changed');
    const manifest={domain:'MM_PILOT_MANIFEST_V2',epochId:e.id,policyHash:e.policyHash,rosterHash:e.rosterHash,weightsHash:e.weightsHash,payoutsHash:e.payoutsHash,root:e.root,targetHash:e.targetHash,cutoffAt:e.cutoffAt,startAt:e.startAt,endAt:e.endAt,previousManifestHash:e.previousManifestHash};
    if(digest(manifest)!==e.manifestHash)throw new Error('Frozen schedule or manifest metadata changed');
    const targets=aggregateActors(groupSignals(e.actors,inputs),e.weights);
    if(keccak256(AbiCoder.defaultAbiCoder().encode(['int256[4]'],[targets]))!==e.manifest.targetHash)throw new Error('Aggregate differs from commitment');
    return inputs;
  }
  update(id, fn) {return this.mutate(s=>{const e=s.epochs.find(e=>e.id===id);if(!e)throw new Error('Epoch not found');fn(e,s);return e;});}
  publicState() {
    const s=this.read();return {policy:POLICY,policyHash:POLICY_HASH,serverPublicKey:createPublicKey(this.keys.encryptionPrivateKey).export({format:'jwk'}),
      signingPublicKey:signingPublicKey(this.keys.signingPrivateKey),
      actors:s.actors.map(({enrollment,admissionSubject,...a})=>a),
      pendingRequests:s.requests.filter(r=>r.status==='PENDING').map(r=>({id:r.id,name:r.payload.name,publicKey:r.payload.publicKey,payoutAddress:r.payload.payoutAddress})),
      epochs:s.epochs.map(e=>{const {submissions,receipts,actors,leaves,proofs,...publicEpoch}=e;return {...publicEpoch,submitted:Object.keys(submissions).length,actors:actors.map(a=>({id:a.id,name:a.name,payoutAddress:a.payoutAddress,admissionKind:a.admissionKind}))};})};
  }
}
