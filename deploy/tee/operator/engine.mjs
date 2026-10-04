import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Contract,Wallet,verifyTypedData,TypedDataEncoder,parseEther} from 'ethers';
import {buildEddsa} from 'circomlibjs';
import {SealedStore} from '../../../src/integration/sealed.js';
import {durableSubmitter} from '../../../protocol/cohort/durable-submitter.mjs';
import {createTargetProver} from '../../../protocol/perpl/target-prover.mjs';
export const intentTypes={Intent:[{name:'target',type:'int256'},{name:'seq',type:'uint256'},{name:'deadline',type:'uint256'},{name:'epoch',type:'uint256'}]};
export const intentDomain=(chainId,vault)=>({name:'Metropolis Cohort Intent',version:'1',chainId,verifyingContract:vault});
export async function operatorKeys(secret){
 const derive=label=>createHmac('sha256',secret).update(label).digest();
 const wallet=new Wallet(derive('gas-relayer-v1').toString('hex'));
 const eddsa=await buildEddsa(),key=epoch=>derive('target-signing-v1:'+epoch);
 return{wallet,key,publicKey:epoch=>eddsa.prv2pub(key(epoch)).map(x=>String(eddsa.F.toObject(x)))};
}
const vaultAbi=['function controller() view returns(address)','function operator() view returns(address)','function account() view returns(address)','function keyEpoch() view returns(uint256)','function phase() view returns(uint8)','function paused() view returns(bool)','function execute(int256,uint256,uint256,uint256,bytes)'];
const accountAbi=['function venue() view returns(address)','function collateral() view returns(address)','function position() view returns(int256,uint256,bool)','function nonce() view returns(uint256)','function activeX() view returns(uint256)','function activeY() view returns(uint256)'];
export async function createOperator({secret,provider,controller,chainId,storeDir,crash,gasBudget=parseEther('1')}){
 assert.ok([31337,10143].includes(Number(chainId)),'TESTNET_ONLY');
 const keys=await operatorKeys(secret),wallet=keys.wallet.connect(provider),prover=await createTargetProver();
 const store=new SealedStore(storeDir+'/journal.json',secret,'cohort-transactions-v1');
 const configStore=new SealedStore(storeDir+'/config.json',secret,'cohort-config-v1');
 let config=configStore.read();
 const submitter=durableSubmitter({provider,wallet,store,chainId,gasBudget,crash});
 let busy=false;
 async function configure(address){
  await submitter.sync();
  if(config){assert.equal(config.vault,address,'VAULT_ALREADY_PINNED');return;}
  const vault=new Contract(address,vaultAbi,provider);assert.equal(await vault.controller(),controller);assert.equal(await vault.operator(),wallet.address);
  const account=new Contract(await vault.account(),accountAbi,provider);
  assert.equal((await account.venue()).toLowerCase(),'0x1964c32f0be608e7d29302aff5e61268e72080cc');
  assert.equal((await account.collateral()).toLowerCase(),'0xa9012a055bd4e0edff8ce09f960291c09d5322dc');
  config={vault:address,account:await account.getAddress(),controller,chainId};configStore.write(config);
 }
 async function execute(intent,signature){
  assert.ok(!busy,'BUSY');busy=true;
  try{
   assert.ok(config,'NOT_CONFIGURED');
   const domain=intentDomain(chainId,config.vault),id=TypedDataEncoder.hash(domain,intentTypes,intent);
   assert.equal(verifyTypedData(domain,intentTypes,intent,signature),controller,'MANAGER_SIGNATURE');
   await submitter.sync();const prior=submitter.lookup(id);
   if(prior){assert.equal(prior.status,1,'MINED_REVERT');return {hash:prior.hash,status:prior.status,replayed:true};}
   const vault=new Contract(config.vault,vaultAbi,wallet),account=new Contract(config.account,accountAbi,provider);
   const epoch=await vault.keyEpoch();assert.equal(BigInt(intent.epoch),epoch,'REVOKED_EPOCH');
   assert.equal(BigInt(intent.seq),await account.nonce(),'STALE_INTENT');
   const block=await provider.getBlock('latest');assert.ok(BigInt(intent.deadline)>BigInt(block.timestamp)&&BigInt(intent.deadline)<=BigInt(block.timestamp)+600n,'INTENT_DEADLINE');
   const target=BigInt(intent.target);assert.ok(target>=-100n&&target<=100n,'TARGET_CAP');
   const phase=await vault.phase();assert.ok(phase===1n||phase===2n,'PHASE');
   if(phase===2n||await vault.paused())assert.equal(target,0n,'REDUCE_ONLY');
   const pub=keys.publicKey(epoch);assert.equal(String(await account.activeX()),pub[0]);assert.equal(String(await account.activeY()),pub[1]);
   const [position,mark,valid]=await account.position();assert.ok(valid&&mark>0n,'INVALID_ORACLE');
   const price=target>position?mark*10050n/10000n:mark*9950n/10000n;
   const witness=prover.input({chainId:BigInt(chainId),account:config.account,market:16n,nonce:BigInt(intent.seq),target,position,limitPrice:price,deadline:BigInt(intent.deadline),maxLots:100n},keys.key(epoch));
   const proof=await prover.prove(witness);
   const request=await vault.execute.populateTransaction(target,price,intent.seq,intent.deadline,proof.encodedProof);
   const sent=await submitter.submit(id,request);
   return {hash:sent.hash,status:sent.status,proof:proof.proof,publicSignals:proof.publicSignals,milliseconds:proof.milliseconds,replayed:false};
  }finally{busy=false;}
 }
 return{configure,execute,identity:epoch=>({operator:wallet.address,epoch:String(epoch),managerPublicKey:keys.publicKey(epoch)}),status:()=>submitter.publicState()};
}
