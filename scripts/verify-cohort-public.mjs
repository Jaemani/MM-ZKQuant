import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';
import{JsonRpcProvider,Contract,ContractFactory,AbiCoder}from'ethers';import{groth16,curves}from'snarkjs';import solc from'solc';import{poseidonContract}from'circomlibjs';
import{verifiedTdxBody,replayTdxEvents}from'../src/integration/tdx-quote.js';
import{settleCohort}from'../protocol/cohort/accounting.mjs';
const r=JSON.parse(readFileSync('docs/evidence/cohort-public.json')),deployment=JSON.parse(readFileSync('docs/evidence/cohort-operator-deployment.json'));
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2),sha=x=>createHash('sha256').update(x).digest('hex');
const audit={observedAt:new Date().toISOString(),status:'RUNNING',checks:[],traces:[],limitations:['RPC and vendor attestation verification trust','One terminal cohort; not full v1 Ledger','Historical attestation, not a fresh challenge']};
try{
 assert.equal(r.status,'PASS_PUBLIC_TEE_COHORT_LEDGER_REDEMPTION');assert.equal((await rpc.getNetwork()).chainId,10143n);
 const sources=Object.fromEntries(['PerplMvpAccount.sol','PerplZkMvpAccount.sol','PerplCohortVault.sol'].map(n=>[n,{content:readFileSync('contracts/perpl/'+n,'utf8')}]));
 sources['TargetVerifier.sol']={content:readFileSync('docs/evidence/public-zk-verifier.sol','utf8')};sources['LedgerVerifier.sol']={content:readFileSync('docs/evidence/cohort-ledger-verifier.sol','utf8')};
 assert.equal(sha(json(sources)),r.sourceHash);
 const compiled=JSON.parse(solc.compile(json({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}})));
 assert.equal(compiled.errors?.filter(e=>e.severity==='error').length||0,0);
 const entries=Object.fromEntries(r.transactions.map(t=>[t.name,t])),receipts={},transactions={};
 for(const t of r.transactions){const receipt=await rpc.getTransactionReceipt(t.hash),tx=await rpc.getTransaction(t.hash);assert.equal(receipt.status,1);assert.equal(receipt.blockNumber,t.block);assert.equal(tx.chainId,10143n);assert.equal(String(receipt.fee),t.fee);receipts[t.name]=receipt;transactions[t.name]=tx;}
 const tv=compiled.contracts['TargetVerifier.sol'].Groth16Verifier,lv=compiled.contracts['LedgerVerifier.sol'].Groth16Verifier,vc=compiled.contracts['PerplCohortVault.sol'].PerplCohortVault,ac=compiled.contracts['PerplCohortVault.sol'].PerplCohortAccount;
 for(const [label,c]of [['deploy-target-verifier',tv],['deploy-ledger-verifier',lv]]){
  assert.equal(transactions[label].data,(await new ContractFactory(c.abi,c.evm.bytecode.object).getDeployTransaction()).data);
  assert.equal(await rpc.getCode(entries[label].contractAddress),'0x'+c.evm.deployedBytecode.object);
 }
 const vault=new Contract(r.vault,vc.abi,rpc),account=new Contract(r.account,ac.abi,rpc),token=new Contract(await vault.token(),['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)'],rpc);
 const params=[await account.venue(),await vault.token(),r.owner,r.operator,[r.owner,r.investor],r.owner,2000,entries['deploy-target-verifier'].contractAddress,entries['deploy-ledger-verifier'].contractAddress,entries['deploy-poseidon'].contractAddress,r.hardware.identity.managerKeys[0]];
 assert.equal(transactions['deploy-vault'].data,(await new ContractFactory(vc.abi,vc.evm.bytecode.object).getDeployTransaction(...params)).data);
 assert.equal(transactions['deploy-poseidon'].data,(await new ContractFactory(poseidonContract.generateABI(6),poseidonContract.createCode(6)).getDeployTransaction()).data);
 for(const [address,c]of [[r.vault,vc],[r.account,ac]]){const code=Buffer.from((await rpc.getCode(address)).slice(2),'hex');for(const refs of Object.values(c.evm.deployedBytecode.immutableReferences))for(const {start,length}of refs)code.fill(0,start,start+length);assert.equal(code.toString('hex'),c.evm.deployedBytecode.object);}
 assert.equal(await vault.account(),r.account);assert.equal(await vault.operator(),r.operator);assert.equal(await account.beneficiary(),r.vault);assert.equal(await vault.keyEpoch(),1n);assert.deepEqual([String(await account.activeX()),String(await account.activeY())],r.hardware.identity.managerKeys[1]);
 audit.checks.push('all-receipts-and-deployment-calldata-runtime-match');
 const field=x=>x<0n?21888242871839275222246405745257275088548364400416034343698204186575808495617n+x:x;
 for(const name of Object.keys(r.execution)){
  const tx=transactions[name],receipt=receipts[name];assert.equal(tx.from,r.operator);assert.equal(tx.to,r.vault);
  const [target,price,seq,deadline,encoded]=vault.interface.parseTransaction({data:tx.data}).args;
  const before=(await account.position({blockTag:receipt.blockNumber-1}))[0],after=(await account.position({blockTag:receipt.blockNumber}))[0];
  const key=[await account.activeX({blockTag:receipt.blockNumber}),await account.activeY({blockTag:receipt.blockNumber})];
  const signals=[10143n,BigInt(r.account),16n,seq,field(target),field(before),price,deadline,100n,...key];
  const decoded=AbiCoder.defaultAbiCoder().decode(['uint256[2]','uint256[2][2]','uint256[2]'],encoded).toArray(true);
  const verifier=new Contract(entries['deploy-target-verifier'].contractAddress,tv.abi,rpc);assert.equal(await verifier.verifyProof(...decoded,signals),true);
  const trace=await rpc.send('debug_traceTransaction',[tx.hash,{tracer:'callTracer'}]),flat=c=>[c,...(c.calls||[]).flatMap(flat)],calls=flat(trace);assert.ok(!trace.error);
  const proofCall=calls.find(c=>c.to?.toLowerCase()===(verifier.target).toLowerCase()),venueCall=calls.find(c=>c.to?.toLowerCase()===params[0].toLowerCase()&&c.input?.startsWith('0x4d8dc985'));
  assert.ok(proofCall&&!proofCall.error&&venueCall&&!venueCall.error);assert.equal(BigInt(proofCall.output),1n);assert.ok(calls.indexOf(proofCall)<calls.indexOf(venueCall));
  assert.equal(proofCall.input,verifier.interface.encodeFunctionData('verifyProof',[...decoded,signals]));
  if(name==='open')assert.ok(after>0n);else assert.ok((after<0n?-after:after)<(before<0n?-before:before));
  audit.traces.push({name,hash:tx.hash,sender:tx.from,before:String(before),after:String(after),proofBeforePerpl:true});
 }
 const pub=r.ledger.publicSignals.map(BigInt),recovered=await vault.recoveredAssets();
 const expected=settleCohort([await vault.deposits(0),await vault.deposits(1)],recovered,await vault.feeBps());
 assert.equal(pub[2],await vault.ledgerRoot({blockTag:receipts.activate.blockNumber}));assert.deepEqual(pub.slice(5,7),expected.deposits);assert.equal(pub[8],await vault.feeBps());
 assert.equal(pub[0],10143n);assert.equal(pub[1],BigInt(r.vault));assert.equal(pub[4],await vault.finalVenueNonce());assert.equal(pub[7],recovered);assert.deepEqual(pub.slice(9,11),expected.claims);assert.equal(pub[11],expected.totalFee);assert.equal(pub[12],expected.totalShares);
 const settlementCall=vault.interface.parseTransaction({data:transactions['ledger-settle'].data});assert.equal(settlementCall.name,'settle');
 assert.deepEqual(Array.from(settlementCall.args.slice(0,4)),[pub[3],pub[9],pub[10],pub[11]]);
 const ld=AbiCoder.defaultAbiCoder().decode(['uint256[2]','uint256[2][2]','uint256[2]'],settlementCall.args[4]).toArray(true);
 assert.equal(await new Contract(entries['deploy-ledger-verifier'].contractAddress,lv.abi,rpc).verifyProof(...ld,pub),true);
 assert.equal(await groth16.verify(r.ledger.verificationKey,r.ledger.publicSignals,r.ledger.proof),true);
 const transfer=(receipt,from,to,amount)=>assert.ok(receipt.logs.filter(l=>l.address.toLowerCase()===token.target.toLowerCase()).some(l=>{try{const e=token.interface.parseLog(l);return e.args.from.toLowerCase()===from.toLowerCase()&&e.args.to.toLowerCase()===to.toLowerCase()&&e.args.value===amount;}catch{return false;}}));
 for(const [i,investor]of [[0,r.owner],[1,r.investor]]){transfer(receipts['subscribe-'+i],investor,r.vault,expected.deposits[i]);transfer(receipts['claim-'+i],r.vault,investor,expected.claims[i]);assert.equal(await vault.claims(i),0n);assert.equal(await vault.shares(i),0n);}
 if(expected.totalFee>0n)transfer(receipts['claim-fee'],r.vault,r.owner,expected.totalFee);
 transfer(receipts.recover,r.account,r.vault,recovered);
 assert.equal(await vault.phase(),4n);assert.equal(await vault.totalShares(),0n);assert.equal(await vault.feeClaim(),0n);assert.equal(await vault.ledgerRoot(),pub[3]);assert.equal((await account.position())[0],0n);assert.equal(await token.balanceOf(r.vault),0n);
 const venue=new Contract(params[0],JSON.parse(readFileSync('protocol/perpl/exchange-abi.json')),rpc),venueAccount=await venue.getAccountByAddr(r.account);assert.equal(venueAccount.balanceCNS,0n);assert.equal(venueAccount.lockedBalanceCNS,0n);assert.equal((await venue.getOrderLocks(venueAccount.accountId)).length,0);
 audit.checks.push('hardware-sender-actual-trades-and-same-tx-proof-verification','terminal-ledger-proof-and-independent-accounting-match','share-burn-and-owner-specific-transfers-conserve-assets');
 assert.equal(await token.balanceOf(r.account),0n);assert.equal(await token.allowance(r.vault,r.account),0n);assert.equal(await token.allowance(r.account,params[0]),0n);
 const h=r.hardware;assert.equal(h.composeHash,deployment.composeHash);assert.equal(h.identity.operator,r.operator);assert.equal(h.identity.lockSha256,sha(readFileSync('deploy/tee/operator/package-lock.json')));
 for(const [file,hash]of Object.entries(deployment.sourceHashes)){assert.equal(sha(readFileSync(file)),hash);assert.equal(h.identity.sourceHashes[file],hash);}
 const binding=sha(JSON.stringify({domain:'MM_COHORT_OPERATOR_V1',identity:h.identity,challenge:h.challenge}));assert.equal(binding,h.binding);
 const raw=h.quote.quote.replace(/^0x/,'');const vr=await fetch('https://cloud-api.phala.com/api/v1/attestations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hex:raw}),signal:AbortSignal.timeout(30000)});assert.equal(vr.status,200);
 const {body,quoteHash}=verifiedTdxBody(raw,await vr.json()),hex=x=>String(x).replace(/^0x/,'').toLowerCase();assert.equal(quoteHash,h.quoteHash);assert.equal(hex(body.reportdata),binding.padEnd(128,'0'));assert.equal(parseInt(hex(body.tdattributes).slice(0,2),16)&1,0);
 const events=typeof h.quote.event_log==='string'?JSON.parse(h.quote.event_log):h.quote.event_log;replayTdxEvents(events,body);assert.equal(events.find(e=>e.imr===3&&e.event==='compose-hash')?.event_payload,deployment.composeHash);assert.equal(hex(body.mrconfig),'01'+deployment.composeHash+'00'.repeat(15));
 audit.checks.push('historical-tdx-quote-binds-enclave-operator-and-pinned-code');audit.status='PASS_INDEPENDENT_PUBLIC_COHORT_AUDIT';audit.settlement=r.settlement;
}catch(e){audit.status='FAIL';audit.error=e.shortMessage||e.message;process.exitCode=1;}
finally{writeFileSync('docs/evidence/cohort-public-audit.json',json(audit)+'\n');console.log(json(audit));rpc.destroy();await(await curves.getCurveFromName('bn128')).terminate();}
