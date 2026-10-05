// Real browser actions, restricted to disposable test wallets and the current testnet Vault.
import { readFileSync, writeFileSync } from 'node:fs';
import { Wallet, JsonRpcProvider, getBytes, Interface } from 'ethers';
const {chromium}=await import(process.env.MMQ_PLAYWRIGHT_MODULE || 'playwright');
const state = JSON.parse(readFileSync('.data/platform-live/hedge.json'));
const config = await (await fetch('https://mm-zkquant.vercel.app/api/v1/config')).json();
const provider = new JsonRpcProvider('https://testnet-rpc.monad.xyz', undefined, {batchMaxCount:1,cacheTimeout:-1});
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const token = new Interface(['function approve(address spender,uint256 amount)']);
const vault = new Interface(['function deposit(uint256 amount,bytes32 id)']);
const results=[];
try {
 for (const role of (process.env.MMQ_BROWSER_ROLES || 'manager,investor').split(',')) {
  const wallet=new Wallet(state[role].key,provider),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  const amount=role==='manager'?200000000n:100000000n;
  let deposited=false;
  await page.exposeBinding('walletBridge',async(_,{method,params=[]})=>{
   if(['eth_requestAccounts','eth_accounts'].includes(method))return [wallet.address];
   if(method==='eth_chainId')return '0x279f';
   if(method==='personal_sign')return wallet.signMessage(params[0].startsWith('0x')?getBytes(params[0]):params[0]);
   if(method==='wallet_switchEthereumChain')return null;
   if(method==='eth_sendTransaction'){
    const tx=params[0];if(tx.from.toLowerCase()!==wallet.address.toLowerCase()||BigInt(tx.value||0)!==0n)throw Error('INVALID_TEST_TRANSACTION');
    if(tx.to.toLowerCase()===config.cashTokenAddress.toLowerCase()) {const d=token.parseTransaction(tx);if(d.name!=='approve'||d.args[0].toLowerCase()!==config.vaultAddress.toLowerCase()||d.args[1]!==amount)throw Error('INVALID_APPROVAL');}
    else if(tx.to.toLowerCase()===config.vaultAddress.toLowerCase()){const d=vault.parseTransaction(tx);if(d.name!=='deposit'||d.args[0]!==amount||deposited)throw Error('INVALID_DEPOSIT');deposited=true;}
    else throw Error('UNAUTHORIZED_TEST_DESTINATION');
    const sent=await wallet.sendTransaction({to:tx.to,data:tx.data,value:0});return sent.hash;
   }
   return provider.send(method,params);
  });
  await page.addInitScript(()=>{window.ethereum={request:r=>window.walletBridge(r),on:()=>{},removeListener:()=>{}};});
  await page.goto(process.env.MMQ_BROWSER_URL||'http://localhost:5173');
  await page.getByRole('button',{name:'내 포트폴리오',exact:true}).click();
  await page.getByRole('button',{name:'지갑으로 로그인',exact:true}).click();
  await page.getByText('로그인되었습니다.',{exact:false}).waitFor();
  await page.getByLabel(/공개 전략/).selectOption(state.strategy.id);
  await page.getByLabel('입금 금액 (AUSD)',{exact:true}).fill(String(amount/1000000n));
  await page.getByRole('button',{name:'TEE 배분 준비 후 입금',exact:true}).click();
  await page.getByText('대기 자금으로 입금되었습니다.',{exact:false}).waitFor({timeout:120000});
  if(role==='investor'&&process.env.MMQ_TEST_CANCEL_PENDING==='1'){
   await page.getByRole('button',{name:'대기 자금 전액 출금 요청',exact:true}).click();
   await page.getByText('출금을 요청했습니다.',{exact:false}).waitFor();
   await page.getByRole('button',{name:'출금 취소',exact:true}).click();
   await page.getByText('출금 요청을 취소했습니다.',{exact:false}).waitFor();
  }
  await page.screenshot({path:`.data/platform-live/screenshots/${role}-real-deposit.png`,fullPage:true});
  if(role==='manager'){
   await page.getByRole('button',{name:'전략가 콘솔',exact:true}).click();
   await page.getByRole('button',{name:'지갑으로 로그인',exact:true}).click();
   await page.getByLabel('API 토큰',{exact:true}).fill(state.apiKey);
   await page.getByLabel(/내 전략/).selectOption(state.strategy.id);
   await page.getByLabel('BTC 목표 비중 (%)',{exact:true}).fill('-50');
   await page.getByRole('button',{name:'암호화해 TEE에 제출',exact:true}).click();
   await page.getByText('TEE 접수:',{exact:false}).waitFor({timeout:30000});
  }
  results.push({role,depositSubmitted:deposited,pendingConfirmed:true,targetSubmitted:role==='manager'});await context.close();
 }
 writeFileSync('.data/platform-live/browser-transactions.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(results);
}finally{await browser.close();provider.destroy();}
