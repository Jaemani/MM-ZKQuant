// Read-only check using an existing, locally generated test strategist wallet.
// Never submit orders, fund accounts, or alter a live ledger in this check.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {Wallet,getBytes} from 'ethers';
import {encryptRequest} from '../src/integration/sealed.js';
import {money} from '../src/web/platformModel.js';

const {chromium}=await import(process.env.MMQ_PLAYWRIGHT_MODULE||'/tmp/mmq-browser/node_modules/playwright/index.mjs');
const base=process.env.MMQ_BROWSER_URL||'https://mm-zkquant.vercel.app';
const state=JSON.parse(readFileSync(process.env.MMQ_E2E_STATE_PATH||'.data/platform-live/gas-recovery.json'));
const config=await fetch(`${base}/api/v1/config`).then(response=>response.json());
const channel=encryptRequest(config.teeEncryptionPublicKey,{action:'STATUS',strategyId:state.strategy.id,apiKey:state.apiKey});
const response=await fetch(`${base}/api/tee/encrypted-strategy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(channel.packet),signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200);
const result=channel.openReply((await response.json()).reply);
assert.ok(!result.error,'Owner STATUS must succeed');
const fees=result.performanceFees;
assert.ok(fees,'The deployed TEE must expose fee summaries');
for(const field of ['estimated','outstanding','paid','payments','historyComplete'])assert.ok(field in fees);
for(const forbidden of ['investors','lots','units','targets','positions','slots'])assert.ok(!(forbidden in fees));

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const dir='.data/manager-fees';mkdirSync(dir,{recursive:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const wallet=new Wallet(state.manager.key),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.exposeBinding('walletBridge',async(_,{method,params=[]})=>{
    if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet.address];
    if(method==='eth_chainId')return '0x279f';
    if(method==='personal_sign')return wallet.signMessage(params[0].startsWith('0x')?getBytes(params[0]):params[0]);
    if(method==='wallet_switchEthereumChain')return null;
    throw Error(`Read-only browser does not permit ${method}`);
  });
  await page.addInitScript(()=>{window.ethereum={request:request=>window.walletBridge(request),on:()=>{},removeListener:()=>{}};});
  await page.goto(`${base}/manage/${state.strategy.id}`);
  await page.getByRole('button',{name:'지갑으로 로그인',exact:true}).first().click();
  const panel=page.getByRole('region',{name:'내 성과보수',exact:true});
  await panel.getByText('누적 지급',{exact:true}).waitFor({timeout:60000});
  assert.equal(await panel.locator('.q-stat').count(),3);
  assert.equal(await panel.locator('.q-stat').nth(2).locator('strong').textContent(),`${money(fees.paid)}AUSD`);
  assert.equal(await panel.locator('.q-fee-payments li').count(),fees.payments.length);
  assert.equal(await page.locator('.q-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 13, 27)');
  await panel.getByRole('button',{name:'성과보수 새로고침'}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="성과보수 새로고침"]')?.disabled);
  await panel.screenshot({path:`${dir}/desktop.png`});
  await page.setViewportSize({width:390,height:844});
  await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:`${dir}/mobile.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  const report={verified:true,ownerFeeStatus:true,feeStats:3,paymentRows:fees.payments.length,latestDarkDesign:true,mobileOverflow:false,pageErrors:errors.length};
  writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await browser.close();}
