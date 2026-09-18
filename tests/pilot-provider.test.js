import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PilotCoordinator } from '../src/pilot/coordinator.js';
import { digest } from '../src/pilot/policy.js';
import { verifyObject } from '../src/server/crypto.js';

test('separate provider CLI keys enroll and submit offline without disclosing alpha or allowing replacement',t=>{
  const directory=mkdtempSync(join(tmpdir(),'pilot-offline-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const stateDir=join(directory,'coordinator'),coordinator=new PilotCoordinator(stateDir);
  const run=(script,args,ok=true)=>{
    const result=spawnSync(process.execPath,[resolve('scripts',script),...args],{encoding:'utf8',timeout:20000});
    assert.equal(result.status,ok?0:1,result.stderr||result.error?.message);
    return ok?JSON.parse(result.stdout):result.stderr;
  };
  const clients=[];
  for(let i=0;i<3;i++) {
    const key=join(directory,`private-${i}.json`),enrollment=join(directory,`enrollment-${i}.json`);
    run('pilot-provider.mjs',['enroll','--offline','--name',`Fixture provider ${i}`,'--payout','0x'+String(i+1).repeat(40),'--key-file',key,'--output',enrollment]);
    assert.equal(statSync(key).mode&0o777,0o600);
    const publicFile=readFileSync(enrollment,'utf8');assert.ok(!publicFile.includes('PRIVATE KEY'));
    const request=run('pilot.mjs',['ingest-enrollment','--data-dir',stateDir,'--file',enrollment]);
    assert.equal(request.status,'PENDING');
    coordinator.approve(request.id,{subject:`internal-fixture-${i}`,evidenceHash:digest('internal-fixture'),kind:'INTERNAL_REFERENCE'});
    clients.push({key,publicKey:JSON.parse(publicFile).payload.publicKey});
  }
  const now=Math.floor(Date.now()/1000),epoch=coordinator.open({cutoffAt:now+60,startAt:now+120,endAt:now+240});
  const context=join(directory,'context.json');writeFileSync(context,JSON.stringify(coordinator.publicState()));
  for(let i=0;i<clients.length;i++) {
    const file=join(directory,`alpha-${i}.json`),client=clients[i];
    const prepared=run('pilot-provider.mjs',['prepare','--context',context,'--vector','[10000,0,0,-5000]','--key-file',client.key,'--output',file]);
    assert.equal(prepared.accepted,false);
    assert.ok(!readFileSync(file,'utf8').includes('vectorBps'));
    const receipt=run('pilot.mjs',['ingest-alpha','--data-dir',stateDir,'--file',file]);
    const {serverSignature,...body}=receipt;
    assert.ok(verifyObject(body,serverSignature,coordinator.publicState().signingPublicKey));
    assert.deepEqual(run('pilot.mjs',['ingest-alpha','--data-dir',stateDir,'--file',file]),receipt);
    const identity=JSON.parse(readFileSync(client.key));
    identity.payloads[epoch.id].vectorBps=[-10000,0,0,0];writeFileSync(client.key,JSON.stringify(identity));
    run('pilot-provider.mjs',['prepare','--context',context,'--key-file',client.key,'--output',file]);
    assert.match(run('pilot.mjs',['ingest-alpha','--data-dir',stateDir,'--file',file],false),/replacement rejected/);
  }
  assert.equal(coordinator.publicState().epochs[0].submitted,3);
  const publicText=JSON.stringify(coordinator.publicState());assert.ok(!publicText.includes('vectorBps'));assert.ok(!publicText.includes('PRIVATE KEY'));
});
