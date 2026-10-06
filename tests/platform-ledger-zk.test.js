import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {wtns} from 'snarkjs';
import {Wallet} from 'ethers';
import {newBook,depositPending,activatePending,markBook,markVenueEquity,crystallizeFees,burnWithdrawal} from '../deploy/tee/operator/ledger.mjs';
import {ledgerEvent,flushLedgerMark,financialSnapshot} from '../deploy/tee/operator/ledger-journal.mjs';
import {createLedgerWitness,clone} from '../protocol/platform/ledger-witness.mjs';
import {proveLedgerTransition} from '../deploy/tee/operator/ledger-prover.mjs';
import {LedgerProofs} from '../deploy/tee/operator/ledger-proofs.mjs';
import {compileLedgerContracts} from '../protocol/platform/ledger-contracts.mjs';
import {createLocalPilotChain} from '../src/pilot/chain.js';

const manifest=JSON.parse(readFileSync('public/zk/platform-ledger-v1/manifest.json'));
const artifacts=Object.fromEntries(['wasm','zkey','verificationKey'].map(kind=>[kind,'public'+manifest.artifacts[kind].path]));
const vault='0xdC4e5675cD4b4E10E1D2274Abc3Fd9100c0334b6',alice='0x'+'11'.repeat(20),bob='0x'+'22'.repeat(20);

test('real financial journal matches all circuit operations and rejects a changed mint and private Merkle path',async()=>{
 const builder=await createLedgerWitness(),book=newBook({id:'private-strategy',strategist_wallet:alice,fee_bps:2000});
 const genesis=builder.importBook(book.zkLedger.baseline);
 depositPending(book,alice,'100000001');activatePending(book);
 depositPending(book,alice,'30000002');activatePending(book);
 depositPending(book,bob,'12000000');
 book.investors[bob].pending='11000000';book.investors[bob].paid='1000000';ledgerEvent(book,'PENDING_PAY',{wallet:bob,amount:'1000000'});
 markBook(book,'140000000');markVenueEquity(book,'145000000');crystallizeFees(book);
 book.cash=String(BigInt(book.cash)-1000n);ledgerEvent(book,'VENUE',{delta:'-1000'});
 book.cash=String(BigInt(book.cash)+1000n);ledgerEvent(book,'VENUE',{delta:'1000'});
 const fees=book.feesDue;book.cash=String(BigInt(book.cash)-BigInt(fees));book.feesDue='0';ledgerEvent(book,'FEE_PAY',{amount:fees});
 book.feeBps=1000;ledgerEvent(book,'POLICY',{feeBps:1000});
 burnWithdrawal(book,{wallet:alice,units:'10000001'},'10000000');
 flushLedgerMark(book);
 let mirrors=[genesis],salt='1',sequence=0,mintWitness;
 const temp=mkdtempSync(join(tmpdir(),'ledger-witness-'));
 try {
  for(const event of book.zkLedger.events){
   const transition=builder.transition({mirrors,bookIndex:0,event,salt,sequence:++sequence,checkpointAt:1800000000,vault});
   await wtns.calculate(transition.witness,artifacts.wasm,join(temp,'witness.wtns'));
   if(event.kind==='MINT')mintWitness ||= clone(transition.witness);
   mirrors=transition.next;salt=transition.salt;
  }
  builder.assertMatches(financialSnapshot(book),mirrors[0]);
  const tampered=clone(mintWitness);tampered.events[0][4]=String(BigInt(tampered.events[0][4])+1n);
  await assert.rejects(()=>wtns.calculate(tampered,artifacts.wasm,join(temp,'bad.wtns')));
  const path=clone(mintWitness);path.lotSiblings[0][0]=String(BigInt(path.lotSiblings[0][0])+1n);
  await assert.rejects(()=>wtns.calculate(path,artifacts.wasm,join(temp,'bad.wtns')));
  const registration=builder.transition({mirrors:[builder.blankBook()],bookIndex:0,event:{kind:'REGISTER',id:'next-private-book',feeBps:2000},salt:'1',sequence:1,checkpointAt:1800000000,vault});
  await wtns.calculate(registration.witness,artifacts.wasm,join(temp,'register.wtns'));
  for(const event of [{kind:'NONE'},{kind:'VALUE',equity:'3'}]){
   const t=builder.transition({mirrors:registration.next,bookIndex:0,event,salt:registration.salt,sequence:2,checkpointAt:1800000000,vault});
   await wtns.calculate(t.witness,artifacts.wasm,join(temp,'extra.wtns'));
  }
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('actual Groth16 proof is accepted by deployed verifier and rejects replay, tampering, wrong domain and outsider',async()=>{
 const chain=await createLocalPilotChain(compileLedgerContracts());
 try {
  const builder=await createLedgerWitness(),book=newBook({id:'secret-book',strategist_wallet:alice,fee_bps:2000});
  const transition=builder.transition({mirrors:[builder.importBook(book.zkLedger.baseline)],bookIndex:0,event:{kind:'DEPOSIT',wallet:alice,amount:'1000000'},salt:'1',sequence:1,checkpointAt:await chain.now(),chainId:31337,vault});
  const result=await proveLedgerTransition(transition.witness,artifacts);
  const verifier=await chain.deploy('verifier','LedgerVerifier',[]),registry=await chain.deploy('registry','PlatformLedgerCheckpoint',[chain.accounts[0],vault,verifier.address,'0x'+manifest.artifacts.verificationKey.sha256]);
  await chain.tx('genesis',registry,'initializeRoot',[transition.oldRoot]);
  await assert.rejects(()=>chain.tx('outsider',registry,'append',result.calldata,1),/OPERATOR/);
  const wrongDomain=clone(result.calldata);wrongDomain[3][0]='10143';await assert.rejects(()=>chain.tx('wrong domain',registry,'append',wrongDomain),/DOMAIN/);
  const wrongProof=clone(result.calldata);wrongProof[3][6]=String(BigInt(wrongProof[3][6])+1n);await assert.rejects(()=>chain.tx('invalid proof',registry,'append',wrongProof),/PROOF/);
  const receipt=await chain.tx('valid proof',registry,'append',result.calldata);
  assert.equal((await chain.read(registry,'sequence'))[0],1n);assert.equal(String((await chain.read(registry,'root'))[0]),transition.newRoot);
  await assert.rejects(()=>chain.tx('replayed proof',registry,'append',result.calldata),/CONTINUITY/);
  console.log(JSON.stringify({actualProofVerified:true,provingMs:result.provingMs,verifierGas:receipt.gasUsed}));
 }finally{chain.close();}
});

test('checkpoint retry recovers archived proof without reproving; missing actual mutation halts publication',async()=>{
 const builder=await createLedgerWitness(),book=newBook({id:'private-resume',strategist_wallet:alice,fee_bps:2000});
 let state={config:{vaultAddress:vault},books:{[book.id]:book}};
 const investments={state:()=>clone(state),serial:fn=>Promise.resolve().then(fn),store:{write:value=>{state=clone(value);}}};
 const temp=mkdtempSync(join(tmpdir(),'ledger-resume-')),wallet=Wallet.createRandom();
 const service=new LedgerProofs({investments,execution:{},wallet,storeDir:temp,manifest});service.builder=builder;service.artifacts=artifacts;service.ready=true;
 const mirrors=[builder.importBook(book.zkLedger.baseline)],salt='1';
 state.ledgerProofs={mirrors,indexes:{[book.id]:0},salt,root:String(builder.commitment(builder.globalTree(mirrors).root,salt,10143,vault)),vault,sequence:0,nextCheckpointAt:0};
 depositPending(state.books[book.id],alice,'10');await service.freeze(1800000000);await service.validateJob();const page=await service.preparePage();
 let proofs=0;service.prove=async witness=>{proofs++;return {proof:{testFixture:true},publicSignals:witness.pub.map(String),calldata:[],provingMs:1};};
 const saved=clone(state),write=investments.store.write;let crash=true;
 investments.store.write=value=>{if(crash){crash=false;throw Error('simulated crash after public archive');}write(value);};
 await assert.rejects(()=>service.provePage(page),/simulated crash/);state=saved;
 await service.provePage(await service.preparePage());assert.equal(proofs,1);assert.equal(state.ledgerProofs.sequence,1);
 await service.preparePage();assert.equal(service.proofs().records.length,1);
 const json=JSON.stringify(service.proofs());assert.ok(!json.includes(book.id));assert.ok(!json.toLowerCase().includes(alice.toLowerCase()));assert.ok(!json.includes('witness'));
 state.books[book.id].cash='999';await service.freeze(1800000300);await assert.rejects(()=>service.validateJob(),/LEDGER_SNAPSHOT_BOOK_MISMATCH/);
 assert.equal(service.proofs().lastSequence,1);
 rmSync(temp,{recursive:true,force:true});
});
