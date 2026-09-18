import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface, MaxUint256, parseUnits, formatUnits } from 'ethers';
import { signObject, signingPublicKey, encryptEnvelope } from '../server/crypto.js';
import { ASSETS, POLICY, digest, alphaCommitment, groupSignals, attributeActors, allocateRewards, chooseActorWeights, referenceQuality } from './policy.js';
import { compilePilot, createLocalPilotChain } from './chain.js';
import { PilotCoordinator } from './coordinator.js';

export const units = value => parseUnits(String(value),18);
const numeric = n => Number(formatUnits(n,18));
const values = market => ASSETS.map(a=>units(market.prices[a]));
export const actorPayouts = e => e.actors.map(a=>a.payoutAddress);
export async function installFund(chain, market, { investorAccount = 0 } = {}) {
  const cash=await chain.deploy('cash','PilotToken',['Pilot test USD','tUSD']);
  const assets=[];
  for(const a of ASSETS) assets.push(await chain.deploy('token-'+a,'PilotToken',['Pilot test '+a,'t'+a]));
  const venue=await chain.deploy('venue','PilotVenue',[cash.address,assets.map(a=>a.address)]);
  const fund=await chain.deploy('fund','PilotFund',[cash.address,venue.address,assets.map(a=>a.address)]);
  const mint=async(token,tag,who,amount)=>chain.tx(tag,token,'mint',[who,amount]);
  await mint(cash,'liquidity-cash',chain.accounts[0],units(8000000));
  await chain.tx('approve-liquidity-cash',cash,'approve',[venue.address,MaxUint256]);
  for(let i=0;i<4;i++) {
    const qty=units(2000000)*units(1)/values(market)[i];
    await mint(assets[i],'liquidity-token-'+i,chain.accounts[0],qty);
    await chain.tx('approve-liquidity-token-'+i,assets[i],'approve',[venue.address,MaxUint256]);
    await chain.tx('seed-'+i,venue,'seed',[i,units(1000000),qty/2n]);
    await chain.tx('seed-lending-'+i,venue,'seedLending',[i,qty/4n]);
  }
  const investor=chain.accounts[investorAccount];
  await mint(cash,'investor-faucet',investor,units(100000));
  await chain.tx('approve-deposit',cash,'approve',[fund.address,MaxUint256],investorAccount);
  const deposit=await chain.tx('initial-deposit',fund,'deposit',[units(100000),digest('initial-deposit')],investorAccount);
  return {cash,assets,venue,fund,investor,investorAccount,deposit};
}
export async function chainOpen(chain,contracts,e) {
  return chain.tx(e.id+'-open',contracts.fund,'openEpoch',[e.id,e.policyHash,e.rosterHash,e.weightsHash,e.payoutsHash,e.cutoffAt,e.startAt,e.endAt]);
}
export async function chainCommit(chain,contracts,e) {
  return chain.tx(e.id+'-commit',contracts.fund,'commit',[e.id,e.root,e.manifestHash,e.targetHash]);
}
export async function setMarks(chain,contracts,tag,market) {
  return chain.tx(tag,contracts.fund,'setMarks',[values(market),market.boundary,digest(market)]);
}
export async function balances(chain,c) {
  return { cash:String((await chain.read(c.cash,'balanceOf',[c.fund.address]))[0]),
    holdings:await Promise.all(c.assets.map(async a=>String((await chain.read(a,'balanceOf',[c.fund.address]))[0]))),
    shortDebt:await Promise.all(c.assets.map(async (_,i)=>String((await chain.read(c.venue,'shortDebt',[c.fund.address,i]))[0]))),
    shares:String((await chain.read(c.fund,'totalSupply'))[0]), nav:String((await chain.read(c.fund,'totalAssets'))[0]) };
}
function sqrt(n) { if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n;}return x; }
/** A public test-liquidity arbitrage transaction. It moves actual test tokens.
 * No reserve setters or invented fills. This is not an independent market maker.
 */
export async function alignTestLiquidity(chain,c,tag,market) {
  const evidence=[];
  for(let i=0;i<4;i++) {
    const previous=await chain.resume?.(tag+'-'+i);if(previous){evidence.push(previous);continue;}
    const x=(await chain.read(c.venue,'cashReserves',[i]))[0],y=(await chain.read(c.venue,'assetReserves',[i]))[0];
    const desiredX=sqrt(x*y*values(market)[i]/units(1));
    const buy=desiredX>x;
    const amount=buy?desiredX-x:sqrt(x*y*units(1)/values(market)[i])-y;
    if(amount>1000n) evidence.push(await chain.tx(tag+'-'+i,c.venue,'swap',[i,buy,amount,0,await chain.now()+120]));
  }
  return evidence;
}
export async function settlePilot(chain,c,coordinator,id,beginMarket,endMarket) {
  let e=coordinator.read().epochs.find(e=>e.id===id);const inputs=coordinator.verify(e);
  const recovery=endMarket.boundary!==e.endAt;
  const txPrefix=recovery?id+'-recovery-'+endMarket.boundary:id;
  const before=await balances(chain,c);
  const markTx=await setMarks(chain,c,txPrefix+'-end-marks',endMarket);
  const closeTx=await chain.tx(txPrefix+'-close',c.fund,'closeEpoch',[id]);
  const onchain=await chain.read(c.fund,'epochs',[id]);
  const returns=ASSETS.map(a=>Number(endMarket.prices[a])/Number(beginMarket.prices[a])-1);
  const attribution=attributeActors(groupSignals(e.actors,inputs),e.weights,returns);
  const quality=referenceQuality(groupSignals(e.actors,inputs),returns,coordinator.read().history.filter(h=>h.epochId!==id));
  const allocations=allocateRewards(attribution,recovery?0n:onchain.feePool);
  const history=[...coordinator.read().history.filter(h=>h.epochId!==id),...attribution.map(r=>({...r,epochId:id,settled:!recovery,quality:quality.find(q=>q.actorId===r.actorId)}))];
  const nextWeights=chooseActorWeights(e.actors,history);
  const evaluation={schema:'MM_PILOT_EVALUATION_V2',epochId:id,beginMarketHash:digest(beginMarket),endMarketHash:digest(endMarket),
    referenceAttribution:attribution,providerQuality:quality,attributionModel:POLICY.contribution,realizedNav:String(onchain.endingNav),
    realizedPnl:String(onchain.endingNav-onchain.initialNav),feePool:String(onchain.feePool),allocations,nextWeights};
  const recipients=actorPayouts(e);
  const beforePayout=await Promise.all(recipients.map(async a=>String((await chain.read(c.cash,'balanceOf',[a]))[0])));
  const payoutTx=await chain.tx(txPrefix+'-payout',c.fund,'payRewards',[id,recipients,recipients.map((_,i)=>BigInt(allocations[e.actors[i].id])),digest(evaluation),digest(nextWeights)]);
  const afterPayout=await Promise.all(recipients.map(async a=>String((await chain.read(c.cash,'balanceOf',[a]))[0])));
  // Logs survive retries. Verify exact transfers even if a process restarted
  // after broadcast and the before-balance snapshot is already post-payment.
  const iface=new Interface(c.fund.abi);
  const rewardLogs=payoutTx.logs.filter(l=>l.address.toLowerCase()===c.fund.address.toLowerCase()).map(l=>{try{return iface.parseLog(l);}catch{return null;}}).filter(l=>l?.name==='Reward');
  for(const a of e.actors) {
    const logged=rewardLogs.filter(l=>l.args.actor.toLowerCase()===a.payoutAddress.toLowerCase()).reduce((n,l)=>n+l.args.amount,0n);
    assert.equal(String(logged),allocations[a.id]);
  }
  const after=await balances(chain,c);
  const evidence={id,sequence:e.sequence,policy:e.policy,actors:e.actors,weights:e.weights,manifest:e.manifest,manifestHash:e.manifestHash,
    targets:e.targets,root:e.root,leaves:e.leaves,proofs:e.proofs,beginMarket,endMarket,evaluation,
    receiptSigningPublicKey:signingPublicKey(coordinator.keys.signingPrivateKey),submissionReceipts:Object.values(e.submissions).map(s=>s.receipt),
    recovery,excludedFromForwardAcceptance:recovery,beforeClose:before,afterSettlement:after,payoutBalanceSnapshots:{before:beforePayout,after:afterPayout},
    chain:{...e.chain,endMark:markTx,close:closeTx,payout:payoutTx}};
  coordinator.update(id,(row,s)=>{row.status='SETTLED';row.recovery=recovery;row.evaluation=evaluation;row.evidence=evidence;s.history=history;});
  return evidence;
}
export function fixtureMarket(boundary,prices={BTC:'100',ETH:'100',MON:'100',SOL:'100'}) {
  return {schema:'MM_LOCAL_CONTROLLED_MARKS',source:'LOCAL_CONTROLLED_PRICES',boundary,prices};
}
export async function registerReferenceActors(coordinator,payouts) {
  const clients=[];
  for(let i=0;i<3;i++) {
    const key=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),publicKey=signingPublicKey(key);
    const payload={domain:'MM_PILOT_ENROLL_V1',name:['Momentum reference','Reversion reference','Cross-asset reference'][i],publicKey,payoutAddress:payouts[i],nonce:randomBytes(32).toString('hex')};
    const r=coordinator.enroll({payload,signature:signObject(payload,key)});
    const actor=coordinator.approve(r.id,{subject:'internal-reference-'+i,evidenceHash:digest({reference:true,i}),kind:'INTERNAL_REFERENCE'});
    clients.push({actor,key,publicKey});
  }
  return clients;
}
export function submitReference(coordinator,clients,e,vectors) {
  const key=createPublicKey(coordinator.keys.encryptionPrivateKey);
  return clients.map((c,i)=>{
    const payload={domain:'MM_PILOT_ALPHA_V2',epochId:e.id,actorId:c.actor.id,publicKey:c.publicKey,policyHash:e.policyHash,vectorBps:vectors[i],nonce:randomBytes(32).toString('hex')};
    const signature=signObject(payload,c.key),commitmentSignature=signObject(alphaCommitment(payload),c.key);const receipt=coordinator.submit(encryptEnvelope({payload,signature,commitmentSignature},key));
    return {payload,signature,receipt};
  });
}
export async function runLocalPilot({progress=()=>{}}={}) {
  const directory=mkdtempSync(join(tmpdir(),'mm-pilot-integration-'));
  const artifacts=compilePilot();const chain=await createLocalPilotChain(artifacts);
  let clock=await chain.now();const coordinator=new PilotCoordinator(directory,{clock:()=>clock});
  const checks=[];const epochs=[];let contracts;
  const rejects=async(label,fn)=>{await assert.rejects(fn);checks.push({label,rejected:true});};
  try {
    progress('로컬 EVM에 테스트 자산·거래소·펀드를 배포합니다.');
    contracts=await installFund(chain,fixtureMarket(clock),{investorAccount:1});
    const clients=await registerReferenceActors(coordinator,chain.accounts.slice(2,5));
    await rejects('다른 주소의 운영자 호출 거부',()=>chain.tx('bad-operator',contracts.fund,'setPaused',[true],1));
    await rejects('중복 예치 거부',()=>chain.tx('duplicate-deposit',contracts.fund,'deposit',[units(100000),digest('initial-deposit')],1));
    assert.equal((await chain.read(contracts.fund,'balanceOf',[contracts.investor]))[0],units(100000));
    let prices={BTC:'100',ETH:'100',MON:'100',SOL:'100'};
    for(let index=0;index<2;index++) {
      const e=coordinator.open({cutoffAt:clock+10,startAt:clock+120,endAt:clock+180});
      const open=await chainOpen(chain,contracts,e);coordinator.update(e.id,row=>row.chain.open=open);
      const vectors=[[10000,0,0,0],[0,10000,0,0],[0,0,0,-10000]];
      const openings=submitReference(coordinator,clients,e,vectors);
      await rejects('평가 중 환매 거부 '+index,()=>chain.tx('active-withdraw-'+index,contracts.fund,'redeem',[units(1),digest('active'+index)],1));
      clock=e.cutoffAt;chain.advanceTo(clock);const sealed=coordinator.seal(e.id);
      const commit=await chainCommit(chain,contracts,sealed);coordinator.update(e.id,row=>row.chain.commit=commit);
      await rejects('root 교체 거부 '+index,()=>chain.tx('root-replace-'+index,contracts.fund,'commit',[e.id,digest('other'),sealed.manifestHash,sealed.targetHash]));
      await rejects('미래 시장 관측 거부 '+index,()=>chain.tx('future-mark-'+index,contracts.fund,'setMarks',[values(fixtureMarket(e.startAt,prices)),e.startAt,digest('future')]));
      clock=e.startAt;chain.advanceTo(clock);const begin=fixtureMarket(clock,prices);
      const beginLiquidity=await alignTestLiquidity(chain,contracts,e.id+'-begin-liquidity',begin);
      await setMarks(chain,contracts,e.id+'-begin-marks',begin);
      const execution=await chain.tx(e.id+'-execute',contracts.fund,'execute',[e.id,sealed.targets]);
      coordinator.update(e.id,row=>{row.status='EXECUTED';row.chain.execution=execution;row.chain.beginLiquidity=beginLiquidity;});
      const postExecution=await balances(chain,contracts);
      assert.ok(postExecution.holdings.some(q=>BigInt(q)>0n));
      assert.ok(postExecution.shortDebt.some(q=>BigInt(q)>0n));
      await rejects('중복 실행 거부 '+index,()=>chain.tx('duplicate-execute-'+index,contracts.fund,'execute',[e.id,sealed.targets]));
      await rejects('조기 평가 거부 '+index,()=>chain.tx('early-close-'+index,contracts.fund,'closeEpoch',[e.id]));
      prices=index===0?{BTC:'110',ETH:'105',MON:'100',SOL:'98'}:{BTC:'99',ETH:'100',MON:'100',SOL:'99'};
      clock=e.endAt;chain.advanceTo(clock);const end=fixtureMarket(clock,prices);
      const arbitrage=await alignTestLiquidity(chain,contracts,e.id+'-arbitrage',end);
      const result=await settlePilot(chain,contracts,coordinator,e.id,begin,end);
      result.referenceProviderOpenings=openings;result.postExecution=postExecution;result.testLiquidityTrades=arbitrage;
      await rejects('중복 보상 거부 '+index,()=>chain.tx('duplicate-payout-'+index,contracts.fund,'payRewards',[e.id,actorPayouts(sealed),[0,0,0],digest('other'),digest('other')]));
      assert.ok(result.afterSettlement.holdings.every(q=>q==='0'));
      assert.ok(result.afterSettlement.shortDebt.every(q=>q==='0'));
      epochs.push(result);progress(`Epoch ${index+1}: 실현손익 ${numeric(BigInt(result.evaluation.realizedPnl)).toFixed(4)} tUSD, 보상 한도 ${numeric(BigInt(result.evaluation.feePool)).toFixed(4)} tUSD`);
    }
    assert.notDeepEqual(epochs[0].weights,epochs[1].weights);
    assert.ok(BigInt(epochs[0].evaluation.feePool)>0n);
    assert.equal(epochs[1].evaluation.feePool,'0');
    const navBeforeGift=(await chain.read(contracts.fund,'totalAssets'))[0];
    await chain.tx('unsolicited-cash',contracts.cash,'transfer',[contracts.fund.address,units(500)]);
    await chain.tx('unsolicited-asset',contracts.assets[0],'transfer',[contracts.fund.address,units(1)]);
    assert.equal((await chain.read(contracts.fund,'totalAssets'))[0],navBeforeGift,'Unsolicited transfers must not become alpha profit');
    checks.push({label:'승인되지 않은 직접 송금은 NAV·보상 이익에서 제외',pass:true});
    const beforeRedeem=await balances(chain,contracts),shares=(await chain.read(contracts.fund,'balanceOf',[contracts.investor]))[0];
    const investorBefore=(await chain.read(contracts.cash,'balanceOf',[contracts.investor]))[0];
    const redeem=await chain.tx('final-redeem',contracts.fund,'redeem',[shares,digest('final-redeem')],1);
    const investorAfter=(await chain.read(contracts.cash,'balanceOf',[contracts.investor]))[0];
    assert.equal((await chain.read(contracts.fund,'balanceOf',[contracts.investor]))[0],0n);
    const expected=shares*(BigInt(beforeRedeem.nav)+1n)/(BigInt(beforeRedeem.shares)+1n);assert.equal(investorAfter-investorBefore,expected);
    await rejects('중복 환매 거부',()=>chain.tx('duplicate-redeem',contracts.fund,'redeem',[shares,digest('final-redeem')],1));
    for(const token of [contracts.cash,...contracts.assets]) {
      const supply=(await chain.read(token,'totalSupply'))[0];
      const owners=[...new Set([...chain.accounts,contracts.fund.address,contracts.venue.address])];
      const total=(await Promise.all(owners.map(async a=>(await chain.read(token,'balanceOf',[a]))[0]))).reduce((a,b)=>a+b,0n);
      assert.equal(total,supply,'ERC20 supply must equal all owned balances');
    }
    return {schema:'MM_PILOT_CONTRACT_EVIDENCE_V2',generatedAt:new Date().toISOString(),environment:chain.environment,chainId:chain.chainId,
      implementationVerified:true,externalProductReady:false,tee:false,independentParticipants:false,controlledPrices:true,
      contracts:await Promise.all([contracts.cash,...contracts.assets,contracts.venue,contracts.fund].map(async h=>({type:h.type,address:h.address,codeHash:await chain.codeHash(h),deployment:h.deployment,sourceHash:artifacts[h.type].sourceHash,abi:h.abi}))),
      investor:contracts.investor,deposit:contracts.deposit,epochs,redemption:{transaction:redeem,shares:String(shares),cashReceived:String(investorAfter-investorBefore)},
      tokenConservation:true,checks,transactions:chain.transactions,
      boundaries:['Actual EVM ERC20 transfers and constant-product swaps; local synthetic clock and controlled marks.',
        'Three internally generated reference actors, not independently recruited operators.',
        'Reference Shapley scores are not claims that counterfactual venue fills occurred.',
        'Public test-asset venue has operator-seeded liquidity, not production market liquidity.']};
  } finally {chain.close();rmSync(directory,{recursive:true,force:true});}
}
