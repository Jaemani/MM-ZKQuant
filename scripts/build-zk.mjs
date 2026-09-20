import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local single-party setup, not an audited multiparty ceremony. Never use these
// keys for real custody. No cloud resource or external transaction is created.
const dir=resolve('artifacts/zk');mkdirSync(dir,{recursive:true});
const run=(cli,args)=>{
  const p=spawnSync(process.execPath,[cli,...args],{stdio:'inherit'});
  if(p.status!==0)throw Error(`ZK build failed (${args[0]})`);
};
const snark=(...args)=>run('node_modules/snarkjs/cli.js',args);
run('node_modules/circom2/cli.js',['circuits/book-transition.circom','--r1cs','--wasm','--sym','-l','node_modules','-o',dir]);
const ptau=resolve(dir,'local-15.ptau');
if(!existsSync(ptau)){
  snark('powersoftau','new','bn128','15',resolve(dir,'pot-initial.ptau'));
  snark('powersoftau','contribute',resolve(dir,'pot-initial.ptau'),resolve(dir,'pot-contributed.ptau'),'--name=LOCAL-TEST-ONLY','-e='+randomBytes(64).toString('hex'));
  snark('powersoftau','prepare','phase2',resolve(dir,'pot-contributed.ptau'),ptau);
}
snark('groth16','setup',resolve(dir,'book-transition.r1cs'),ptau,resolve(dir,'initial.zkey'));
snark('zkey','contribute',resolve(dir,'initial.zkey'),resolve(dir,'book-transition.zkey'),'--name=LOCAL-TEST-ONLY','-e='+randomBytes(64).toString('hex'));
snark('zkey','export','verificationkey',resolve(dir,'book-transition.zkey'),resolve(dir,'verification-key.json'));
snark('zkey','export','solidityverifier',resolve(dir,'book-transition.zkey'),resolve(dir,'BookVerifier.sol'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(resolve(dir,'build.json'),JSON.stringify({createdAt:new Date().toISOString(),setup:'LOCAL_SINGLE_PARTY_TEST_ONLY',circuitSha256:sha('circuits/book-transition.circom'),r1csSha256:sha(resolve(dir,'book-transition.r1cs')),wasmSha256:sha(resolve(dir,'book-transition_js/book-transition.wasm')),zkeySha256:sha(resolve(dir,'book-transition.zkey')),verifierSha256:sha(resolve(dir,'BookVerifier.sol'))},null,2)+'\n');
console.log('ZK build complete. Local research keys; no production ceremony.');
