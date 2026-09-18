import { existsSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { JsonRpcProvider, Wallet, Interface } from 'ethers';
import { compilePilot, createRpcPilotChain, atomicJson } from '../src/pilot/chain.js';
import { collectMarket, verifyMarket } from '../src/pilot/market.js';
import { PilotCoordinator } from '../src/pilot/coordinator.js';
import { digest } from '../src/pilot/policy.js';
import { runLocalPilot, installFund, chainOpen, chainCommit, setMarks, settlePilot, alignTestLiquidity, balances } from '../src/pilot/runner.js';

const args=process.argv.slice(2),command=args.shift()||'status';
function option(name,fallback) {const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];}
const directory=resolve(option('data-dir',process.env.PILOT_DATA_DIR||'.data/testnet-pilot'));
const load=path=>JSON.parse(readFileSync(path,'utf8'));
const output=option('output');
mkdirSync(directory,{recursive:true,mode:0o700});
async function config() {
  const p=option('config');
  const c=p?load(resolve(p)):load(join(directory,'wallet.json'));
  return {...c,rpcUrl:process.env.MONAD_TESTNET_RPC_URL||c.rpcUrl||'https://testnet-rpc.monad.xyz'};
}
async function main() {
  if(command==='local') {
    const result=await runLocalPilot({progress:console.log});
    const path=resolve(output||'docs/evidence/pilot-local.json');atomicJson(path,result);
    console.log(JSON.stringify({result:'LOCAL_IMPLEMENTATION_VERIFIED',externalProductReady:false,epochs:result.epochs.length,output:path}));return;
  }
  if(command==='market') {
    const result=await collectMarket();verifyMarket(result);
    atomicJson(resolve(output||'docs/evidence/market-live.json'),result);
    atomicJson(join(directory,'latest-market.json'),result);
    console.log(JSON.stringify({source:result.source,boundary:result.boundary,prices:result.prices,rawResponsesVerified:true}));return;
  }
  if(command==='init') {
    const p=join(directory,'wallet.json');if(!existsSync(p)) {const w=Wallet.createRandom();writeFileSync(p,JSON.stringify({chainId:10143,address:w.address,privateKey:w.privateKey}),{mode:0o600,flag:'wx'});}
    console.log(JSON.stringify({address:load(p).address,chainId:10143,faucet:'https://faucet.monad.xyz',keyFile:p}));return;
  }
  const coordinator=new PilotCoordinator(directory);
  if(command==='ingest-enrollment'||command==='ingest-alpha') {const file=option('file');if(!file)throw new Error('--file required');console.log(JSON.stringify(command==='ingest-enrollment'?coordinator.enroll(load(resolve(file))):coordinator.submit(load(resolve(file)))));return;}
  if(command==='approve') {
    const id=option('request'),subject=option('subject'),evidence=option('evidence');
    if(!id||!subject||!evidence) throw new Error('approve requires --request ID --subject ECONOMIC_ACTOR_ID --evidence /path/to/admission-evidence');
    const evidenceHash='0x'+createHash('sha256').update(readFileSync(resolve(evidence))).digest('hex');
    console.log(JSON.stringify(coordinator.approve(id,{subject,evidenceHash})));return;
  }
  if(command==='link-key') {console.log(JSON.stringify(coordinator.linkKey(option('actor'),option('request'))));return;}
  if(command==='status') {
    let network;
    try {const c=await config(),rpc=new JsonRpcProvider(c.rpcUrl);try {const chainId=String((await rpc.getNetwork()).chainId),address=new Wallet(c.privateKey).address;network={chainId,address,balanceWei:String(await rpc.getBalance(address))};}finally{rpc.destroy();}}
    catch(error){network={error:error.message};}
    console.log(JSON.stringify({network,...coordinator.publicState()},null,2));return;
  }
  const allowed=['deploy','open','seal','execute','settle','redeem','cancel','cycle'];
  if(!allowed.includes(command))throw new Error('Commands: init, status, market, local, approve, link-key, deploy, open, seal, execute, settle, redeem, cancel, cycle');
  if(!args.includes('--broadcast'))throw new Error('External transactions require --broadcast. Only chainId 10143 is allowed.');
  const configuration=await config();
  const chain=await createRpcPilotChain(compilePilot(),configuration,directory);
  const lockPath=join(directory,'command.lock');let lock;
  try {
    lock=openSync(lockPath,'wx',0o600);writeFileSync(lock,String(process.pid));
    if(await chain.rpc.getBalance(chain.accounts[0])===0n)throw new Error(`TESTNET_GAS_REQUIRED: fund ${chain.accounts[0]} with faucet MON; no transaction sent`);
    const deploymentFile=join(directory,'deployment.json');
    let c;
    if(command==='deploy') {
      const seedFile=join(directory,'seed-market.json');
      const market=existsSync(seedFile)?load(seedFile):await collectMarket();if(!existsSync(seedFile))atomicJson(seedFile,market);verifyMarket(market);
      c=await installFund(chain,market);atomicJson(deploymentFile,c);
      atomicJson(join(directory,'external-evidence.json'),{schema:'MM_EXTERNAL_PILOT_V2',environment:'MONAD_TESTNET',chainId:10143,contracts:c,
        epochs:coordinator.read().epochs.filter(e=>e.status==='SETTLED').map(e=>e.evidence),transactions:Object.values(load(join(directory,'transactions.json'))).map(({raw,...r})=>r)});
      console.log(JSON.stringify({environment:chain.environment,fund:c.fund.address,venue:c.venue.address,deposit:c.deposit.transactionHash}));return;
    }
    if(!existsSync(deploymentFile))throw new Error('Run deploy --broadcast first');c=load(deploymentFile);
    const active=()=>coordinator.read().epochs.findLast(e=>!['SETTLED','CANCELLED'].includes(e.status));
    async function open() {
      let e=active();if(!e){const duration=Number(option('submission-seconds','60'));if(!Number.isInteger(duration)||duration<30||duration>3600)throw new Error('submission-seconds must be 30–3600');const now=await chain.now(),start=Math.ceil((now+duration+90)/60)*60;e=coordinator.open({cutoffAt:now+duration,startAt:start,endAt:start+120});}
      const transaction=await chainOpen(chain,c,e);coordinator.update(e.id,row=>row.chain.open=transaction);return active();
    }
    async function seal() {
      const e=active();if(!e)throw new Error('No active epoch');
      const sealed=coordinator.seal(e.id),commit=await chainCommit(chain,c,sealed);
      const finality=await chain.assertFinalized(commit);
      if(await chain.now()>=sealed.startAt)throw new Error('LATE_ANCHOR: cancel this epoch; never backdate its evidence');
      coordinator.update(e.id,row=>{row.chain.commit=commit;row.chain.finality={...finality,checkedAt:Math.floor(Date.now()/1000)};});return active();
    }
    async function execute() {
      let e=active();if(!e||e.status!=='SEALED'||!e.chain.finality)throw new Error('A finalized prior anchor is required');coordinator.verify(e);
      const market=e.beginMarket||await collectMarket({boundary:e.startAt});verifyMarket(market);
      coordinator.update(e.id,row=>row.beginMarket=market);
      await chain.assertFinalized(e.chain.commit);
      const liquidity=await alignTestLiquidity(chain,c,e.id+'-begin-liquidity',market);
      const marks=await setMarks(chain,c,e.id+'-begin-marks',market),execution=await chain.tx(e.id+'-execute',c.fund,'execute',[e.id,e.targets]);
      coordinator.update(e.id,row=>{row.status='EXECUTED';row.chain.execution=execution;row.chain.beginMark=marks;row.chain.beginLiquidity=liquidity;});return active();
    }
    async function settle() {
      const e=active();if(!e||e.status!=='EXECUTED')throw new Error('Executed epoch required');coordinator.verify(e);
      const recovery=args.includes('--recovery');
      const market=recovery?(e.recoveryMarket||await collectMarket()):(e.endMarket||await collectMarket({boundary:e.endAt}));verifyMarket(market);
      if(recovery&&market.boundary<e.endAt)throw new Error('Recovery cannot precede planned end');
      coordinator.update(e.id,row=>{if(recovery)row.recoveryMarket=market;else row.endMarket=market;});
      const liquidity=await alignTestLiquidity(chain,c,e.id+'-end-liquidity'+(recovery?'-recovery-'+market.boundary:''),market);coordinator.update(e.id,row=>row.chain.endLiquidity=liquidity);
      const evidence=await settlePilot(chain,c,coordinator,e.id,e.beginMarket,market);
      atomicJson(join(directory,`epoch-${e.id}.json`),evidence);
      const result={schema:'MM_EXTERNAL_PILOT_V2',environment:'MONAD_TESTNET',chainId:10143,contracts:c,
        epochs:coordinator.read().epochs.filter(e=>e.status==='SETTLED').map(e=>e.evidence),transactions:load(join(directory,'transactions.json'))};
      // Never publish journal raw transactions or secrets through the UI.
      result.transactions=Object.values(result.transactions).map(({raw,...r})=>r);
      atomicJson(join(directory,'external-evidence.json'),result);return evidence;
    }
    async function waitUntil(timestamp,label) {while(Date.now()/1000<timestamp){console.log(`${label}: ${Math.ceil(timestamp-Date.now()/1000)}초 남음`);await delay(Math.min(30000,timestamp*1000-Date.now()));}}
    let result;
    if(command==='cycle') {const count=Number(option('cycles','1'));if(!Number.isInteger(count)||count<1||count>20)throw new Error('cycles must be 1–20');for(let i=0;i<count;i++){let e=active()||await open();if(e.status==='OPEN'&&!e.chain.open)e=await open();console.log(JSON.stringify({epoch:e.id,cutoffAt:e.cutoffAt,startAt:e.startAt,endAt:e.endAt,action:'Providers must submit their signed alpha through the SDK before cutoff'}));if(e.status==='OPEN'){await waitUntil(e.cutoffAt,'제출 접수');e=await seal();}if(e.status==='SEALED'){if(!e.chain.finality)e=await seal();await waitUntil(e.startAt+5,'사전 anchor 이후 시작 봉');e=await execute();}if(e.status==='EXECUTED'){await waitUntil(e.endAt+5,'결과 봉 종료');result=await settle();}}}
    else if(command==='open')result=await open();else if(command==='seal')result=await seal();else if(command==='execute')result=await execute();else if(command==='settle')result=await settle();
    else if(command==='cancel') {const e=active();if(!e)throw new Error('No active epoch');result=await chain.tx(e.id+'-cancel',c.fund,'cancelUnexecuted',[e.id]);coordinator.update(e.id,(row,s)=>{row.status='CANCELLED';s.history=[...s.history.filter(h=>h.epochId!==e.id),...row.actors.map(a=>({actorId:a.id,epochId:e.id,settled:false,submitted:a.providerKeys.some(k=>row.submissions[k]),contributionBps:null}))];});}
    else if(command==='redeem') {
      const request=option('request');if(!request)throw new Error('redeem requires a stable --request ID for retry');
      const intentFile=join(directory,'redeem-'+digest(request)+'.json');let intent=existsSync(intentFile)?load(intentFile):null;
      if(!intent){intent={request,shares:String((await chain.read(c.fund,'balanceOf',[c.investor]))[0])};atomicJson(intentFile,intent);}
      result=await chain.tx('redeem-'+request,c.fund,'redeem',[BigInt(intent.shares),digest(request)]);
      const iface=new Interface(c.fund.abi);const event=result.logs.filter(l=>l.address.toLowerCase()===c.fund.address.toLowerCase()).map(l=>{try{return iface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='Redeem');
      if(!event)throw new Error('Redemption event missing');
      const redemption={transaction:result,shares:intent.shares,cashReceived:String(event.args.cashOut),after:await balances(chain,c)};
      atomicJson(join(directory,'redemption.json'),redemption);
      const evidenceFile=join(directory,'external-evidence.json');if(existsSync(evidenceFile)){const evidence=load(evidenceFile);evidence.redemption=redemption;evidence.transactions=Object.values(load(join(directory,'transactions.json'))).map(({raw,...r})=>r);atomicJson(evidenceFile,evidence);}
    }
    console.log(JSON.stringify({command,epoch:result?.id||null,status:result?.status||'RECORDED',evidenceDirectory:directory}));
  } finally {if(lock!==undefined){closeSync(lock);unlinkSync(lockPath);}chain.close();}
}
main().catch(error=>{console.error(error.shortMessage||error.message);process.exitCode=1;});
