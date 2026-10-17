import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,createECDH,randomBytes} from 'node:crypto';
import {snapshotFiles,validateSnapshot,restoreSnapshot} from '../deploy/tee/operator/migration.mjs';
import {SealedStore} from '../src/integration/sealed.js';

test('encrypted state transfer preserves exact files and seals the key to the new CVM',()=>{
  const root=mkdtempSync(join(tmpdir(),'veilvest-transfer-')),source=root+'/source',target=root+'/target';
  try{
    const secret=randomBytes(32),destination=randomBytes(32),ecdh=createECDH('secp256k1');ecdh.setPrivateKey(secret);
    new SealedStore(source+'/investments.json',secret,'private-investments-v1').write({cash:'123456',sequence:701});
    writeFileSync(source+'/proof.json',JSON.stringify({root:'123',sequence:701}));
    const domain={sourceAppId:'a'.repeat(40),targetAppId:'b'.repeat(40),sourceEncryptionPublicKey:ecdh.getPublicKey('hex','compressed')};
    const snapshot={version:1,...domain,secret:secret.toString('hex'),...snapshotFiles(source)};
    assert.equal(validateSnapshot(snapshot,domain).files,2);
    assert.throws(()=>validateSnapshot(snapshot,{...domain,targetAppId:'c'.repeat(40)}),/SNAPSHOT_DOMAIN/);
    assert.throws(()=>validateSnapshot({...snapshot,secret:randomBytes(32).toString('hex')},domain),/SNAPSHOT_IDENTITY/);
    assert.throws(()=>validateSnapshot({...snapshot,sha256:'bad'},domain),/SNAPSHOT_HASH/);
    const files={'../escape':'eA=='};
    assert.throws(()=>validateSnapshot({...snapshot,files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')},domain),/SNAPSHOT_PATH/);
    const result=restoreSnapshot(snapshot,{...domain,storeDir:target,derivedSecret:destination});
    assert.equal(result.replayed,false);
    assert.deepEqual(readFileSync(source+'/investments.json'),readFileSync(target+'/investments.json'));
    const imported=new SealedStore(target+'/operator-identity.json',destination,'operator-identity-migration-v1').read();
    assert.equal(imported.secret,secret.toString('hex'));
    assert.throws(()=>new SealedStore(target+'/operator-identity.json',randomBytes(32),'operator-identity-migration-v1').read());
    assert.equal(restoreSnapshot(snapshot,{...domain,storeDir:target,derivedSecret:destination}).replayed,true);
    writeFileSync(source+'/proof.json','changed');
    assert.throws(()=>restoreSnapshot({...snapshot,...snapshotFiles(source)},{...domain,storeDir:target,derivedSecret:destination}),/MIGRATION_ALREADY_IMPORTED/);
    symlinkSync('/etc/passwd',source+'/symlink');assert.throws(()=>snapshotFiles(source),/SNAPSHOT_SYMLINK/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
