import {createECDH,createHmac} from 'node:crypto';
import {existsSync} from 'node:fs';
import {Wallet} from 'ethers';
import {SealedStore} from '../../../src/integration/sealed.js';

// A transferred operator key is sealed under the destination CVM's own KMS key.
// Missing or mismatched migration state must never initialize a fresh ledger.
export function resolveOperatorSecret(derivedSecret,{storeDir,identityMigration}={}) {
  const path=storeDir+'/operator-identity.json';
  if(!identityMigration){
    if(existsSync(path))throw Error('MIGRATION_MANIFEST_REQUIRED');
    return derivedSecret;
  }
  const saved=new SealedStore(path,derivedSecret,'operator-identity-migration-v1').read();
  if(!saved||saved.version!==1)throw Error('MIGRATION_IDENTITY_REQUIRED');
  for(const field of ['sourceAppId','targetAppId']){
    if(!/^[a-f0-9]{40}$/.test(identityMigration[field]||'')||saved[field]!==identityMigration[field])throw Error('MIGRATION_APP_MISMATCH');
  }
  if(!/^[a-f0-9]{64}$/.test(saved.secret||''))throw Error('MIGRATION_KEY_INVALID');
  const secret=Buffer.from(saved.secret,'hex'),ecdh=createECDH('secp256k1');
  ecdh.setPrivateKey(secret);
  if(ecdh.getPublicKey('hex','compressed')!==identityMigration.encryptionPublicKey)throw Error('MIGRATION_KEY_MISMATCH');
  const address=new Wallet(createHmac('sha256',secret).update('gas-relayer-v1').digest('hex')).address;
  if(address.toLowerCase()!==String(identityMigration.operator).toLowerCase())throw Error('MIGRATION_OPERATOR_MISMATCH');
  return secret;
}
