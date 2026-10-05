import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Wallet,JsonRpcProvider,Interface,Contract,hexlify,randomBytes} from 'ethers';
import {encryptRequest} from '../src/integration/sealed.js';
import {investmentMessage} from '../src/platform/investment-message.js';
const scenario=process.env.MMQ_E2E_NAME||'e2e';if(!/^[a-z0-9-]+$/.test(scenario))throw Error('INVALID_SCENARIO');
const state=JSON.parse(readFileSync(`.data/platform-live/${scenario}.json`));
const config=await(await fetch('https://mm-zkquant.vercel.app/api/v1/config')).json();
const provider=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1});
const transfer=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const audit={at:new Date().toISOString(),chainId:10143,checks:[],privateResults:[]};
try{
 for(const role of ['manager','investor']){
  const wallet=new Wallet(state[role].key),input={action:'PORTFOLIO',wallet:wallet.address,nonce:hexlify(randomBytes(32))};input.signature=await wallet.signMessage(investmentMessage(input));
  const c=encryptRequest(config.teeEncryptionPublicKey,input),r=await fetch(`${config.teeEndpoint}/platform/encrypted-investments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c.packet)});assert.equal(r.status,200);const p=c.openReply((await r.json()).reply);
  const position=p.positions.find(p=>p.strategyId===state.strategy.id);assert.equal(position.units,'0');assert.equal(position.pending,'0');
  for(const w of position.withdrawals){if(w.status==='CANCELLED')continue;assert.equal(w.status,'PAID');const receipt=await provider.getTransactionReceipt(w.txHash);assert.equal(receipt.status,1);
   assert.ok(receipt.logs.some(log=>{if(log.address.toLowerCase()!==config.cashTokenAddress.toLowerCase())return false;try{const e=transfer.parseLog(log);return e.args.from.toLowerCase()===config.vaultAddress.toLowerCase()&&e.args.to.toLowerCase()===wallet.address.toLowerCase()&&e.args.value===BigInt(w.amount);}catch{return false;}}));
  }
  audit.privateResults.push({role,wallet:wallet.address,position});audit.checks.push(`${role}: shares burned, real AUSD payment independently verified`);
 }
 const vault=new Contract(config.vaultAddress,['function accountCount() view returns(uint256)','function accounts(uint256) view returns(address)'],provider);
 const count=Number(await vault.accountCount());for(let i=0;i<count;i++){const address=await vault.accounts(i),slot=new Contract(address,['function position() view returns(int256,uint256,bool)'],provider);assert.equal((await slot.position())[0],0n);}
 audit.checks.push('all execution accounts flat after scheduled full redemption');
 writeFileSync(`.data/platform-live/${scenario}-audit.json`,JSON.stringify(audit,null,2));
 console.log({passed:true,checks:audit.checks});
}finally{provider.destroy();}
