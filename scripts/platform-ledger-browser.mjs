// Read-only screens, using only our existing locally generated fixture wallet.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {Wallet,getBytes} from 'ethers';
const {chromium}=await import(process.env.MMQ_PLAYWRIGHT_MODULE||'/tmp/mmq-browser/node_modules/playwright/index.mjs');
const base=process.env.MMQ_BROWSER_URL||'https://mm-zkquant.vercel.app';
const fixture=JSON.parse(readFileSync('.data/platform-live/gas-recovery.json')),wallet=new Wallet(fixture.manager.key);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const directory='.data/platform-ledger-browser';mkdirSync(directory,{recursive:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.exposeBinding('walletBridge',async(_,{method,params=[]})=>{
  if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet.address];if(method==='eth_chainId')return '0x279f';
  if(method==='personal_sign')return wallet.signMessage(params[0].startsWith('0x')?getBytes(params[0]):params[0]);
  if(method==='wallet_switchEthereumChain')return null;throw Error('Read-only browser forbids '+method);
 });
 await page.addInitScript(()=>{window.ethereum={request:request=>window.walletBridge(request),on:()=>{},removeListener:()=>{}};});
 await page.goto(`${base}/manage/${fixture.strategy.id}`);await page.getByRole('button',{name:'지갑으로 로그인',exact:true}).first().click();
 let panel=page.getByRole('region',{name:'장부 ZK 검증',exact:true});await panel.getByText('온체인 검증 완료',{exact:true}).waitFor({timeout:60000});
 assert.equal(await page.locator('.q-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 13, 27)');
 assert.ok((await panel.getByRole('link',{name:/검증 거래/}).getAttribute('href')).includes('/tx/0x'));
 await panel.screenshot({path:directory+'/strategist.png'});
 await page.goto(base+'/assets');panel=page.getByRole('region',{name:'장부 ZK 검증',exact:true});await panel.getByText('온체인 검증 완료',{exact:true}).waitFor({timeout:60000});
 await panel.getByRole('button',{name:'장부 검증 새로고침'}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="장부 검증 새로고침"]')?.disabled);
 await panel.screenshot({path:directory+'/investor.png'});await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:directory+'/mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 const report={verified:true,strategistProofPanel:true,investorProofPanel:true,onchainLink:true,latestDarkDesign:true,mobileOverflow:false,pageErrors:errors.length};
 writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
