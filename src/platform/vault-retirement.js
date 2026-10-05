import { Contract } from 'ethers';

const n=x=>BigInt(x||0);
export function assertInvestmentStateEmpty(state) {
  for(const book of Object.values(state.books||{})) {
    if(['cash','equity','totalUnits','feesDue'].some(k=>n(book[k])!==0n)||book.settlement)throw Error('VAULT_HAS_ACTIVE_INVESTMENTS');
    if(Object.values(book.investors||{}).some(p=>n(p.pending)||n(p.units)))throw Error('VAULT_HAS_ACTIVE_INVESTMENTS');
    if(Object.values(book.requests||{}).some(r=>['QUEUED','EXECUTING'].includes(r.status)))throw Error('VAULT_HAS_ACTIVE_INVESTMENTS');
    if(Object.values(book.withdrawals||{}).some(w=>['REQUESTED','SETTLING'].includes(w.status)))throw Error('VAULT_HAS_ACTIVE_INVESTMENTS');
  }
  for(const pool of Object.values(state.sharedAccounts||{}))for(const c of Object.values(pool.claims||{})) {
    if(n(c.equity)||Object.values(c.quantities||{}).some(q=>n(q)))throw Error('VAULT_HAS_ACTIVE_INVESTMENTS');
  }
}

export async function assertVaultRetirable({provider,vaultAddress,cashTokenAddress,requirePaused=true,executionAccountAddresses=[],contract=(address,abi)=>new Contract(address,abi,provider)}) {
  const blockTag=await provider.getBlockNumber();
  const vault=contract(vaultAddress,['function paused() view returns(bool)','function accountCount() view returns(uint256)','function accounts(uint256) view returns(address)']);
  const token=contract(cashTokenAddress,['function balanceOf(address) view returns(uint256)']);
  if(requirePaused&&!await vault.paused({blockTag}))throw Error('OLD_VAULT_MUST_BE_PAUSED');
  if(await token.balanceOf(vaultAddress,{blockTag})!==0n)throw Error('OLD_VAULT_HAS_FUNDS');
  const exchange=contract('0x1964C32f0bE608E7D29302AFF5E61268E72080cc',[
    'function getAccountByAddr(address) view returns(tuple(uint256 accountId,uint256 balanceCNS,uint256 lockedBalanceCNS,uint8 frozen,address accountAddr,tuple(uint256 bank1,uint256 bank2,uint256 bank3,uint256 bank4) positions))',
    'function getOrderLocks(uint256) view returns(tuple(uint32 orderLockId,uint32 nextOrderLockId,uint32 prevOrderLockId,uint8 orderType,uint40 lotLNS,uint80 amountCNS)[])',
  ]);
  const count=Number(await vault.accountCount({blockTag}));
  const addresses=new Set(executionAccountAddresses);
  for(let i=0;i<count;i++)addresses.add(await vault.accounts(i,{blockTag}));
  for(const address of addresses) {
    if(await token.balanceOf(address,{blockTag})!==0n)throw Error('OLD_EXECUTION_ACCOUNT_HAS_FUNDS');
    const slot=contract(address,['function accountId() view returns(uint256)']);
    if(!await slot.accountId({blockTag}))continue;
    const a=await exchange.getAccountByAddr(address,{blockTag});
    if(a.balanceCNS||a.lockedBalanceCNS||Object.values({bank1:a.positions.bank1,bank2:a.positions.bank2,bank3:a.positions.bank3,bank4:a.positions.bank4}).some(v=>n(v)))throw Error('OLD_EXECUTION_ACCOUNT_HAS_FUNDS');
    if(a.accountId&&(await exchange.getOrderLocks(a.accountId,{blockTag})).length)throw Error('OLD_EXECUTION_ACCOUNT_HAS_ORDERS');
  }
  return {ready:true,blockNumber:blockTag,executionAccountsChecked:addresses.size};
}
