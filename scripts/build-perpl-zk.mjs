import { spawnSync } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
const dir='artifacts/perpl-zk';mkdirSync(dir,{recursive:true});
const run=(cli,args)=>{const r=spawnSync(process.execPath,[cli,...args],{stdio:'inherit'});if(r.status!==0)throw Error('Build failed: '+args[0]);};
const snark=(...args)=>run('node_modules/snarkjs/cli.js',args);
run('node_modules/circom2/cli.js',['circuits/perpl-target-mvp.circom','--r1cs','--wasm','--sym','-l','node_modules','-o',dir]);
// Reuse the existing LOCAL single-party phase 1 if available; never production keys.
let ptau='artifacts/zk/local-15.ptau';
if(!existsSync(ptau)) {
  ptau=dir+'/local-15.ptau';
  if(!existsSync(ptau)) {
    snark('powersoftau','new','bn128','15',dir+'/pot-initial.ptau');
    snark('powersoftau','contribute',dir+'/pot-initial.ptau',dir+'/pot-contributed.ptau','--name=LOCAL-TEST-ONLY','-e='+randomBytes(64).toString('hex'));
    snark('powersoftau','prepare','phase2',dir+'/pot-contributed.ptau',ptau);
  }
}
snark('groth16','setup',dir+'/perpl-target-mvp.r1cs',ptau,dir+'/initial.zkey');
snark('zkey','contribute',dir+'/initial.zkey',dir+'/perpl-target-mvp.zkey','--name=LOCAL-TEST-ONLY','-e='+randomBytes(64).toString('hex'));
snark('zkey','export','verificationkey',dir+'/perpl-target-mvp.zkey',dir+'/verification-key.json');
snark('zkey','export','solidityverifier',dir+'/perpl-target-mvp.zkey',dir+'/TargetVerifier.sol');
const files=['circuits/perpl-target-mvp.circom',dir+'/perpl-target-mvp.r1cs',dir+'/perpl-target-mvp_js/perpl-target-mvp.wasm',dir+'/perpl-target-mvp.zkey',dir+'/TargetVerifier.sol'];
writeFileSync(dir+'/build.json',JSON.stringify({createdAt:new Date().toISOString(),setup:'LOCAL_SINGLE_PARTY_TEST_ONLY',sha256:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2)+'\n');
