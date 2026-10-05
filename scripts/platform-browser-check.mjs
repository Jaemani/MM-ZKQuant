// Uses local test wallets through an EIP-1193 bridge; keys never enter the browser.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {Wallet,JsonRpcProvider,getBytes} from 'ethers';
const {chromium}=await import(process.env.MMQ_PLAYWRIGHT_MODULE || 'playwright');
const scenario=process.env.MMQ_E2E_NAME||'e2e';if(!/^[a-z0-9-]+$/.test(scenario))throw Error('INVALID_SCENARIO');
const state=JSON.parse(readFileSync(`.data/platform-live/${scenario}.json`));
const provider=new JsonRpcProvider('https://testnet-rpc.monad.xyz');
const base=process.env.MMQ_BROWSER_URL||'http://localhost:5173';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
mkdirSync('.data/platform-live/screenshots',{recursive:true});
const results=[];
try{
 for(const role of ['manager','investor']){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),wallet=new Wallet(state[role].key,provider),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeBinding('walletBridge',async(_,{method,params=[]})=>{
   if(['eth_requestAccounts','eth_accounts'].includes(method))return [wallet.address];
   if(method==='eth_chainId')return '0x279f';
   if(method==='personal_sign')return wallet.signMessage(params[0].startsWith('0x')?getBytes(params[0]):params[0]);
   if(method==='wallet_switchEthereumChain')return null;
   // This UI check only signs authentication/portfolio requests, never transfers.
   if(method==='eth_sendTransaction')throw Error('TRANSACTIONS_DISABLED_IN_READONLY_BROWSER_CHECK');
   return provider.send(method,params);
  });
  await page.addInitScript(()=>{window.ethereum={request:request=>window.walletBridge(request),on:()=>{},removeListener:()=>{}};});
  const configuration=page.waitForResponse(r=>r.url().endsWith('/api/v1/config')&&r.status()===200);
  await page.goto(base);await configuration;
  await page.getByRole('button',{name:role==='manager'?'전략가 콘솔':'내 포트폴리오',exact:true}).click();
  await page.getByRole('button',{name:'지갑으로 로그인',exact:true}).click();
  if(role==='manager'){
   await page.getByLabel('API 토큰',{exact:true}).fill(state.apiKey);
   await page.getByLabel(/내 전략/).selectOption(state.strategy.id);
   await page.getByRole('button',{name:'실행 상태 새로고침'}).click();
   await page.getByText('운용 상태:',{exact:false}).waitFor();
  }else{
   await page.getByText('로그인되었습니다.',{exact:false}).waitFor();
   await page.getByRole('heading',{name:'내 투자 현황'}).waitFor();
   await page.getByText('지급 완료',{exact:false}).first().waitFor();
   if(process.env.MMQ_REQUEST_WITHDRAWAL==='1'){
    await page.getByRole('button',{name:'운용 지분 출금 요청',exact:true}).click();
    await page.getByText('출금을 요청했습니다.',{exact:false}).waitFor();
   }
  }
  await page.screenshot({path:`.data/platform-live/screenshots/${role}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`.data/platform-live/screenshots/${role}-mobile.png`,fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  if(overflow)throw Error(`${role}: MOBILE_OVERFLOW`);
  if(errors.length)throw Error(`${role}: ${errors.join(', ')}`);
  results.push({role,login:true,privateView:true,mobileNavigation:await page.getByRole('button',{name:'전략 탐색',exact:true}).isVisible(),overflow,errors});await context.close();
 }
 writeFileSync('.data/platform-live/browser-check.json',JSON.stringify({at:new Date().toISOString(),base,results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();provider.destroy();}
