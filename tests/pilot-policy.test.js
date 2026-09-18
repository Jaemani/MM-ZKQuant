import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSignals, aggregateActors, attributeActors, allocateRewards, chooseActorWeights, validateActors } from '../src/pilot/policy.js';
const actors = (n = 4) => Array.from({ length: n }, (_, i) => ({ id: 'actor-' + i, payoutAddress: 'address-' + i, admissionSubject: 'subject-' + i, admissionStatus: 'APPROVED', admissionEvidenceHash: 'evidence-' + i, providerKeys: ['key-' + i] }));
const submissions = (rows) => rows.map((v, i) => ({ actorId: 'actor-' + i, publicKey: 'key-' + i, vectorBps: v }));
const weights = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['actor-' + i, 1000]));
test('same actor cannot gain exposure or rewards by cloning an identical provider key or vector', () => {
  const a = actors(), s = submissions([[10000,0,0,0],[10000,0,0,0],[0,0,0,0],[0,0,0,0]]);
  const baseline = groupSignals(a, s);
  a[0].providerKeys.push('clone-key'); s.push({ actorId: a[0].id, publicKey: 'clone-key', vectorBps: [10000,0,0,0] });
  assert.deepEqual(groupSignals(a, s), baseline);
  assert.deepEqual(allocateRewards(attributeActors(groupSignals(a,s),weights(4),[0.1,0,0,0]),10000n), allocateRewards(attributeActors(baseline,weights(4),[0.1,0,0,0]),10000n));
  assert.throws(() => groupSignals(a, [...s,s[0]]), /duplicate/);
});
test('opposite signals from an admitted economic actor have zero joint contribution and no payout', () => {
  const a = actors(3); a[0].providerKeys.push('opposite');
  const s = submissions([[10000,0,0,0],[0,10000,0,0],[0,0,0,0]]);
  s.push({ actorId: a[0].id, publicKey: 'opposite', vectorBps: [-10000,0,0,0] });
  const grouped = groupSignals(a,s), result = attributeActors(grouped,weights(3),[0.1,0.1,0,0]);
  assert.deepEqual(grouped[0].vectorBps,[0,0,0,0]);
  assert.equal(result[0].contributionBps,0);
  assert.equal(allocateRewards(result,10000n)['actor-0'],'0');
  assert.equal(allocateRewards(result,0n)['actor-1'],'0');
});
test('risk cap no longer makes all attribution zero; exact Shapley sums to reference return', () => {
  const g=groupSignals(actors(),submissions(Array.from({length:4},()=>[10000,0,0,0])));
  assert.deepEqual(aggregateActors(g,weights(4)),[2500,0,0,0]);
  const r=attributeActors(g,weights(4),[0.1,0,0,0]);
  assert.ok(r.every(a=>a.contributionBps>0));
  assert.ok(Math.abs(r.reduce((n,a)=>n+a.contributionBps,0)-249.5)<1e-8);
  assert.deepEqual(Object.values(allocateRewards(r,10000n)),['2500','2500','2500','2500']);
});
test('admission rejects duplicate economic subject, payout and unapproved extra actors', () => {
  for(const key of ['admissionSubject','payoutAddress']) { const a=actors(); a[1][key]=a[0][key]; assert.throws(()=>validateActors(a),/unique/); }
  const a=actors();a[0].admissionStatus='PENDING';assert.throws(()=>validateActors(a),/Unapproved/);
  assert.throws(()=>groupSignals(actors(),[{actorId:'actor-0',publicKey:'unknown',vectorBps:[0,0,0,0]}]),/Unapproved/);
});
test('one observation and thirty observations have distinct allocation strength', () => {
  const a=actors();const row={actorId:'actor-0',settled:true,submitted:true,contributionBps:100};
  assert.notDeepEqual(chooseActorWeights(a,[row]),chooseActorWeights(a,Array(30).fill(row)));
});
