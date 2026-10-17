import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createECDH,createHmac,randomBytes} from 'node:crypto';
import {Wallet} from 'ethers';
import {SealedStore} from '../src/integration/sealed.js';
import {resolveOperatorSecret} from '../deploy/tee/operator/identity.mjs';

test('migration preserves operator identity and access to the existing sealed ledger',()=>{
  const storeDir=mkdtempSync(join(tmpdir(),'veilvest-migration-'));
  try{
    const oldSecret=randomBytes(32),newSecret=randomBytes(32),ecdh=createECDH('secp256k1');ecdh.setPrivateKey(oldSecret);
    const identityMigration={sourceAppId:'a'.repeat(40),targetAppId:'b'.repeat(40),encryptionPublicKey:ecdh.getPublicKey('hex','compressed'),operator:new Wallet(createHmac('sha256',oldSecret).update('gas-relayer-v1').digest('hex')).address};
    assert.deepEqual(resolveOperatorSecret(newSecret,{storeDir}),newSecret);
    assert.throws(()=>resolveOperatorSecret(newSecret,{storeDir,identityMigration}),/MIGRATION_IDENTITY_REQUIRED/);
    new SealedStore(storeDir+'/operator-identity.json',newSecret,'operator-identity-migration-v1').write({version:1,sourceAppId:identityMigration.sourceAppId,targetAppId:identityMigration.targetAppId,secret:oldSecret.toString('hex')});
    new SealedStore(storeDir+'/ledger.json',oldSecret,'existing-ledger').write({root:'123',balance:'200000000',sequence:701});
    const restored=resolveOperatorSecret(newSecret,{storeDir,identityMigration});
    assert.deepEqual(new SealedStore(storeDir+'/ledger.json',restored,'existing-ledger').read(),{root:'123',balance:'200000000',sequence:701});
    assert.throws(()=>resolveOperatorSecret(newSecret,{storeDir}),/MIGRATION_MANIFEST_REQUIRED/);
    assert.throws(()=>resolveOperatorSecret(randomBytes(32),{storeDir,identityMigration}));
    assert.throws(()=>resolveOperatorSecret(newSecret,{storeDir,identityMigration:{...identityMigration,targetAppId:'c'.repeat(40)}}),/MIGRATION_APP_MISMATCH/);
    assert.throws(()=>resolveOperatorSecret(newSecret,{storeDir,identityMigration:{...identityMigration,operator:Wallet.createRandom().address}}),/MIGRATION_OPERATOR_MISMATCH/);
    assert.throws(()=>resolveOperatorSecret(newSecret,{storeDir,identityMigration:{...identityMigration,encryptionPublicKey:'invalid'}}),/MIGRATION_KEY_MISMATCH/);
  }finally{rmSync(storeDir,{recursive:true,force:true});}
});
