// Independent public-chain audit. Reads committed evidence; never loads a wallet key.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JsonRpcProvider,Contract,ContractFactory,AbiCoder,formatEther} from 'ethers';
import {groth16,curves} from 'snarkjs';
import solc from 'solc';
import {field} from '../protocol/perpl/target-prover.mjs';
const evidence=JSON.parse(readFileSync('docs/evidence/perpl-testnet-mvp.json'));
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
const audit={observedAt:new Date().toISOString(),status:'RUNNING',chainId:10143,checks:[],products:[],transactions:[],executionTraces:[],
  limitations:['Same official RPC provider; no independent consensus verification','Local prover; no hardware TEE in this public run','Dedicated-account synthetic target MVP only, no full Ledger/shares/fees']};
try {
  assert.equal(evidence.status,'PASS_PUBLIC_TESTNET_ZK_ROUNDTRIP');
  assert.equal(evidence.environment,'PUBLIC_MONAD_TESTNET');
  assert.equal((await rpc.getNetwork()).chainId,10143n);
  const sources=Object.fromEntries(['PerplMvpAccount.sol','PerplZkMvpAccount.sol'].map(n=>[n,{content:readFileSync('contracts/perpl/'+n,'utf8')}]));
  sources['TargetVerifier.sol']={content:readFileSync('docs/evidence/public-zk-verifier.sol','utf8')};
  assert.equal(createHash('sha256').update(JSON.stringify(sources,null,2)).digest('hex'),evidence.sourceSha256);
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{
    optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}},
  }})));
  assert.equal(compiled.errors?.filter(e=>e.severity==='error').length||0,0);
  const v=compiled.contracts['TargetVerifier.sol'].Groth16Verifier,a=compiled.contracts['PerplZkMvpAccount.sol'].PerplZkMvpAccount;
  const entries=Object.fromEntries(evidence.transactions.map(t=>[t.name,t]));
  const verifier=entries['deploy-verifier'].contractAddress;
  assert.equal(await rpc.getCode(verifier),'0x'+v.evm.deployedBytecode.object);
  const receipts={},transactions={};let fees=0n;
  for(const entry of evidence.transactions){
    const r=await rpc.getTransactionReceipt(entry.hash),tx=await rpc.getTransaction(entry.hash);
    assert.ok(r&&tx);assert.equal(r.status,1);assert.equal(tx.chainId,10143n);
    assert.equal(tx.from,evidence.wallet);assert.equal(tx.value,0n);
    assert.equal(r.blockNumber,entry.block);assert.equal(String(r.fee),entry.fee);
    assert.deepEqual(JSON.parse(JSON.stringify(r.logs)),entry.logs);
    receipts[entry.name]=r;transactions[entry.name]=tx;fees+=r.fee;
    audit.transactions.push({name:entry.name,hash:tx.hash,block:r.blockNumber,blockHash:r.blockHash,status:r.status});
  }
  assert.equal(transactions['deploy-verifier'].data,(await new ContractFactory(v.abi,v.evm.bytecode.object).getDeployTransaction()).data);
  assert.equal(formatEther(fees),evidence.totalFeeMON);audit.totalFeeMON=formatEther(fees);
  audit.checks.push('all-receipts-reloaded-and-matched','verifier-source-and-runtime-matched');
  const venue=new Contract(evidence.exchange,JSON.parse(readFileSync('protocol/perpl/exchange-abi.json')),rpc);
  const token=new Contract(evidence.collateral,[
    'function balanceOf(address) view returns(uint256)',
    'function allowance(address,address) view returns(uint256)',
    'event Transfer(address indexed from,address indexed to,uint256 value)',
  ],rpc);
  const assertTransfer=(receipt,from,to,amount)=>assert.ok(receipt.logs.filter(l=>l.address.toLowerCase()===evidence.collateral.toLowerCase()).some(l=>{
    try{const e=token.interface.parseLog(l);return e.name==='Transfer'&&e.args.from.toLowerCase()===from.toLowerCase()&&e.args.to.toLowerCase()===to.toLowerCase()&&e.args.value===amount;}catch{return false;}
  }),'Matching collateral Transfer missing');
  assert.equal(evidence.products.length,2);
  let recoveredSum=0n,tradeCount=0;
  for(const product of evidence.products){
    const label=product.label,address=product.address,account=new Contract(address,a.abi,rpc);
    const code=Buffer.from((await rpc.getCode(address)).slice(2),'hex');
    for(const refs of Object.values(a.evm.deployedBytecode.immutableReferences))for(const {start,length}of refs)code.fill(0,start,start+length);
    assert.equal(code.toString('hex'),a.evm.deployedBytecode.object);
    const key=[await account.managerKeyX(),await account.managerKeyY()];
    assert.equal(await account.verifier(),verifier);assert.equal(await account.venue(),evidence.exchange);
    assert.equal(await account.collateral(),evidence.collateral);assert.equal(await account.manager(),evidence.wallet);
    assert.equal(await account.beneficiary(),evidence.wallet);assert.equal(await account.market(),16n);assert.equal(await account.maxLots(),100n);
    assert.equal(transactions['deploy-'+label].data,(await new ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(
      evidence.exchange,evidence.collateral,evidence.wallet,evidence.wallet,16,100,verifier,key)).data);
    const allocation=BigInt(evidence.preflight.allocationPerProduct);
    assertTransfer(receipts['fund-'+label],evidence.wallet,address,allocation);
    assertTransfer(receipts['fund-'+label],address,evidence.exchange,allocation);
    let executed=0;
    for(const name of Object.keys(entries).filter(n=>n==='open-'+label||n.startsWith('close-'+label+'-'))){
      const r=receipts[name],tx=transactions[name],proof=evidence.proofs[name];
      assert.equal(tx.to,address);assert.ok(proof);
      const call=account.interface.parseTransaction({data:tx.data});assert.equal(call.name,'execute');
      const [target,limit,seq,deadline,encoded]=call.args;
      const events=r.logs.filter(l=>l.address.toLowerCase()===address.toLowerCase()).map(l=>account.interface.parseLog(l)).filter(e=>e?.name==='Executed');
      assert.equal(events.length,1);const event=events[0];
      assert.equal(event.args.nonce,seq);assert.equal(event.args.target,target);
      const expected=[10143n,BigInt(address),16n,seq,field(target),field(event.args.beforeQty),limit,deadline,100n,...key].map(String);
      assert.deepEqual(proof.publicSignals,expected);
      assert.equal(await groth16.verify(evidence.verificationKey,expected,proof.proof),true);
      const decoded=AbiCoder.defaultAbiCoder().decode(['uint256[2]','uint256[2][2]','uint256[2]'],encoded).toArray(true);
      assert.equal(await new Contract(verifier,v.abi,rpc).verifyProof(...decoded,expected),true);
      const trace=await rpc.send('debug_traceTransaction',[tx.hash,{tracer:'callTracer'}]);
      assert.ok(!trace.error);assert.equal(trace.to.toLowerCase(),address.toLowerCase());assert.equal(trace.input,tx.data);
      const flatten=c=>[c,...(c.calls||[]).flatMap(flatten)],calls=flatten(trace);
      const proofCall=calls.find(c=>c.to?.toLowerCase()===verifier.toLowerCase());
      const venueCall=calls.find(c=>c.to?.toLowerCase()===evidence.exchange.toLowerCase()&&c.input?.startsWith(venue.interface.getFunction('execOrder').selector));
      assert.ok(proofCall&&!proofCall.error&&venueCall&&!venueCall.error);
      assert.equal(proofCall.input,new Contract(verifier,v.abi).interface.encodeFunctionData('verifyProof',[...decoded,expected]));
      assert.equal(BigInt(proofCall.output),1n);assert.ok(calls.indexOf(proofCall)<calls.indexOf(venueCall));
      const compact=c=>({type:c.type,from:c.from,to:c.to,input:c.input,output:c.output,gasUsed:c.gasUsed});
      audit.executionTraces.push({name,transaction:tx.hash,proofVerification:compact(proofCall),venueExecution:compact(venueCall),proofBeforeExecution:true});
      assert.equal((await account.position({blockTag:r.blockNumber-1}))[0],event.args.beforeQty);
      assert.equal((await account.position({blockTag:r.blockNumber}))[0],event.args.afterQty);
      if(name==='open-'+label){assert.notEqual(event.args.afterQty,0n);assert.equal(String(event.args.afterQty),product.openActual);}
      else assert.ok((event.args.afterQty<0n?-event.args.afterQty:event.args.afterQty)<(event.args.beforeQty<0n?-event.args.beforeQty:event.args.beforeQty));
      executed++;tradeCount++;
    }
    const finalPosition=(await account.position())[0],venueAccount=await venue.getAccountByAddr(address);
    assert.equal(finalPosition,0n);assert.equal(venueAccount.balanceCNS,0n);assert.equal(venueAccount.lockedBalanceCNS,0n);
    assert.equal((await venue.getOrderLocks(venueAccount.accountId)).length,0);
    assert.equal(await account.nonce(),BigInt(executed));assert.equal(await token.balanceOf(address),0n);
    assert.equal(await token.allowance(evidence.wallet,address),0n);assert.equal(await token.allowance(address,evidence.exchange),0n);
    const recovered=BigInt(product.recovered);assert.ok(recovered>0n);recoveredSum+=recovered;
    assertTransfer(receipts['recover-'+label],evidence.exchange,address,recovered);
    assertTransfer(receipts['recover-'+label],address,evidence.wallet,recovered);
    audit.products.push({label,address,venueAccountId:String(venueAccount.accountId),openActualLots:product.openActual,
      finalPositionLots:String(finalPosition),venueFreeBalance:'0',venueLockedBalance:'0',wrapperBalance:'0',allowancesCleared:true,recoveredAUSDBaseUnits:product.recovered});
  }
  const beforeBlock=receipts['deploy-verifier'].blockNumber-1;
  const lastBlock=Math.max(...Object.values(receipts).map(r=>r.blockNumber));
  const before=await token.balanceOf(evidence.wallet,{blockTag:beforeBlock}),after=await token.balanceOf(evidence.wallet,{blockTag:lastBlock});
  assert.equal(after,before-2n*BigInt(evidence.preflight.allocationPerProduct)+recoveredSum);
  audit.walletBeforeAUSDBaseUnits=String(before);audit.walletAfterAUSDBaseUnits=String(after);audit.proofBoundExecutions=tradeCount;
  audit.checks.push('two-account-source-and-deployment-calldata-matched','proofs-and-execute-calldata-bound-to-actual-historical-positions',
    'onchain-call-traces-prove-verifier-before-venue-in-same-transaction','nonzero-open-fills-and-flat-close','collateral-transfer-paths-and-wallet-conservation','zero-residual-balances-orders-and-allowances');
  audit.status='PASS_PUBLIC_PERPL_INDEPENDENT_READONLY_AUDIT';
} catch(error){audit.status='FAIL';audit.error=error.shortMessage||error.message;process.exitCode=1;}
finally {
  writeFileSync('docs/evidence/perpl-testnet-audit.json',JSON.stringify(audit,null,2)+'\n');
  console.log(JSON.stringify(audit,null,2));rpc.destroy();await(await curves.getCurveFromName('bn128')).terminate();
}
