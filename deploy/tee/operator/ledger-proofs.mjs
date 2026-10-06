import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {Contract,keccak256,toUtf8Bytes,verifyMessage} from 'ethers';
import {createLedgerWitness,randomSalt,clone} from '../../../protocol/platform/ledger-witness.mjs';
import {initializeLedgerJournal,flushLedgerMark,financialSnapshot} from './ledger-journal.mjs';
import {proveLedgerTransition} from './ledger-prover.mjs';

export const checkpointAbi=['function operator() view returns(address)','function vault() view returns(address)','function verifier() view returns(address)','function verificationKeyHash() view returns(bytes32)','function root() view returns(uint256)','function sequence() view returns(uint256)','function genesisRoot() view returns(uint256)','function initializeRoot(uint256)','function append(uint256[2],uint256[2][2],uint256[2],uint256[7])','event TransitionVerified(uint256 indexed sequence,uint256 indexed checkpointAt,uint256 oldRoot,uint256 newRoot,uint256 eventsRoot)'];
export const proofMessage=payload=>`VEILVEST_LEDGER_PROOF_V1\n${JSON.stringify(payload)}`;
const sha=value=>createHash('sha256').update(value).digest('hex');
export function rescheduleLedgerCheckpoint(ledger,intervalSeconds,now) {
 if(ledger.checkpointIntervalSeconds===intervalSeconds)return;
 ledger.checkpointIntervalSeconds=intervalSeconds;
 ledger.nextCheckpointAt=now+intervalSeconds;
}
function atomicPublic(path,value) {
 const temporary=path+'.pending';writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flush:true});renameSync(temporary,path);
 const fd=openSync(path.slice(0,path.lastIndexOf('/')),'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
const publicErrors=new Set(['LEDGER_INVESTOR_CAPACITY','LEDGER_LOT_CAPACITY','LEDGER_STRATEGY_CAPACITY','LEDGER_PROVING_FAILED','LEDGER_PROVING_TIMEOUT','OPERATOR_GAS_INSUFFICIENT','LEDGER_REGISTRY_UNAVAILABLE','LEDGER_ARTIFACT_UNAVAILABLE','LEDGER_SNAPSHOT_BOOK_MISMATCH','LEDGER_SNAPSHOT_ACCOUNT_MISMATCH','LEDGER_SNAPSHOT_LOT_MISMATCH']);
export class LedgerProofs {
 constructor({investments,execution,wallet,storeDir,manifest,artifactBase='https://mm-zkquant.vercel.app',prove=proveLedgerTransition}) {
  Object.assign(this,{investments,execution,wallet,storeDir,manifest,artifactBase,prove});
  this.intervalSeconds=manifest.intervalSeconds||3600;this.proofDir=`${storeDir}/platform-ledger-proofs`;mkdirSync(this.proofDir,{recursive:true,mode:0o700});
 }
 save(state){this.investments.store.write(state);}
 async initialize() {
  if(this.initializing)return;this.initializing=true;
  try {
  this.builder=await createLedgerWitness();
  await this.investments.serial(()=>{
   const state=this.investments.state();if(!state.config)throw Error('VAULT_UNAVAILABLE');
   if(!state.ledgerProofs){
    const mirrors=[],indexes={};
    for(const book of Object.values(state.books)){
     initializeLedgerJournal(book);if(mirrors.length>=4096)throw Error('LEDGER_STRATEGY_CAPACITY');
     indexes[book.id]=mirrors.length;mirrors.push(this.builder.importBook(book.zkLedger.baseline));
    }
    const salt=String(randomSalt()),root=String(this.builder.commitment(this.builder.globalTree(mirrors).root,salt,10143,state.config.vaultAddress));
    state.ledgerProofs={version:1,verificationKeyHash:this.manifest.artifacts.verificationKey.sha256,vault:state.config.vaultAddress,genesisAt:Math.floor(Date.now()/1000),genesisRoot:root,root,sequence:0,salt,mirrors,indexes,lastAnchoredSequence:0,lastCompleted:null,nextCheckpointAt:Math.floor(Date.now()/1000)+10,checkpointIntervalSeconds:this.intervalSeconds,error:null};
   }
   const ledger=state.ledgerProofs;
   if(ledger.verificationKeyHash!==this.manifest.artifacts.verificationKey.sha256||ledger.vault.toLowerCase()!==state.config.vaultAddress.toLowerCase())throw Error('LEDGER_DOMAIN_CHANGED');
   rescheduleLedgerCheckpoint(ledger,this.intervalSeconds,Math.floor(Date.now()/1000));
   for(const book of Object.values(state.books))initializeLedgerJournal(book);
   this.save(state);
  });
  const artifactDir=`${this.storeDir}/ledger-zk-${this.manifest.artifacts.zkey.sha256.slice(0,16)}`;
  mkdirSync(artifactDir,{recursive:true,mode:0o700});this.artifacts={};
  for(const kind of ['wasm','zkey','verificationKey']){
   const spec=this.manifest.artifacts[kind],path=`${artifactDir}/${kind}`;
   if(!existsSync(path)||sha(readFileSync(path))!==spec.sha256){
    const response=await fetch(`${this.artifactBase}${spec.path}`,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error('LEDGER_ARTIFACT_UNAVAILABLE');const data=Buffer.from(await response.arrayBuffer());
    if(data.length!==spec.bytes||sha(data)!==spec.sha256)throw Error('LEDGER_ARTIFACT_MISMATCH');writeFileSync(path,data,{mode:0o600,flush:true});
   }this.artifacts[kind]=path;
  }
  if(this.manifest.deployment){
   const d=this.manifest.deployment;this.registry=new Contract(d.checkpoint,checkpointAbi,this.wallet);
   const [operator,vault,keyHash,verifier,code,verifierCode]=await Promise.all([this.registry.operator(),this.registry.vault(),this.registry.verificationKeyHash(),this.registry.verifier(),this.execution.provider.getCode(d.checkpoint),this.execution.provider.getCode(d.verifier)]);
   if(operator.toLowerCase()!==this.wallet.address.toLowerCase()||vault.toLowerCase()!==this.investments.state().config.vaultAddress.toLowerCase()||keyHash!==`0x${this.manifest.artifacts.verificationKey.sha256}`||verifier.toLowerCase()!==d.verifier.toLowerCase()||keccak256(code)!==d.checkpointCodeHash||keccak256(verifierCode)!==d.verifierCodeHash)throw Error('LEDGER_REGISTRY_MISMATCH');
  }
  this.ready=true;this.initializationError=null;
  }catch(error){this.initializationError=publicErrors.has(error.message)?error.message:'LEDGER_PROOF_INITIALIZATION_FAILED';throw error;}
  finally{this.initializing=false;}
 }
 archive(sequence){const path=`${this.proofDir}/${sequence}.json`;return existsSync(path)?JSON.parse(readFileSync(path)):null;}
 writeArchive(record){atomicPublic(`${this.proofDir}/${record.payload.sequence}.json`,record);}
 async freeze(now) {
  return this.investments.serial(()=>{
   const state=this.investments.state(),ledger=state.ledgerProofs;if(ledger.job||now<ledger.nextCheckpointAt)return;
   const tasks=[],replayed=clone(ledger.mirrors);
   for(const book of Object.values(state.books)){
    initializeLedgerJournal(book);flushLedgerMark(book);
    let events=clone(book.zkLedger.events);
    if(ledger.indexes[book.id]===undefined){
     if(ledger.mirrors.length>=4096)throw Error('LEDGER_STRATEGY_CAPACITY');
     ledger.indexes[book.id]=ledger.mirrors.length;ledger.mirrors.push(this.builder.blankBook());events.unshift({kind:'REGISTER',id:book.id,feeBps:book.zkLedger.baseline.feeBps});
     replayed.push(this.builder.blankBook());
    }
    const mirror=replayed[ledger.indexes[book.id]];
    events=events.filter(event=>{
     const previous=JSON.stringify(mirror.fields);this.builder.applyEvent(mirror,event);
     // An unchanged valuation updates no proven field. Carry the unchanged book
     // in the global tree and use one heartbeat if the whole ledger is idle.
     return !['MARK','VALUE'].includes(event.kind)||JSON.stringify(mirror.fields)!==previous;
    });
    tasks.push({bookId:book.id,index:ledger.indexes[book.id],events,snapshot:financialSnapshot(book)});
    book.zkLedger.events=[];
   }
   if(!tasks.some(task=>task.events.length)){
    if(!ledger.mirrors.length)ledger.mirrors.push(this.builder.blankBook());
    if(!tasks.length)tasks.push({bookId:null,index:0,events:[{kind:'NONE'}],snapshot:null});else tasks[0].events.push({kind:'NONE'});
   }
   ledger.job={checkpointAt:now,firstSequence:ledger.sequence+1,tasks,task:0,event:0,validated:false};
   ledger.nextCheckpointAt=now+this.intervalSeconds;ledger.error=null;this.save(state);
  });
 }
 async validateJob() {
  const state=this.investments.state(),job=state.ledgerProofs.job;if(!job||job.validated)return;
  const mirrors=clone(state.ledgerProofs.mirrors);
  for(const task of job.tasks){for(const event of task.events)this.builder.applyEvent(mirrors[task.index],event);if(task.snapshot)this.builder.assertMatches(task.snapshot,mirrors[task.index]);}
  await this.investments.serial(()=>{const current=this.investments.state();current.ledgerProofs.job.validated=true;this.save(current);});
 }
 async preparePage() {
  return this.investments.serial(()=>{
   const state=this.investments.state(),ledger=state.ledgerProofs,job=ledger.job;if(!job)return null;
   if(ledger.page)return clone(ledger.page);
   while(job.task<job.tasks.length&&job.event>=job.tasks[job.task].events.length){job.task++;job.event=0;}
   if(job.task>=job.tasks.length){
    ledger.lastCompleted={checkpointAt:job.checkpointAt,verifiedAt:Math.floor(Date.now()/1000),firstSequence:job.firstSequence,lastSequence:ledger.sequence,root:ledger.root};
    delete ledger.job;ledger.error=null;this.save(state);return null;
   }
   const task=job.tasks[job.task],transition=this.builder.transition({mirrors:ledger.mirrors,bookIndex:task.index,event:task.events[job.event],salt:ledger.salt,sequence:ledger.sequence+1,checkpointAt:job.checkpointAt,vault:ledger.vault});
   ledger.page={witness:transition.witness,index:task.index,nextMirror:transition.next[task.index],salt:transition.salt,oldRoot:transition.oldRoot,newRoot:transition.newRoot};
   if(ledger.page.oldRoot!==ledger.root)throw Error('LEDGER_ROOT_DIVERGED');this.save(state);return clone(ledger.page);
  });
 }
 async provePage(page) {
  const sequence=Number(page.witness.pub[2]);let record=this.archive(sequence);
  if(record){
   if(verifyMessage(proofMessage(record.payload),record.signature).toLowerCase()!==this.wallet.address.toLowerCase()||JSON.stringify(record.payload.publicSignals)!==JSON.stringify(page.witness.pub.map(String)))throw Error('LEDGER_ARCHIVE_MISMATCH');
  }else{
   const result=await this.prove(page.witness,this.artifacts);
   if(JSON.stringify(result.publicSignals)!==JSON.stringify(page.witness.pub.map(String)))throw Error('LEDGER_PROOF_SIGNALS_MISMATCH');
   const payload={version:1,sequence,checkpointAt:Number(result.publicSignals[3]),verificationKeyHash:this.manifest.artifacts.verificationKey.sha256,proof:result.proof,publicSignals:result.publicSignals,calldata:result.calldata,provingMs:result.provingMs,verifiedAt:Math.floor(Date.now()/1000)};
   record={payload,signature:await this.wallet.signMessage(proofMessage(payload)),anchored:null};this.writeArchive(record);
  }
  await this.investments.serial(()=>{
   const state=this.investments.state(),ledger=state.ledgerProofs;
   if(ledger.sequence+1!==sequence||ledger.root!==page.oldRoot)throw Error('LEDGER_ROOT_DIVERGED');
   ledger.mirrors[page.index]=page.nextMirror;ledger.salt=page.salt;ledger.root=page.newRoot;ledger.sequence=sequence;
   ledger.job.event++;delete ledger.page;ledger.error=null;this.save(state);
  });
 }
 async anchor() {
  if(!this.registry)return;
  await this.investments.serial(async()=>{
   const state=this.investments.state(),ledger=state.ledgerProofs;
   if(!ledger.registryInitialized){
    const root=String(await this.registry.genesisRoot());
    if(root==='0'){
     const id=keccak256(toUtf8Bytes(`platform-ledger-genesis:${this.manifest.deployment.checkpoint}`));
     const prior=this.execution.submitter.lookup(id);if(prior?.status!==1)await this.execution.submitter.submit(id,await this.registry.initializeRoot.populateTransaction(ledger.genesisRoot));
    }else if(root!==ledger.genesisRoot)throw Error('LEDGER_GENESIS_MISMATCH');
    ledger.registryInitialized=true;this.save(state);
   }
   if(ledger.lastAnchoredSequence>=ledger.sequence)return;
   const sequence=ledger.lastAnchoredSequence+1,record=this.archive(sequence);if(!record)throw Error('LEDGER_ARCHIVE_MISSING');
   const id=keccak256(toUtf8Bytes(`platform-ledger-proof:${this.manifest.deployment.checkpoint}:${sequence}`));
   const prior=this.execution.submitter.lookup(id),result=prior?.status===1?prior:await this.execution.submitter.submit(id,await this.registry.append.populateTransaction(...record.payload.calldata));
   record.anchored={txHash:result.hash,blockNumber:result.block};this.writeArchive(record);
   ledger.lastAnchoredSequence=sequence;ledger.error=null;this.save(state);
  });
 }
 async tick(now=Math.floor(Date.now()/1000)) {
  if(!this.ready||this.running)return;this.running=true;
  try {
   await this.anchor();await this.freeze(now);await this.validateJob();
   let page=await this.preparePage();
   while(page){await this.provePage(page);await this.anchor();page=await this.preparePage();}
  }catch(error){
   await this.investments.serial(()=>{const state=this.investments.state();state.ledgerProofs.error=publicErrors.has(error.message)?error.message:'LEDGER_PROOF_RECONCILIATION_REQUIRED';this.save(state);});
  }finally{this.running=false;}
 }
 status() {
  const ledger=this.investments.state().ledgerProofs;if(!ledger)return {enabled:true,ready:false,status:this.initializationError?'ATTENTION_REQUIRED':'INITIALIZING',error:this.initializationError||null};
  const completed=ledger.lastCompleted,onchain=completed&&ledger.lastAnchoredSequence>=completed.lastSequence;
  return {enabled:true,ready:Boolean(this.ready),status:(ledger.error||this.initializationError)?'ATTENTION_REQUIRED':ledger.job?'PROVING':!completed?'INITIALIZING':onchain&&this.registry?'ONCHAIN_VERIFIED':'VERIFIED_OFFCHAIN',error:ledger.error||this.initializationError||null,
   intervalSeconds:this.intervalSeconds,genesisRoot:ledger.genesisRoot,genesisAt:ledger.genesisAt,operator:this.wallet.address,vault:ledger.vault,verificationKeyHash:ledger.verificationKeyHash,setup:this.manifest.setup,
   checkpoint:completed?{...completed,onchainVerified:Boolean(onchain&&this.registry),transaction:this.archive(completed.lastSequence)?.anchored||null}:null,
   registry:this.manifest.deployment?.checkpoint||null,verifier:this.manifest.deployment?.verifier||null,nextCheckpointAt:ledger.nextCheckpointAt};
 }
 proofs({after=0,limit=20}={}) {
  const ledger=this.investments.state().ledgerProofs,last=ledger?.lastCompleted?.lastSequence||0;
  const records=[];for(let sequence=Math.max(1,after+1);sequence<=last&&records.length<limit;sequence++){const record=this.archive(sequence);if(!record)throw Error('LEDGER_ARCHIVE_MISSING');records.push(record);}
  return {records,lastSequence:last,hasMore:records.length?records.at(-1).payload.sequence<last:false};
 }
 attestation(){const ledger=this.investments.state().ledgerProofs;return ledger?{genesisRoot:ledger.genesisRoot,genesisAt:ledger.genesisAt,verificationKeyHash:ledger.verificationKeyHash,registry:this.manifest.deployment?.checkpoint||null}:null;}
}
