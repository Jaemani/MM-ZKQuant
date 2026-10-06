import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {BrowserProvider,Contract,hexlify,parseUnits,randomBytes} from 'ethers';
import {createAttestedTeeChannel} from './attestedTee.js';
import {platformError} from './platformErrors.js';
import {fetchPlatformJson} from './platformRequest.js';
const Context=createContext(null),SESSION='mmq.session.v2',PENDING='mmq.pending-deposit.v2';
const apiBase=import.meta.env.VITE_PLATFORM_API_BASE?.replace(/\/$/,'')||'/api';
const load=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
const requestId=()=>hexlify(randomBytes(32));
export function PlatformProvider({children}) {
  const [session,setSession]=useState(null),[config,setConfig]=useState(null),[strategies,setStrategies]=useState([]),[owned,setOwned]=useState([]),[portfolio,setPortfolio]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(null),[catalogError,setCatalogError]=useState(''),[loading,setLoading]=useState(true),[pending,setPending]=useState(null),[stage,setStage]=useState(''),[balance,setBalance]=useState(null),[authOpen,setAuthOpen]=useState(false),[outbox,setOutbox]=useState(null);
  const generation=useRef(0),lock=useRef(false),sessionRef=useRef(null),teeChannelRef=useRef(null),configRef=useRef(null);
  if(!teeChannelRef.current)teeChannelRef.current=createAttestedTeeChannel({loadAttestation:()=>fetchPlatformJson(`${apiBase}/v1/tee-attestation`,{headers:{Authorization:`Bearer ${sessionRef.current?.sessionToken||''}`}},{timeoutMs:26000})});
  const request=async(path,{body,token,...options}={})=>{
    try{return await fetchPlatformJson(`${apiBase}${path}`,{...options,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch(error){if(error.status===401&&token===sessionRef.current?.sessionToken&&path!=='/v1/auth/login')logout();throw error;}
  };
  function logout(){
    const token=sessionRef.current?.sessionToken;
    if(token)request('/v1/auth/logout',{token,body:{}}).catch(()=>{});
    generation.current++;sessionRef.current=null;teeChannelRef.current.clear();setSession(null);setOwned([]);setPortfolio(null);setBalance(null);setPending(null);setOutbox(null);
    localStorage.removeItem(SESSION);localStorage.removeItem('mmq.investor.session.v1');sessionStorage.removeItem('mmq.manager');setMessage(null);
  }
  const notify=(text,error=false)=>setMessage({text,error});
  async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setMessage(null);try{return await fn();}catch(e){notify(platformError(e),true);return null;}finally{lock.current=false;setBusy(false);setStage('');}}
  async function refreshCatalog(){try{const [c,s]=await Promise.all([request('/v1/config'),request('/v1/strategies')]);configRef.current=c;setConfig(c);setStrategies(s.strategies);setCatalogError('');}catch(e){setCatalogError(platformError(e));}finally{setLoading(false);}}
  async function refreshAccount(current=sessionRef.current){
    if(!current)return;const stamp=generation.current;
    const [me,my]=await Promise.all([request('/v1/me',{token:current.sessionToken}),request('/v1/me/strategies',{token:current.sessionToken})]);
    if(stamp!==generation.current)return;const next={...current,...me};sessionRef.current=next;setSession(next);setOwned(my.strategies);localStorage.setItem(SESSION,JSON.stringify(next));
    const candidate=load(`${PENDING}:${next.userId}`)||load(PENDING)||load('mmq.investor.pending-deposit.v1');
    if(candidate&&(candidate.userId===next.userId||(!candidate.userId&&next.wallet&&candidate.wallet?.toLowerCase()===next.wallet.toLowerCase())))setPending(candidate);
    else setPending(null);
    setOutbox(load(`mmq.request:${next.userId}`));
    return next;
  }
  async function signer(){
    if(!window.ethereum)throw Error('Open a wallet browser or install a wallet extension to add funds.');
    await window.ethereum.request({method:'eth_requestAccounts'});let provider=new BrowserProvider(window.ethereum);
    if((await provider.getNetwork()).chainId!==10143n){await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x279f'}]});provider=new BrowserProvider(window.ethereum);}
    const s=await provider.getSigner(),linked=sessionRef.current?.wallet;
    if(linked&&(await s.getAddress()).toLowerCase()!==linked.toLowerCase())throw Error('Use the funding wallet linked to this account. Your account is still signed in.');
    return s;
  }
  async function privateRequest(action,values={},retry=false){
    const current=sessionRef.current;if(!current)throw Error('Sign in to continue.');
    const tracked=['ALLOCATE','REDEEM','RETURN_PENDING','CANCEL_REDEMPTION','WITHDRAW_CASH','CANCEL_CASH_WITHDRAWAL'].includes(action),key=`mmq.request:${current.userId}`;
    if(tracked&&!retry&&load(key))throw Error('REQUEST_CONFIRMATION_PENDING');
    const payload={action,requestId:requestId(),...values};
    if(tracked){localStorage.setItem(key,JSON.stringify(payload));setOutbox(payload);}
    try{
      const result=await teeChannelRef.current.send(configRef.current,'/platform/encrypted-investments',{...payload,sessionToken:current.sessionToken},{relayBase:`${apiBase}/tee`});
      if(current.sessionToken!==sessionRef.current?.sessionToken)throw Error('The account changed. Refresh your account before continuing.');
      if(tracked){localStorage.removeItem(key);setOutbox(null);}return result;
    }catch(error){
      // Transport ambiguity retains the exact request. Explicit TEE rejections are safe to correct.
      if(tracked&&(error.teeRejected||/TEE_ATTESTATION_FAILED|TEE_ATTESTATION_UNAVAILABLE/.test(error.message))){localStorage.removeItem(key);if(current.sessionToken===sessionRef.current?.sessionToken)setOutbox(null);}
      throw error;
    }
  }
  async function retryPendingRequest(){return run(async()=>{const payload=load(`mmq.request:${sessionRef.current?.userId}`);if(!payload)return true;await privateRequest(payload.action,payload,true);await fetchPortfolio();notify('Request confirmed. Your assets are up to date.');return true;});}
  async function fetchPortfolio(){const stamp=generation.current,result=await privateRequest('PORTFOLIO');if(stamp===generation.current){setPortfolio({...result,queriedAt:Date.now()});const key=`mmq.request:${sessionRef.current?.userId}`,pendingRequest=load(key);if(pendingRequest&&result.completedRequestIds?.includes(pendingRequest.requestId)){localStorage.removeItem(key);setOutbox(null);}}return result;}
  async function readBalance(s){if(!configRef.current?.cashTokenAddress)return;const stamp=generation.current;const value=await new Contract(configRef.current.cashTokenAddress,['function balanceOf(address) view returns(uint256)'],s).balanceOf(await s.getAddress());if(stamp===generation.current)setBalance(String(value));}
  function login(){setAuthOpen(true);}
  async function authenticate(credentials,signup=false){return run(async()=>{
    const next=await request(signup?'/v1/auth/register':'/v1/auth/login',{body:credentials});
    generation.current++;teeChannelRef.current.clear();setPortfolio(null);sessionRef.current=next;localStorage.setItem(SESSION,JSON.stringify(next));await refreshAccount(next);setAuthOpen(false);notify(signup?'Your account is ready.':'Signed in.');try{await fetchPortfolio();}catch(e){notify(platformError(e),true);}return true;
  });}
  async function walletLogin(){return run(async()=>{
    const s=await signer(),wallet=await s.getAddress(),c=await request('/v1/auth/challenge',{body:{address:wallet}}),signature=await s.signMessage(c.message);
    const next=await request('/v1/auth/verify',{body:{address:wallet,nonce:c.nonce,signature}});generation.current++;teeChannelRef.current.clear();setPortfolio(null);sessionRef.current=next;await refreshAccount(next);setAuthOpen(false);notify('Set a username and password in your account settings.');try{await fetchPortfolio();}catch(e){notify(platformError(e),true);}return true;
  });}
  async function setCredentials(credentials){return run(async()=>{await request('/v1/auth/credentials',{token:sessionRef.current.sessionToken,body:credentials});await refreshAccount();notify('You can now sign in with your username and password.');return true;});}
  async function reloadPortfolio(){return run(async()=>{await fetchPortfolio();notify('Your assets are up to date.');return true;});}
  async function refreshBalance(){return run(async()=>readBalance(await signer()));}
  function persist(candidate){setPending(candidate);const id=sessionRef.current?.userId;if(candidate)localStorage.setItem(`${PENDING}:${id}`,JSON.stringify({...candidate,userId:id}));else localStorage.removeItem(`${PENDING}:${id}`);localStorage.removeItem(PENDING);localStorage.removeItem('mmq.investor.pending-deposit.v1');}
  async function complete(candidate){
    await privateRequest(candidate.strategyId?'COMPLETE':'COMPLETE_TOPUP',{depositId:candidate.depositId,txHash:candidate.txHash,requestId:candidate.completeRequestId||requestId()});persist(null);await refreshAccount();
    notify(candidate.strategyId?'Deposit confirmed. Allocation starts with the next target submission.':'Funds added to your platform balance.');
    try{await fetchPortfolio();}catch(e){notify(`Funds are confirmed. Refresh your assets to see the balance. ${platformError(e)}`,true);}return true;
  }
  async function addFunds(amountText){return run(async()=>{
    if(pending?.txHash)throw Error('Finish confirming your previous deposit first.');
    if(!sessionRef.current)throw Error('Sign in to add funds.');
    const current=sessionRef.current,s=await signer(),wallet=await s.getAddress(),amount=parseUnits(amountText,6);
    if(amount<=0n)throw Error('Enter an amount greater than zero.');
    const token=new Contract(configRef.current.cashTokenAddress,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256)'],s);
    if(await token.balanceOf(wallet)<amount)throw Error('Your wallet has insufficient AUSD.');
    setStage('Preparing your deposit');const prepared=await privateRequest('PREPARE_TOPUP',{wallet,amount:String(amount)});
    let candidate={...prepared,userId:current.userId,wallet,strategyId:null,txHash:null,completeRequestId:requestId()};persist(candidate);
    if(await token.allowance(wallet,prepared.vaultAddress)<amount){setStage('Approve AUSD in your wallet');await(await token.approve(prepared.vaultAddress,amount)).wait();}
    if(sessionRef.current?.sessionToken!==current.sessionToken)throw Error('The account changed. Sign back in to complete your deposit.');
    if((await s.getAddress()).toLowerCase()!==wallet.toLowerCase())throw Error('Your funding wallet changed.');
    setStage('Confirm the deposit in your wallet');const tx=await new Contract(prepared.vaultAddress,['function deposit(uint256 amount,bytes32 id)'],s).deposit(amount,prepared.depositId);candidate={...candidate,txHash:tx.hash};persist(candidate);setStage('Waiting for deposit confirmation');await tx.wait();setStage('Updating your platform balance');return complete(candidate);
  });}
  async function resumeDeposit(){return run(async()=>{if(!pending?.txHash)throw Error('There is no deposit to confirm.');setStage('Checking the deposit receipt');return complete(pending);});}
  async function allocate(strategy,amountText){return run(async()=>{const amount=parseUnits(amountText,6);if(amount<=0n)throw Error('Enter an amount greater than zero.');await privateRequest('ALLOCATE',{strategyId:strategy.id,amount:String(amount)});await fetchPortfolio();notify('Allocated. Your funds wait for the next target submission.');return true;});}
  async function withdraw(position,percentage,isPending){return run(async()=>{
    if(!Number.isInteger(percentage)||percentage<1||percentage>100)throw Error('Enter a percentage from 1 to 100.');
    const amount=isPending?position.pending:String(BigInt(position.units)*BigInt(percentage)/100n);
    await privateRequest(isPending?'RETURN_PENDING':'REDEEM',{strategyId:position.strategyId,...(isPending?{amount}:{percentage})});await fetchPortfolio();notify('Redemption requested. Proceeds return to your platform balance at settlement.');return true;
  });}
  async function cancelWithdrawal(position,w){return run(async()=>{await privateRequest('CANCEL_REDEMPTION',{strategyId:position.strategyId,depositId:w.id});await fetchPortfolio();notify('Redemption cancelled.');return true;});}
  async function withdrawCash(amountText){return run(async()=>{const amount=parseUnits(amountText,6);if(amount<=0n)throw Error('Enter an amount greater than zero.');await privateRequest('WITHDRAW_CASH',{amount:String(amount)});await fetchPortfolio();notify('Withdrawal requested. Track confirmation below.');return true;});}
  async function cancelCashWithdrawal(w){return run(async()=>{await privateRequest('CANCEL_CASH_WITHDRAWAL',{depositId:w.id});await fetchPortfolio();notify('Withdrawal cancelled.');return true;});}
  async function managerRequest(strategyId,action,values={}){
    if(!sessionRef.current)throw Error('Sign in to continue.');return teeChannelRef.current.send(configRef.current,'/platform/encrypted-strategy',{sessionToken:sessionRef.current.sessionToken,strategyId,action,...values},{relayBase:`${apiBase}/tee`});
  }
  useEffect(()=>{refreshCatalog();const timer=setInterval(refreshCatalog,30000),current=load(SESSION)||load('mmq.investor.session.v1');if(current?.sessionToken){sessionRef.current=current;refreshAccount(current).catch(error=>{if(sessionRef.current?.sessionToken!==current.sessionToken)return;setSession(current);notify(`Retry loading your account. ${platformError(error)}`,true);});}return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!session?.sessionToken||!config?.teeEndpoint)return;
    let cancelled=false;const update=()=>{if(!cancelled&&sessionRef.current?.sessionToken===session.sessionToken&&!lock.current)fetchPortfolio().catch(e=>{if(!cancelled)notify(platformError(e),true);});};
    update();const timer=setInterval(()=>{if(document.visibilityState==='visible')update();},30000);return()=>{cancelled=true;clearInterval(timer);};
  },[session?.sessionToken,config?.teeEndpoint]);
  useEffect(()=>{const wallet=window.ethereum;if(!wallet?.on)return;const change=()=>setBalance(null);wallet.on('accountsChanged',change);wallet.on('chainChanged',change);return()=>{wallet.removeListener?.('accountsChanged',change);wallet.removeListener?.('chainChanged',change);};},[]);
  return <Context.Provider value={{session,config,strategies,owned,portfolio,busy,message,catalogError,loading,pending,balance,stage,authOpen,setAuthOpen,outbox,retryPendingRequest,request,run,notify,login,authenticate,walletLogin,setCredentials,logout,refreshCatalog,refreshAccount,reloadPortfolio,refreshBalance,addFunds,allocate,deposit:allocate,resumeDeposit,withdraw,cancelWithdrawal,withdrawCash,cancelCashWithdrawal,managerRequest}}>{children}</Context.Provider>;
}
export const usePlatform=()=>useContext(Context);
