import assert from 'node:assert/strict';
import { AbiCoder, Interface, Contract, keccak256, ZeroAddress } from 'ethers';
import { digest, POLICY_HASH, validateActors } from './policy.js';
import { verifyMarket } from './market.js';
import { verifyObject, merkleTree, verifyInclusion } from '../server/crypto.js';

/** Separate log-derived accounting. It does not call runner, contract methods,
 * attribution or portfolio arithmetic to obtain its expected cash movements.
 */
export function verifyContractEvidence(report, artifacts) {
  const txs=Array.isArray(report.transactions)?report.transactions:Object.values(report.transactions);
  assert.ok(txs.length>0,'No transactions');
  assert.equal(new Set(txs.map(t=>t.transactionHash)).size,txs.length,'Duplicate transaction evidence');
  const contracts=Array.isArray(report.contracts)?report.contracts:[report.contracts.cash,...report.contracts.assets,report.contracts.venue,report.contracts.fund];
  const tokenAddresses=new Set(contracts.filter(c=>c.type==='PilotToken').map(c=>c.address.toLowerCase()));
  const fund=contracts.find(c=>c.type==='PilotFund'),venue=contracts.find(c=>c.type==='PilotVenue');assert.ok(fund&&venue);
  const tokenInterface=new Interface(artifacts.PilotToken.abi),fundInterface=new Interface(artifacts.PilotFund.abi),venueInterface=new Interface(artifacts.PilotVenue.abi);
  const ledger=new Map(),fundEvents=[],swaps=[],loans=[];
  const key=(token,owner)=>token.toLowerCase()+':'+owner.toLowerCase();
  for(const tx of [...txs].sort((a,b)=>a.blockNumber-b.blockNumber)) {
    assert.equal(tx.status,1,'Unconfirmed or reverted transaction in evidence');
    for(const log of tx.logs) {
      const address=log.address.toLowerCase();
      if(tokenAddresses.has(address)) {
        const event=tokenInterface.parseLog(log);if(event?.name!=='Transfer')continue;
        const {from,to,amount}=event.args;
        if(from!==ZeroAddress){const k=key(address,from);ledger.set(k,(ledger.get(k)||0n)-amount);assert.ok(ledger.get(k)>=0n,'Transfer exceeds reconstructed balance');}
        if(to!==ZeroAddress){const k=key(address,to);ledger.set(k,(ledger.get(k)||0n)+amount);}
      } else if(address===fund.address.toLowerCase()) {
        const event=fundInterface.parseLog(log);if(event)fundEvents.push({name:event.name,args:event.args,tx});
      } else if(address===venue.address.toLowerCase()) {
        const event=venueInterface.parseLog(log);if(event?.name==='Swap')swaps.push({args:event.args,tx});
        if(['ShortOpened','ShortClosed'].includes(event?.name))loans.push({name:event.name,args:event.args,tx});
      }
    }
  }
  let auditedShares=0n,auditedNav=0n,highWater=10n**18n,lastClose;
  for(const event of fundEvents) {
    const a=event.args;
    if(event.name==='Deposit') {assert.equal(a.shares,a.assets*(auditedShares+1n)/(auditedNav+1n),'Deposit must mint at NAV/share, not create investment return');auditedShares+=a.shares;auditedNav+=a.assets;}
    if(event.name==='Executed')assert.equal(a.initialNav,auditedNav,'Initial NAV differs from prior settled cash book');
    if(event.name==='Closed') {const threshold=auditedShares*highWater/(10n**18n),profit=a.endingNav>threshold?a.endingNav-threshold:0n;assert.equal(a.feePool,profit/10n,'Fee must be 10% of profit above per-share high water');auditedNav=a.endingNav;lastClose=a;}
    if(event.name==='Settled') {assert.ok(lastClose?.epoch===a.epoch);auditedNav-=a.paid;const price=auditedNav*(10n**18n)/auditedShares;if(price>highWater)highWater=price;}
    if(event.name==='Redeem') {assert.equal(a.cashOut,a.shares*(auditedNav+1n)/(auditedShares+1n),'Redemption at share value');auditedShares-=a.shares;auditedNav-=a.cashOut;}
  }
  const get=(epoch,name)=>{const events=fundEvents.filter(v=>v.name===name&&v.args.epoch===epoch);assert.equal(events.length,1,`Exactly one ${name} per epoch`);return events[0];};
  const epochs=[];
  for(const e of report.epochs) {
    validateActors(e.actors);
    for(const a of e.actors){const registration=a.enrollment;assert.ok(registration&&verifyObject(registration.payload,registration.signature,registration.payload.publicKey),'Signed enrollment');assert.ok(a.providerKeys.includes(registration.payload.publicKey));assert.equal(registration.payload.payoutAddress.toLowerCase(),a.payoutAddress.toLowerCase());}
    assert.equal(e.manifestHash,digest(e.manifest),'Manifest hash');assert.equal(e.manifest.policyHash,POLICY_HASH,'Reviewed policy version');
    assert.equal(e.manifest.rosterHash,digest(e.actors),'Actor roster binding');assert.equal(e.manifest.weightsHash,digest(e.weights),'Weights binding');
    const receipts=e.submissionReceipts;
    assert.ok(Array.isArray(receipts),'Public signed submission receipts required');
    assert.equal(new Set(receipts.map(r=>r.publicKey)).size,receipts.length,'Duplicate submission receipt');
    for(const receipt of receipts) {
      const {serverSignature,...body}=receipt;
      assert.equal(body.domain,'MM_PILOT_RECEIPT_V2');assert.equal(body.epochId,e.id);assert.equal(body.policyHash,e.manifest.policyHash);
      assert.equal(body.cutoffAt,e.manifest.cutoffAt);assert.ok(Number.isInteger(body.acceptedAt)&&body.acceptedAt<body.cutoffAt,'Receipt cutoff');
      assert.ok(e.actors.some(a=>a.id===body.actorId&&a.providerKeys.includes(body.publicKey)),'Receipt belongs to frozen roster');
      assert.match(body.payloadHash,/^0x[0-9a-f]{64}$/);
      const commitment={domain:'MM_PILOT_ALPHA_COMMITMENT_V2',epochId:body.epochId,actorId:body.actorId,publicKey:body.publicKey,policyHash:body.policyHash,payloadHash:body.payloadHash};
      assert.ok(verifyObject(commitment,body.commitmentSignature,body.publicKey),'Provider signature over public commitment');
      assert.ok(verifyObject(body,serverSignature,e.receiptSigningPublicKey),'Server acceptance signature');
    }
    const submittedActorIds=[...new Set(receipts.map(r=>r.actorId))];
    assert.ok(submittedActorIds.length>=3,'At least three actors must actually submit');
    const expectedLeaves=e.actors.flatMap(a=>a.providerKeys.map(publicKey=>{const receipt=receipts.find(r=>r.publicKey===publicKey);return {
      domain:'MM_PILOT_LEAF_V2',epochId:e.id,actorId:a.id,publicKey,status:receipt?'SUBMITTED':'MISSED',
      payloadHash:receipt?.payloadHash||digest({id:e.id,publicKey,missing:true})};}));
    assert.deepEqual(e.leaves,expectedLeaves,'Receipts bind every submitted or missed roster key');
    assert.equal(merkleTree(expectedLeaves).root,e.root,'Submission Merkle root');
    assert.ok(e.proofs?.length===e.leaves.length&&e.leaves.every((l,i)=>verifyInclusion(l,e.proofs[i],e.root)),'Submission inclusion proofs');
    assert.equal(e.manifest.targetHash,keccak256(AbiCoder.defaultAbiCoder().encode(['int256[4]'],[e.targets])),'Target binding');
    const opened=get(e.id,'EpochOpened'),commit=get(e.id,'Committed'),execution=get(e.id,'Executed'),close=get(e.id,'Closed'),settled=get(e.id,'Settled');
    assert.equal(opened.args.policyHash,e.manifest.policyHash);assert.equal(opened.args.rosterHash,e.manifest.rosterHash);assert.equal(opened.args.weightsHash,e.manifest.weightsHash);assert.equal(opened.args.payoutsHash,e.manifest.payoutsHash);
    assert.equal(Number(opened.args.cutoffAt),e.manifest.cutoffAt);assert.equal(Number(opened.args.startAt),e.manifest.startAt);assert.equal(Number(opened.args.endAt),e.manifest.endAt);
    assert.equal(commit.args.root,e.root);assert.equal(commit.args.manifestHash,e.manifestHash);assert.equal(commit.args.targetHash,e.manifest.targetHash);
    assert.ok(opened.tx.blockTimestamp<e.manifest.cutoffAt&&commit.tx.blockTimestamp>=e.manifest.cutoffAt&&commit.tx.blockTimestamp<e.manifest.startAt,'Prior commitment timing');
    assert.ok(execution.tx.blockNumber>commit.tx.blockNumber&&execution.tx.blockTimestamp>=e.manifest.startAt&&execution.tx.blockTimestamp<e.manifest.endAt,'Execution sequence');
    assert.ok(close.tx.blockTimestamp>=e.manifest.endAt,'Outcome timing');
    assert.equal(execution.args.marketHash,digest(e.beginMarket));assert.equal(close.args.marketHash,digest(e.endMarket));
    assert.equal(e.beginMarket.boundary,e.manifest.startAt);assert.equal(e.endMarket.boundary,e.manifest.endAt);
    if(report.environment==='MONAD_TESTNET'){verifyMarket(e.beginMarket);verifyMarket(e.endMarket);}
    assert.equal(String(close.args.endingNav-execution.args.initialNav),e.evaluation.realizedPnl,'Actual realized PnL from contract events');
    assert.equal(String(close.args.feePool),e.evaluation.feePool,'Fee pool');
    assert.equal(settled.args.evaluationHash,digest(e.evaluation));assert.equal(settled.args.nextWeightsHash,digest(e.evaluation.nextWeights));
    const rewards=fundEvents.filter(v=>v.name==='Reward'&&v.args.epoch===e.id);
    let paid=0n;
    for(const a of e.actors) {
      const amount=rewards.filter(v=>v.args.actor.toLowerCase()===a.payoutAddress.toLowerCase()).reduce((n,v)=>n+v.args.amount,0n);
      assert.equal(String(amount),e.evaluation.allocations[a.id],'Recipient allocation matches actual reward event');paid+=amount;
    }
    assert.equal(paid,settled.args.paid);assert.ok(paid<=close.args.feePool,'Payout exceeds realized-profit fee pool');
    const cashAddress=(Array.isArray(report.contracts)?contracts.find(c=>c.type==='PilotToken'):report.contracts.cash).address.toLowerCase();
    for(const reward of rewards)assert.ok(reward.tx.logs.filter(l=>l.address.toLowerCase()===cashAddress).some(l=>{const t=tokenInterface.parseLog(l);return t?.name==='Transfer'&&t.args.from.toLowerCase()===fund.address.toLowerCase()&&t.args.to.toLowerCase()===reward.args.actor.toLowerCase()&&t.args.amount===reward.args.amount;}),'Reward event without actual token transfer');
    for(let i=0;i<4;i++)if(e.targets[i]<0){const entry=loans.find(l=>l.name==='ShortOpened'&&l.tx.transactionHash===execution.tx.transactionHash&&Number(l.args.asset)===i);const exit=loans.find(l=>l.name==='ShortClosed'&&l.tx.transactionHash===close.tx.transactionHash&&Number(l.args.asset)===i);assert.ok(entry&&exit,'Short must actually borrow and repay');assert.equal(entry.args.debt,exit.args.debtRepaid);}
    const tradeLogs=swaps.filter(v=>v.args.trader.toLowerCase()===fund.address.toLowerCase()&&[execution.tx.transactionHash,close.tx.transactionHash].includes(v.tx.transactionHash));
    assert.ok(tradeLogs.some(l=>l.args.buy)&&tradeLogs.some(l=>!l.args.buy),'Actual entry and exit fill events required');
    // A reported swap must move input and output tokens in the same receipt.
    const tokens=Array.isArray(report.contracts)?contracts.filter(c=>c.type==='PilotToken'): [report.contracts.cash,...report.contracts.assets];
    for(const fill of tradeLogs) {
      const input=tokens[fill.args.buy?0:Number(fill.args.asset)+1].address.toLowerCase();
      const output=tokens[fill.args.buy?Number(fill.args.asset)+1:0].address.toLowerCase();
      const transfers=fill.tx.logs.filter(l=>tokenAddresses.has(l.address.toLowerCase())).map(l=>({token:l.address.toLowerCase(),event:tokenInterface.parseLog(l)})).filter(l=>l.event?.name==='Transfer');
      assert.ok(transfers.some(l=>l.token===input&&l.event.args.from.toLowerCase()===fund.address.toLowerCase()&&l.event.args.to.toLowerCase()===venue.address.toLowerCase()&&l.event.args.amount===fill.args.amountIn),'Swap input transfer missing');
      assert.ok(transfers.some(l=>l.token===output&&l.event.args.to.toLowerCase()===fund.address.toLowerCase()&&l.event.args.from.toLowerCase()===venue.address.toLowerCase()&&l.event.args.amount===fill.args.amountOut),'Swap output transfer missing');
    }
    epochs.push({id:e.id,priorCommitment:true,submittedActorIds,entryAndExitFills:tradeLogs.length,realizedPnl:e.evaluation.realizedPnl,actualPayout:String(paid)});
  }
  for(let i=1;i<report.epochs.length;i++) {
    const previous=report.epochs[i-1],current=report.epochs[i];
    assert.equal(current.manifest.previousManifestHash,previous.manifestHash);
    assert.deepEqual(current.weights,previous.evaluation.nextWeights,'Next epoch must use committed next weights');
  }
  const deposits=fundEvents.filter(e=>e.name==='Deposit'),redemptions=fundEvents.filter(e=>e.name==='Redeem');
  assert.ok(deposits.length>0,'No deposit');
  const shareSupply=deposits.reduce((n,e)=>n+e.args.shares,0n)-redemptions.reduce((n,e)=>n+e.args.shares,0n);
  assert.ok(shareSupply>=0n);
  if(report.redemption){assert.ok(redemptions.length>0,'No redemption transaction');assert.equal(String(redemptions.at(-1).args.cashOut),report.redemption.cashReceived);}
  return {valid:true,environment:report.environment,epochs,depositObserved:true,redemptionObserved:redemptions.length>0,
    reconstructedShareSupply:String(shareSupply),reconstructedNav:String(auditedNav),ledger:Object.fromEntries([...ledger].map(([k,v])=>[k,String(v)])),
    referenceAttributionNotRecomputed:true,independentChainVerification:false};
}
export async function verifyExternalReceipts(report,rpc,artifacts) {
  assert.equal(report.environment,'MONAD_TESTNET');assert.equal((await rpc.getNetwork()).chainId,10143n);
  const finalized=await rpc.getBlock('finalized');assert.ok(finalized,'Finalized head unavailable');
  const copy=structuredClone(report),actual=[];
  for(const recorded of report.transactions) {
    const receipt=await rpc.getTransactionReceipt(recorded.transactionHash);assert.ok(receipt&&receipt.status===1,'Missing onchain receipt');
    assert.ok(receipt.blockNumber<=finalized.number,'Receipt not finalized');
    const block=await rpc.getBlock(receipt.blockNumber);assert.equal(receipt.blockHash,block.hash,'Receipt reorg');
    actual.push({...recorded,status:receipt.status,blockNumber:receipt.blockNumber,blockTimestamp:block.timestamp,blockHash:block.hash,
      logs:receipt.logs.map(l=>({address:l.address,topics:[...l.topics],data:l.data}))});
  }
  copy.transactions=actual;
  const c=report.contracts,definitions=[[c.cash,'PilotToken',['Pilot test USD','tUSD']],...['BTC','ETH','MON','SOL'].map((a,i)=>[c.assets[i],'PilotToken',['Pilot test '+a,'t'+a]]),
    [c.venue,'PilotVenue',[c.cash.address,c.assets.map(a=>a.address)]],[c.fund,'PilotFund',[c.cash.address,c.venue.address,c.assets.map(a=>a.address)]]];
  for(const [h,type,args] of definitions) {
    const tx=await rpc.getTransaction(h.deployment.transactionHash),receipt=await rpc.getTransactionReceipt(h.deployment.transactionHash);
    assert.ok(tx&&!tx.to&&receipt.contractAddress.toLowerCase()===h.address.toLowerCase(),'Deployment mismatch');
    assert.equal(tx.data.toLowerCase(),(artifacts[type].bytecode+new Interface(artifacts[type].abi).encodeDeploy(args).slice(2)).toLowerCase(),'Deployed code is not reviewed source');
    assert.notEqual(await rpc.getCode(h.address),'0x');
  }
  const result=verifyContractEvidence(copy,artifacts);
  const instance=new Contract(c.fund.address,artifacts.PilotFund.abi,rpc),blockTag=Math.max(...actual.map(t=>t.blockNumber));
  assert.equal(String(await instance.totalSupply({blockTag})),result.reconstructedShareSupply,'Onchain share supply differs from logs');
  assert.equal(String(await instance.totalAssets({blockTag})),result.reconstructedNav,'Onchain NAV differs from reconstructed settled book');
  return {...result,independentChainVerification:true,finalizedHead:finalized.number,
    independenceMeaning:'Fresh public RPC receipt/readback independent of saved application JSON; not an independent auditor or consensus light client.'};
}
