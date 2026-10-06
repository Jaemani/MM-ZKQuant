// Real, labelled testnet E2E. Secrets and private attribution stay in .data.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {Wallet,Contract,JsonRpcProvider,parseEther,hexlify,randomBytes} from 'ethers';
import {encryptRequest} from '../src/integration/sealed.js';
import {verifyPlatformTee} from '../src/platform/tee-attestation.js';
import {investmentMessage} from '../src/platform/investment-message.js';
import {DEFAULT_POLICY} from '../src/platform/policy.js';
const dir='.data/platform-live';mkdirSync(dir,{recursive:true,mode:0o700});
const scenario=process.env.MMQ_E2E_NAME||'e2e';if(!/^[a-z0-9-]+$/.test(scenario))throw Error('INVALID_SCENARIO');
const path=`${dir}/${scenario}.json`,state=existsSync(path)?JSON.parse(readFileSync(path)):{};
const save=()=>writeFileSync(path,JSON.stringify(state,null,2),{mode:0o600});
const env=Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^['"]|['"]$/g,'')]));
if(!/^0x[0-9a-fA-F]{64}$/.test(env.MONAD_TESTNET_PRIVATE_KEY||''))throw Error('INVALID_DEPLOYER_KEY');
const provider=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1}),deployer=new Wallet(env.MONAD_TESTNET_PRIVATE_KEY,provider);
const api='https://mm-zkquant.vercel.app/api';
async function request(path,body,token){const r=await fetch(`${api}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(`${path}: ${j.error}`);return j;}
const config=await request('/v1/config');
const attested=await verifyPlatformTee({endpoint:config.teeEndpoint,publicKey:config.teeEncryptionPublicKey,vault:config.vaultAddress});
async function tee(path,message){const encrypted=encryptRequest(attested.encryptionPublicKey,message);const r=await fetch(`${attested.teeEndpoint}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(encrypted.packet)});const j=await r.json();if(!r.ok)throw Error(j.error);const result=encrypted.openReply(j.reply);if(result.error)throw Error(result.error);return result;}
async function investment(wallet,action,values={}){const input={action,wallet:wallet.address,nonce:hexlify(randomBytes(32)),...values};input.signature=await wallet.signMessage(investmentMessage(input));return tee('/platform/encrypted-investments',input);}
async function login(wallet){const c=await request('/v1/auth/challenge',{address:wallet.address});return request('/v1/auth/verify',{address:wallet.address,nonce:c.nonce,signature:await wallet.signMessage(c.message)});}
const tokenAbi=['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)'];
const token=new Contract(config.cashTokenAddress,tokenAbi,deployer);
const stage=process.argv[2]||'status';
try {
 if(stage==='setup'){
  for(const role of ['manager','investor']) {
   if(!state[role]){const w=Wallet.createRandom();state[role]={key:w.privateKey,address:w.address};save();}
   const w=new Wallet(state[role].key,provider);
   if(await provider.getBalance(w.address)<parseEther('0.03'))await(await deployer.sendTransaction({to:w.address,value:parseEther('0.1')})).wait();
   const amount=role==='manager'?300000000n:100000000n;
   if(await token.balanceOf(w.address)<amount)await(await token.transfer(w.address,amount)).wait();
   state[role].session=(await login(w)).sessionToken;save();
  }
  if(!state.apiKey){await request('/v1/strategists',{displayName:'E2E 검증 전략가',bio:'실제 테스트 AUSD로 입금·비공개 운용·정산 흐름을 검증하는 계정입니다.'},state.manager.session);state.apiKey=(await request('/v1/api-keys',{},state.manager.session)).apiKey;save();}
  if(!state.strategy){const settlement=Math.floor(Date.now()/1000)+900;state.strategy=await request('/v1/strategies',{slug:`e2e-${Date.now().toString(36)}`,name:'E2E 검증 · 독립 BTC 운용',description:'테스트넷 실제 자금 흐름 검증용 전략입니다. 투자 성과를 홍보하는 상품이 아닙니다.',risk:'HIGH',feeBps:2000,policy:{...DEFAULT_POLICY,settlementPeriodSeconds:3600,settlementOffsetSeconds:settlement%3600,withdrawalCutoffSeconds:0}},state.apiKey);save();}
  console.log({setup:true,strategy:state.strategy.slug,settlementOffsetSeconds:state.strategy.policy.settlementOffsetSeconds});
 }
 if(stage==='deposit-manager'||stage==='deposit-investor'){
  const role=stage.split('-')[1],wallet=new Wallet(state[role].key,provider),amount=role==='manager'?'200000000':'100000000';
  if(!state[role].deposit){state[role].deposit=await investment(wallet,'PREPARE',{strategyId:state.strategy.id,amount});save();}
  const d=state[role].deposit;
  if(!d.txHash){await(await new Contract(config.cashTokenAddress,tokenAbi,wallet).approve(config.vaultAddress,amount)).wait();const tx=await new Contract(config.vaultAddress,['function deposit(uint256,bytes32)'],wallet).deposit(amount,d.depositId);d.txHash=tx.hash;save();await tx.wait();}
  const result=await investment(wallet,'COMPLETE',{depositId:d.depositId,txHash:d.txHash});console.log({role,depositStatus:result.status,pending:result.pending});
 }
 if(stage==='submit'||stage==='close'){
  const status=await tee('/platform/encrypted-strategy',{action:'STATUS',strategyId:state.strategy.id,apiKey:state.apiKey});
  const result=await tee('/platform/encrypted-strategy',{action:'TARGET',strategyId:state.strategy.id,apiKey:state.apiKey,requestId:crypto.randomUUID(),sequence:status.sequence+1,targets:stage==='close'?[]:JSON.parse(process.env.MMQ_E2E_TARGETS||'[{"market":16,"weightBps":5000}]')});console.log(result);
 }
 if(stage==='policy'){
  const proposal=await request(`/v1/strategies/${state.strategy.id}/policy`,{policy:state.strategy.policy,feeBps:1000},state.apiKey);
  console.log({policyVersion:proposal.version,effectiveAfter:new Date(proposal.effectiveAfter*1000).toISOString()});
 }
 if(stage==='withdraw'||stage==='withdraw-half'){
  for(const role of ['manager','investor']){const wallet=new Wallet(state[role].key,provider),p=await investment(wallet,'PORTFOLIO'),position=p.positions.find(p=>p.strategyId===state.strategy.id);if(position&&BigInt(position.units)>0n&&!position.withdrawals.some(w=>['REQUESTED','SETTLING'].includes(w.status))){const amount=stage==='withdraw-half'&&role==='investor'?String(BigInt(position.units)/2n):position.units;const w=await investment(wallet,'WITHDRAW',{strategyId:state.strategy.id,amount});console.log({role,status:w.status,settlementAt:new Date(w.settlementAt*1000).toISOString()});}}
 }
 if(stage==='status'){
  console.log(await tee('/platform/encrypted-strategy',{action:'STATUS',strategyId:state.strategy.id,apiKey:state.apiKey}));
  for(const role of ['manager','investor']){const p=await investment(new Wallet(state[role].key),'PORTFOLIO');console.log({role,positions:p.positions});}
 }
}catch(e){console.error(e.shortMessage||e.message);process.exitCode=1;}finally{provider.destroy();}
