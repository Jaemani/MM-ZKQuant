import assert from 'node:assert/strict';
import {groupSignals,attributeActors,allocateRewards,validateActors} from './policy.js';
export function runRewardChallenges(){
  const actors=Array.from({length:4},(_,i)=>({id:'actor-'+i,admissionSubject:'subject-'+i,payoutAddress:'payout-'+i,admissionStatus:'APPROVED',admissionEvidenceHash:'evidence-'+i,providerKeys:['key-'+i]}));
  const weights=Object.fromEntries(actors.map(a=>[a.id,1000]));
  const submissions=actors.map((a,i)=>({actorId:a.id,publicKey:a.providerKeys[0],vectorBps:i<2?[10000,0,0,0]:[0,0,0,0]}));
  const before=allocateRewards(attributeActors(groupSignals(actors,submissions),weights,[0.1,0,0,0]),10000n);
  actors[0].providerKeys.push('clone');submissions.push({...submissions[0],publicKey:'clone'});
  const after=allocateRewards(attributeActors(groupSignals(actors,submissions),weights,[0.1,0,0,0]),10000n);assert.deepEqual(before,after);
  submissions.at(-1).vectorBps=[-10000,0,0,0];
  const opposite=attributeActors(groupSignals(actors,submissions),weights,[0.1,0,0,0]);assert.equal(opposite[0].contributionBps,0);
  const coalition=allocateRewards(opposite,10000n);assert.equal(coalition['actor-0'],'0');
  const saturated=actors.map(a=>({id:a.id,submitted:true,vectorBps:[10000,0,0,0]}));
  const cap=attributeActors(saturated,weights,[0.1,0,0,0]);assert.ok(cap.every(c=>c.contributionBps>0));
  assert.ok(Math.abs(cap.reduce((n,c)=>n+c.contributionBps,0)-249.5)<1e-8);
  const dup=structuredClone(actors);dup[1].admissionSubject=dup[0].admissionSubject;assert.throws(()=>validateActors(dup));
  return {scope:'APPROVED_ECONOMIC_ACTOR_MODEL; hidden common ownership requires human admission review',passed:true,
    clone:{before,after,unchanged:true},opposite:{contributionBps:opposite[0].contributionBps,reward:coalition['actor-0']},
    cap:{contributions:cap,sumBps:cap.reduce((n,c)=>n+c.contributionBps,0)},duplicateSubjectRejected:true,
    hiddenSybilDetectionProven:false};
}
