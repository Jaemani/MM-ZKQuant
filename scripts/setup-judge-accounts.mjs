// Bounded, resumable real-testnet fixtures. Credentials and keys never enter the repository or browser bundle.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {Wallet,Contract,JsonRpcProvider,FetchRequest,getBytes,hexlify} from 'ethers';
import {environment,rpcUrl,api,tee,savePrivate} from './platform-ops.mjs';
import {verifyPlatformTee} from '../src/platform/tee-attestation.js';
import {SealedStore} from '../src/integration/sealed.js';
import {durableSubmitter} from '../protocol/cohort/durable-submitter.mjs';
const directory='.data/judge-accounts',path=directory+'/fixture.json',fresh=()=>({key:Wallet.createRandom().privateKey,password:randomBytes(12).toString('base64url'),depositRequestId:hexlify(randomBytes(32)),completeRequestId:hexlify(randomBytes(32))});
const fixture=existsSync(path)?JSON.parse(readFileSync(path)):{version:1,strategist:{username:'judge-strategist',...fresh(),amount:'400000000'},investor:{username:'judge-investor',...fresh(),amount:'200000000'},allocationRequestId:hexlify(randomBytes(32))};
const save=()=>savePrivate(path,fixture);save();
for(const account of [fixture.strategist,fixture.investor]){
 let auth;
 try{auth=await api('/v1/auth/login',{body:{username:account.username,password:account.password}});}catch(e){if(e.message!=='INVALID_CREDENTIALS')throw e;auth=await api('/v1/auth/register',{body:{username:account.username,password:account.password}});}
 account.sessionToken=auth.sessionToken;account.userId=auth.userId;account.wallet=new Wallet(account.key).address;save();
}
await api('/v1/strategists',{token:fixture.strategist.sessionToken,body:{displayName:'Hyblock Quant',bio:'A testnet strategy operated with the strategist’s own capital. Private targets, public results.'}});
if(!fixture.strategy){
 const owned=await api('/v1/me/strategies',{token:fixture.strategist.sessionToken});
 fixture.strategy=owned.strategies.find(s=>s.slug==='hyblock-judge-strategy')||await api('/v1/strategies',{token:fixture.strategist.sessionToken,body:{slug:'hyblock-judge-strategy',name:'Hyblock Private Quant',description:'Explore independent quantitative execution on Monad Testnet. Redemptions settle every minute for judging.',risk:'MEDIUM',feeBps:2000,policy:{settlementPeriodSeconds:60,settlementOffsetSeconds:0,withdrawalCutoffSeconds:0}}});save();
}
writeFileSync(directory+'/access.md',`# Veilvest judge access\n\nSite: https://mm-zkquant.vercel.app\n\n| Role | Username | Password |\n| --- | --- | --- |\n| Strategist | ${fixture.strategist.username} | ${fixture.strategist.password} |\n| Investor | ${fixture.investor.username} | ${fixture.investor.password} |\n\nThese are funded Monad Testnet accounts. No wallet extension is needed to allocate, submit targets or request redemption. Redemptions return to the platform balance; settlement runs every minute for the judge strategy.\n\nDo not share the fixture JSON; it contains the preparation wallets’ private keys.\n`,{mode:0o600});
if(!process.argv.includes('--fund')){console.log(JSON.stringify({accountsReady:true,funded:Boolean(fixture.funded),accessFile:directory+'/access.md',fundingCommand:'npm run setup:judges -- --fund'}));process.exit(0);}
const config=await api('/v1/config');await verifyPlatformTee({endpoint:config.teeEndpoint,publicKey:config.teeEncryptionPublicKey,vault:config.vaultAddress});
const rpc=new FetchRequest(rpcUrl);rpc.timeout=20000;
const provider=new JsonRpcProvider(rpc,10143,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),funder=new Wallet(environment.MONAD_TESTNET_PRIVATE_KEY,provider);
async function submitter(wallet,label){const store=new SealedStore(`${directory}/${label}-transactions.json`,Buffer.from(getBytes(wallet.privateKey)),'judge-fixture-transactions');const journal=durableSubmitter({provider,wallet,store,chainId:10143,initialNonce:await provider.getTransactionCount(wallet.address,'latest')});await journal.sync();return journal;}
const funderTx=await submitter(funder,'funder');
const tokenAbi=['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)'];
try{
 if(!funderTx.lookup('judge-ledger-gas'))await funderTx.submit('judge-ledger-gas',{to:'0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7',value:'3000000000000000000'});
 for(const [role,account] of [['strategist',fixture.strategist],['investor',fixture.investor]]){
  const wallet=new Wallet(account.key,provider),privateRequest=(action,values)=>tee(config,'/platform/encrypted-investments',{action,sessionToken:account.sessionToken,requestId:hexlify(randomBytes(32)),...values});
  if(!account.prepared){account.prepared=await privateRequest('PREPARE_TOPUP',{wallet:wallet.address,amount:account.amount,requestId:account.depositRequestId});save();}
  const gasId=`judge-${role}-gas`,cashId=`judge-${role}-cash`;
  if(!funderTx.lookup(gasId))await funderTx.submit(gasId,{to:wallet.address,value:'100000000000000000'});
  if(!funderTx.lookup(cashId))await funderTx.submit(cashId,await new Contract(config.cashTokenAddress,tokenAbi,funder).transfer.populateTransaction(wallet.address,account.amount));
  const walletTx=await submitter(wallet,role),token=new Contract(config.cashTokenAddress,tokenAbi,wallet),vault=new Contract(config.vaultAddress,['function deposit(uint256,bytes32)'],wallet);
  const approvalId='judge-approve',depositId='judge-deposit';
  if(!walletTx.lookup(approvalId))await walletTx.submit(approvalId,await token.approve.populateTransaction(config.vaultAddress,account.amount));
  if(!walletTx.lookup(depositId))await walletTx.submit(depositId,await vault.deposit.populateTransaction(account.amount,account.prepared.depositId));
  account.depositTx=walletTx.lookup(depositId).hash;save();
  await privateRequest('COMPLETE_TOPUP',{depositId:account.prepared.depositId,txHash:account.depositTx,requestId:account.completeRequestId});account.funded=true;save();
 }
 if(!fixture.allocated){await tee(config,'/platform/encrypted-investments',{action:'ALLOCATE',sessionToken:fixture.strategist.sessionToken,requestId:fixture.allocationRequestId,strategyId:fixture.strategy.id,amount:'200000000'});fixture.allocated=true;save();}
 if(!fixture.target){const status=await tee(config,'/platform/encrypted-strategy',{action:'STATUS',sessionToken:fixture.strategist.sessionToken,strategyId:fixture.strategy.id});fixture.target={requestId:'judge-seed-'+randomBytes(12).toString('hex'),sequence:status.sequence+1,targets:[{market:16,weightBps:1000}]};save();}
 if(!fixture.submitted){await tee(config,'/platform/encrypted-strategy',{...fixture.target,action:'TARGET',sessionToken:fixture.strategist.sessionToken,strategyId:fixture.strategy.id});fixture.submitted=true;save();}
 fixture.funded=true;save();console.log(JSON.stringify({accountsReady:true,funded:true,totalSeedAUSD:600,strategyId:fixture.strategy.id,settlementSeconds:60,accessFile:directory+'/access.md'}));
}finally{provider.destroy();}
