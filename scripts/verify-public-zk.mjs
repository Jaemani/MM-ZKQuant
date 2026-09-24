// Independent, read-only recheck. No wallet or session secrets are loaded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JsonRpcProvider, Contract, ContractFactory, AbiCoder, keccak256, toQuantity } from 'ethers';
import { groth16, curves } from 'snarkjs';
import solc from 'solc';

const report=JSON.parse(readFileSync('docs/evidence/public-zk-testnet.json'));
const rpc=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
  assert.equal(report.status,'PASS_PUBLIC_TESTNET_ZK_ACCEPTANCE');
  assert.equal((await rpc.getNetwork()).chainId,10143n);
  const sources={
    'PublicZkProbe.sol':{content:readFileSync('contracts/perpl/PublicZkProbe.sol','utf8')},
    'TargetVerifier.sol':{content:readFileSync('docs/evidence/public-zk-verifier.sol','utf8')},
  };
  assert.equal(createHash('sha256').update(JSON.stringify(sources,null,2)).digest('hex'),report.sourceSha256);
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{
    optimizer:{enabled:true,runs:200},evmVersion:'shanghai',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}},
  }})));
  assert.equal(compiled.errors?.filter(e=>e.severity==='error').length||0,0);
  const v=compiled.contracts['TargetVerifier.sol'].Groth16Verifier;
  const p=compiled.contracts['PublicZkProbe.sol'].PublicZkProbe;
  assert.equal(await rpc.getCode(report.verifier),'0x'+v.evm.deployedBytecode.object);
  const probeCode=Buffer.from((await rpc.getCode(report.probe)).slice(2),'hex');
  for(const refs of Object.values(p.evm.deployedBytecode.immutableReferences)) {
    for(const {start,length} of refs)probeCode.fill(0,start,start+length);
  }
  assert.equal(probeCode.toString('hex'),p.evm.deployedBytecode.object);
  const probe=new Contract(report.probe,p.abi,rpc);
  const proof=report.proof,signals=proof.publicSignals,bad=[...signals];bad[4]='99';
  assert.equal(await probe.verifier(),report.verifier);
  assert.equal(await probe.operator(),report.wallet);
  assert.equal(String(await probe.keyX()),signals[9]);
  assert.equal(String(await probe.keyY()),signals[10]);
  assert.equal(signals[0],'10143');
  assert.equal(BigInt(signals[1]),BigInt(report.probe));
  const vk=report.verificationKey;
  assert.equal(await groth16.verify(vk,signals,proof.proof),true);
  assert.equal(await groth16.verify(vk,bad,proof.proof),false);
  const decoded=AbiCoder.defaultAbiCoder().decode(['uint256[2]','uint256[2][2]','uint256[2]'],proof.encodedProof).toArray(true);
  assert.equal(await new Contract(report.verifier,v.abi,rpc).verifyProof(...decoded,signals),true);
  assert.equal(await new Contract(report.verifier,v.abi,rpc).verifyProof(...decoded,bad),false);
  const expected=[
    ['deploy-verifier',1,(await new ContractFactory(v.abi,v.evm.bytecode.object).getDeployTransaction()).data,null],
    ['deploy-probe',1,(await new ContractFactory(p.abi,p.evm.bytecode.object).getDeployTransaction(report.verifier,[signals[9],signals[10]])).data,null],
    ['reject-tampered',0,probe.interface.encodeFunctionData('submit',[proof.encodedProof,bad]),0n],
    ['accept-valid',1,probe.interface.encodeFunctionData('submit',[proof.encodedProof,signals]),1n],
    ['reject-replay',0,probe.interface.encodeFunctionData('submit',[proof.encodedProof,signals]),1n],
  ];
  assert.equal(report.transactions.length,expected.length);
  let previousBlock=0;
  for(let i=0;i<expected.length;i++) {
    const [label,status,data,counter]=expected[i],entry=report.transactions[i];
    assert.equal(entry.label,label);
    const receipt=await rpc.getTransactionReceipt(entry.hash),tx=await rpc.getTransaction(entry.hash);
    assert.ok(receipt&&tx,label);
    assert.equal(receipt.status,status,label);assert.equal(receipt.blockHash,entry.blockHash);
    assert.ok(receipt.blockNumber>previousBlock);previousBlock=receipt.blockNumber;
    assert.equal(tx.chainId,10143n);assert.equal(tx.from,report.wallet);assert.equal(tx.value,0n);
    assert.equal(tx.data,data);assert.equal(tx.to,counter===null?null:report.probe);
    if(counter!==null)assert.equal(await probe.accepted({blockTag:receipt.blockNumber}),counter);
    if(status===0){
      const reason=label==='reject-tampered'?'INVALID_PROOF':'STALE';
      // Replay the exact gas-limited request against pre-transaction state;
      // a failed receipt alone cannot distinguish policy rejection from OOG.
      await assert.rejects(()=>rpc.send('eth_call',[
        {from:tx.from,to:tx.to,data:tx.data,gas:toQuantity(tx.gasLimit)},
        toQuantity(receipt.blockNumber-1),
      ]),e=>e.reason===reason);
    }
    if(label==='accept-valid') {
      assert.equal(receipt.logs.length,1);
      const event=probe.interface.parseLog(receipt.logs[0]);
      assert.equal(event.name,'Accepted');assert.equal(event.args.nonce,0n);
      assert.equal(event.args.publicInputsHash,keccak256(AbiCoder.defaultAbiCoder().encode(['uint256[11]'],[signals])));
    } else assert.equal(receipt.logs.length,0);
    console.log(`${label}: status=${status}, block=${receipt.blockNumber}, independently verified`);
  }
  assert.equal(await probe.accepted(),1n);
  console.log('PASS: public receipts, source/bytecode, exact calldata, proof validity and historical counters. No DEX or TEE claim.');
} finally {
  rpc.destroy();await(await curves.getCurveFromName('bn128')).terminate();
}
