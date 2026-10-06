// Actual account UI with wallet calls forbidden. Use funded fixtures only; no mocked balances or orders.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.MMQ_PLAYWRIGHT_MODULE||'/tmp/mmq-browser/node_modules/playwright/index.mjs');
const fixture=JSON.parse(readFileSync('.data/judge-accounts/fixture.json'));
const base=process.env.MMQ_BROWSER_URL||'https://mm-zkquant.vercel.app',directory='.data/judge-accounts/screenshots';mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),report={verified:false,roles:[],walletRequests:0,pageErrors:[],mobileOverflow:false,english:true};
try{
 for(const [role,account] of [['investor',fixture.investor],['strategist',fixture.strategist]]){
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.exposeFunction('judgeWalletRequest',()=>{report.walletRequests++;throw Error('No wallet available for judge account flows');});
  await page.addInitScript(()=>{window.ethereum={on(){},removeListener(){},request:request=>window.judgeWalletRequest(request)};});
  await page.goto(base+'/assets');await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Username',{exact:true}).fill(account.username);await dialog.getByLabel('Password',{exact:true}).fill(account.password);await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.locator('#q-platform-balance').getByRole('heading',{name:'Platform balance',exact:true}).waitFor({timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#q-platform-balance .q-stat strong')?.textContent?.match(/\d/),{timeout:60000});
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
  assert.equal(await page.locator('.q-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(14, 9, 28)');
  await page.screenshot({path:`${directory}/${role}-assets-desktop.png`,fullPage:true});
  if(role==='strategist'){
   await page.goto(`${base}/manage/${fixture.strategy.id}`);await page.getByRole('heading',{name:'My performance fees',exact:true}).waitFor({timeout:60000});
   await page.getByRole('tab',{name:'Submit targets',exact:true}).first().click();await page.getByRole('heading',{name:'New target weights',exact:true}).waitFor();
   await page.screenshot({path:`${directory}/strategist-targets-desktop.png`,fullPage:true});
   await page.goto(base+'/manage/api');await page.getByRole('heading',{name:'My API tokens',exact:true}).waitFor();
  }else{
   await page.goto(`${base}/strategies/${fixture.strategy.slug}`);await page.getByRole('heading',{name:'Invest in this strategy',exact:true}).waitFor({timeout:60000});
   await page.getByLabel('Allocation amount',{exact:true}).fill('25');await page.getByRole('button',{name:'Review allocation',exact:true}).click();
   const review=page.getByRole('dialog');await review.getByRole('button',{name:'Confirm allocation',exact:true}).waitFor();assert.ok((await review.innerText()).includes('platform balance'));await review.getByRole('button',{name:'Close',exact:true}).click();
   await page.screenshot({path:`${directory}/investor-strategy-desktop.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/assets');await page.locator('#q-platform-balance').waitFor();await page.waitForFunction(()=>document.querySelector('#q-platform-balance .q-stat strong')?.textContent?.match(/\d/),{timeout:60000});
  await page.screenshot({path:`${directory}/${role}-assets-mobile.png`,fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);report.mobileOverflow||=overflow;
  await page.reload();await page.locator('#q-platform-balance').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#q-platform-balance .q-stat strong')?.textContent?.match(/\d/),{timeout:60000});report.roles.push({role,login:true,assets:true,sessionRestored:true});await context.close();
 }
 assert.equal(report.walletRequests,0);assert.deepEqual(report.pageErrors,[]);assert.equal(report.mobileOverflow,false);report.verified=true;
 writeFileSync('.data/judge-accounts/browser-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
