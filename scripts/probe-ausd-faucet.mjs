// Read-only: no key loading, signing, faucet claim or token transfer.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { JsonRpcProvider, Contract, formatUnits, keccak256 } from 'ethers';

const rpcUrl='https://testnet-rpc.monad.xyz';
const provider=new JsonRpcProvider(rpcUrl,undefined,{batchMaxCount:1,cacheTimeout:-1});
const faucet='0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C';
const token='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
const wallet='0xA761529aE65a0966125C47911DEDCC7F23951D57';
try {
  assert.equal((await provider.getNetwork()).chainId,10143n);
  const block=await provider.getBlock('latest');
  const options={blockTag:block.number};
  const f=new Contract(faucet,[
    'function token() view returns(address)',
    'function faucetDripAmount() view returns(uint256)',
    'function maxAmountToOwn() view returns(uint256)',
    'function maxDripFrequency() view returns(uint256)',
    'function lastDripTimestamp() view returns(uint256)',
    'function requestFunds(address)',
    'error InsufficientFunds()', 'error MaxAllowedExceeded()', 'error MaxFrequencyExceeded()',
  ],provider);
  const t=new Contract(token,['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)'],provider);
  assert.equal(await f.token(options),token);
  const decimals=Number(await t.decimals(options));assert.equal(decimals,6);
  const [balance,recipientBalance,drip,maximum,frequency,lastDrip,code,implementationSlot]=await Promise.all([
    t.balanceOf(faucet,options),t.balanceOf(wallet,options),f.faucetDripAmount(options),
    f.maxAmountToOwn(options),f.maxDripFrequency(options),f.lastDripTimestamp(options),
    provider.getCode(faucet,block.number),
    provider.getStorage(faucet,'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',block.number),
  ]);
  assert.notEqual(code,'0x');
  const contextResponse=await fetch('https://testnet.perpl.xyz/api/v1/pub/context');
  assert.equal(contextResponse.status,200);
  const context=await contextResponse.json();
  assert.equal(context.chain.chain_id,10143);
  const exchange=context.instances.find(x=>x.address.toLowerCase()==='0x1964c32f0be608e7d29302aff5e61268e72080cc');
  assert.ok(exchange);
  assert.equal(context.tokens.find(x=>x.id===exchange.collateral_token_id).address.toLowerCase(),token.toLowerCase());
  let claimSimulation;
  try {
    await f.requestFunds.staticCall(wallet,{...options,from:wallet});
    claimSimulation={status:'SIMULATION_PASS_NOT_CLAIMED'};
  } catch(error) {
    if(!error.revert?.name)throw error;
    claimSimulation={status:'REVERT',reason:error.revert.name,data:error.data};
  }
  const report={
    observedAt:new Date().toISOString(),rpcUrl,chainId:10143,block:block.number,blockHash:block.hash,
    blockTimestamp:block.timestamp,readOnly:true,transactionsSent:0,
    sources:{deployments:'https://docs.agora.finance/developer/contract-deployments',
      faucet:`https://testnet.monadscan.com/address/${faucet}`,
      perplContext:'https://testnet.perpl.xyz/api/v1/pub/context'},
    faucet,token,wallet,decimals,proxyCodeHash:keccak256(code),implementation:'0x'+implementationSlot.slice(-40),
    faucetBalanceBaseUnits:String(balance),faucetBalanceAUSD:formatUnits(balance,decimals),
    walletBalanceAUSD:formatUnits(recipientBalance,decimals),
    dripAmountAUSD:formatUnits(drip,decimals),maxAmountToOwnAUSD:formatUnits(maximum,decimals),
    maxDripFrequencySeconds:String(frequency),lastDripTimestamp:String(lastDrip),
    perplMinimumNewAccountAUSD:formatUnits(exchange.min_account_open_amount,decimals),
    claimSimulation,
  };
  writeFileSync('docs/evidence/ausd-faucet-readiness.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {provider.destroy();}
