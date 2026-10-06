import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,copyFileSync,rmSync} from 'node:fs';
const dir='artifacts/platform-ledger-zk',published='public/zk/platform-ledger-v1';
mkdirSync(dir,{recursive:true});mkdirSync(published,{recursive:true});
const run=(cli,args)=>{const result=spawnSync(process.execPath,[cli,...args],{stdio:'inherit'});if(result.status!==0)throw Error('Ledger circuit build failed');};
const snark=(...args)=>run('node_modules/snarkjs/cli.js',args);
run('scripts/generate-platform-ledger-circuit.mjs',[]);
if(existsSync(published+'/deployment.json')&&process.argv.includes('--fresh-testnet-key'))throw Error('This key is deployed: create a versioned circuit and a new verifier deployment instead');
if(existsSync(published+'/manifest.json')){
 const pinned=JSON.parse(readFileSync(published+'/manifest.json'));
 for(const [path,hash]of Object.entries(pinned.sourceHashes))if(createHash('sha256').update(readFileSync(path)).digest('hex')!==hash)throw Error('Published circuit changed: use a versioned circuit and a new verifier deployment');
 if(!existsSync(dir+'/platform-ledger-transition.zkey')&&existsSync(published+'/proving.zkey')){
  if(createHash('sha256').update(readFileSync(published+'/proving.zkey')).digest('hex')!==pinned.artifacts.zkey.sha256)throw Error('Published proving key differs from manifest');
  copyFileSync(published+'/proving.zkey',dir+'/platform-ledger-transition.zkey');
 }
}
if(process.argv.includes('--fresh-testnet-key'))for(const name of ['initial.zkey','platform-ledger-transition.zkey','build.json'])rmSync(`${dir}/${name}`,{force:true});
if(existsSync(dir+'/build.json')){
 const prior=JSON.parse(readFileSync(dir+'/build.json'));
 for(const [path,hash]of Object.entries(prior.sourceHashes))if(createHash('sha256').update(readFileSync(path)).digest('hex')!==hash)throw Error('Circuit changed: use a new testnet key and verifier deployment; never overwrite a pinned key silently');
}
run('node_modules/circom2/cli.js',['circuits/platform-ledger-transition.circom','--r1cs','--wasm','--sym','--O2','-l','node_modules','-o',dir]);
const ptau=dir+'/powersOfTau28_hez_final_16.ptau';
const phase1Url='https://circom.info/powersOfTau28_hez_final_16.ptau';
if(!existsSync(ptau)){
 const response=await fetch(phase1Url);if(!response.ok)throw Error('Cannot download public phase 1');
 writeFileSync(ptau,Buffer.from(await response.arrayBuffer()));
}
const expectedPhase1Blake2b='6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125';
if(createHash('blake2b512').update(readFileSync(ptau)).digest('hex')!==expectedPhase1Blake2b)throw Error('Public phase 1 hash does not match the snarkjs ceremony');
// Immutable testnet key. Never regenerate an existing deployment's proving key.
const zkey=dir+'/platform-ledger-transition.zkey';
if(!existsSync(zkey)){
 snark('groth16','setup',dir+'/platform-ledger-transition.r1cs',ptau,dir+'/initial.zkey');
 snark('zkey','contribute',dir+'/initial.zkey',zkey,'--name=VEILVEST-TESTNET-SINGLE-PARTY-PHASE2','-e='+randomBytes(64).toString('hex'));
}
snark('zkey','export','verificationkey',zkey,dir+'/verification-key.json');
snark('zkey','export','solidityverifier',zkey,dir+'/LedgerVerifier.sol');
const sources=['circuits/platform-ledger-transition.circom','circuits/platform-ledger-transition.template.circom'];
const artifacts={wasm:dir+'/platform-ledger-transition_js/platform-ledger-transition.wasm',zkey,verificationKey:dir+'/verification-key.json',verifier:dir+'/LedgerVerifier.sol'};
const names={wasm:'circuit.wasm',zkey:'proving.zkey',verificationKey:'verification-key.json',verifier:'LedgerVerifier.sol'};
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
for(const [kind,path]of Object.entries(artifacts))copyFileSync(path,`${published}/${names[kind]}`);
const manifest={version:1,circuit:'platform-ledger-transition',protocol:'groth16',curve:'bn128',intervalSeconds:3600,setup:'PUBLIC_PHASE1_SINGLE_PARTY_TESTNET_PHASE2',phase1Url,phase1Sha256:sha(ptau),capacity:{strategies:4096,investorsPerStrategy:16,activeLotsPerInvestor:64,eventsPerProof:1},
 sourceHashes:Object.fromEntries(sources.map(path=>[path,sha(path)])),artifacts:Object.fromEntries(Object.entries(artifacts).map(([kind,path])=>[kind,{path:`/zk/platform-ledger-v1/${names[kind]}`,sha256:sha(path),bytes:readFileSync(path).length}]))};
writeFileSync(dir+'/build.json',JSON.stringify(manifest,null,2)+'\n');writeFileSync(published+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({built:true,setup:manifest.setup,artifacts:manifest.artifacts}));
