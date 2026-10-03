// One bounded claim of valueless test collateral. No mainnet support.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {Wallet,JsonRpcProvider,Contract,parseEther,formatEther,formatUnits} from 'ethers';
const provider=new JsonRpcProvider('https://testnet-rpc.monad.xyz',undefined,{batchMaxCount:1,cacheTimeout:-1});
const dir='.data/ausd-claim';mkdirSync(dir,{recursive:true,mode:0o700});
const path=dir+'/transaction.json';
try {
  assert.equal((await provider.getNetwork()).chainId,10143n);
  const wallet=new Wallet(JSON.parse(readFileSync('.data/testnet-pilot/wallet.json')).privateKey,provider);
  assert.equal(wallet.address,'0xA761529aE65a0966125C47911DEDCC7F23951D57');
  const tokenAddress='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
  const token=new Contract(tokenAddress,['function balanceOf(address) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)'],provider);
  const faucet=new Contract('0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C',[
    'function token() view returns(address)','function faucetDripAmount() view returns(uint256)',
    'function requestFunds(address)','event FundsRequested(address indexed receiver,uint256 amount)',
  ],wallet);
  assert.equal(await faucet.token(),tokenAddress);
  let state=existsSync(path)?JSON.parse(readFileSync(path)):null;
  const before=await token.balanceOf(wallet.address);
  if(!state&&before>=200000000n){console.log('Already funded; no claim sent.');}
  else if(!process.argv.includes('--execute')){console.log('Read only. Use --execute to claim once.');}
  else {
    if(!state){
      const drip=await faucet.faucetDripAmount();assert.ok(drip>=200000000n&&drip<=10000000000n);
      await faucet.requestFunds.staticCall(wallet.address);
      const request=await faucet.requestFunds.populateTransaction(wallet.address),fees=await provider.getFeeData();
      const gasLimit=await wallet.estimateGas(request)*13n/10n;
      assert.ok(gasLimit*fees.maxFeePerGas<=parseEther('0.1'),'Faucet gas cap: 0.1 test MON');
      const tx=await wallet.sendTransaction({...request,gasLimit,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});
      state={hash:tx.hash,before:String(before),drip:String(drip)};
      writeFileSync(path,JSON.stringify(state),{mode:0o600});console.log('Claim submitted '+tx.hash);
    }
    let receipt;
    for(let n=0;n<90;n++){
      receipt=await provider.getTransactionReceipt(state.hash);
      if(receipt)break;
      await new Promise(r=>setTimeout(r,1000));
    }
    assert.ok(receipt,'Pending claim; rerun to reconcile the same hash');assert.equal(receipt.status,1);
    const events=receipt.logs.filter(l=>l.address.toLowerCase()===tokenAddress.toLowerCase()).map(l=>token.interface.parseLog(l));
    assert.ok(events.some(e=>e.name==='Transfer'&&e.args.to===wallet.address&&e.args.value===BigInt(state.drip)));
    const after=await token.balanceOf(wallet.address,{blockTag:receipt.blockNumber});
    assert.equal(after-BigInt(state.before),BigInt(state.drip));
    const report={observedAt:new Date().toISOString(),status:'PASS_TEST_AUSD_RECEIVED',chainId:10143,
      wallet:wallet.address,token:tokenAddress,faucet:await faucet.getAddress(),transaction:state.hash,
      block:receipt.blockNumber,blockHash:receipt.blockHash,receiptStatus:receipt.status,
      receivedAUSD:formatUnits(state.drip,6),balanceAfterAUSD:formatUnits(after,6),feeMON:formatEther(receipt.fee),
      explorer:'https://testnet.monadscan.com/tx/'+state.hash,logs:receipt.logs};
    writeFileSync('docs/evidence/ausd-claim-testnet.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({status:report.status,receivedAUSD:report.receivedAUSD,feeMON:report.feeMON}));
  }
} finally {provider.destroy();}
