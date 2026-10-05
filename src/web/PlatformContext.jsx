import React, {createContext,useContext,useEffect,useRef,useState} from 'react';
import {BrowserProvider,Contract,hexlify,parseUnits,randomBytes} from 'ethers';
import {investmentMessage} from '../platform/investment-message.js';
import {encryptedTeeRequest} from './teeChannel.js';
import {platformError} from './platformErrors.js';

const Context=createContext(null);
const SESSION='mmq.session.v2',PENDING='mmq.pending-deposit.v2';
const apiBase=import.meta.env.VITE_PLATFORM_API_BASE?.replace(/\/$/,'')||'/api';
const load=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
export function PlatformProvider({children}) {
 const [session,setSession]=useState(null),[config,setConfig]=useState(null),[strategies,setStrategies]=useState([]),[owned,setOwned]=useState([]),[portfolio,setPortfolio]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(null),[catalogError,setCatalogError]=useState(''),[loading,setLoading]=useState(true),[pending,setPending]=useState(()=>load(PENDING)),[stage,setStage]=useState(''),[balance,setBalance]=useState(null);
 const generation=useRef(0),lock=useRef(false),sessionRef=useRef(null);
 const request=async(path,{body,token,...options}={})=>{const r=await fetch(`${apiBase}${path}`,{...options,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok){if(r.status===401&&token===sessionRef.current?.sessionToken)logout();throw Error(j.error||'플랫폼 연결을 확인해 주세요.');}return j;};
 function logout(){generation.current++;sessionRef.current=null;setSession(null);setOwned([]);setPortfolio(null);setBalance(null);localStorage.removeItem(SESSION);setMessage(null);}
 const notify=(text,error=false)=>setMessage({text,error});
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setMessage(null);try{return await fn();}catch(e){notify(platformError(e),true);return null;}finally{lock.current=false;setBusy(false);setStage('');}}
 async function refreshCatalog(){try{const [c,s]=await Promise.all([request('/v1/config'),request('/v1/strategies')]);setConfig(c);setStrategies(s.strategies);setCatalogError('');}catch(e){setCatalogError(platformError(e));}finally{setLoading(false);}}
 async function refreshAccount(current=sessionRef.current){if(!current)return;const stamp=generation.current;const [me,my]=await Promise.all([request('/v1/me',{token:current.sessionToken}),request('/v1/me/strategies',{token:current.sessionToken})]);if(stamp!==generation.current)return;const next={...current,...me};sessionRef.current=next;setSession(next);setOwned(my.strategies);localStorage.setItem(SESSION,JSON.stringify(next));}
 async function signer(){if(!window.ethereum)throw Error('지갑 확장 프로그램을 설치하거나 지갑 브라우저에서 열어 주세요.');await window.ethereum.request({method:'eth_requestAccounts'});let provider=new BrowserProvider(window.ethereum);if((await provider.getNetwork()).chainId!==10143n){await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x279f'}]});provider=new BrowserProvider(window.ethereum);}const s=await provider.getSigner();if(sessionRef.current&&(await s.getAddress()).toLowerCase()!==sessionRef.current.wallet.toLowerCase())throw Error('로그인한 지갑과 연결된 지갑이 다릅니다. 다시 로그인해 주세요.');return s;}
 async function privateRequest(s,action,values={}){if(!config?.teeEndpoint)throw Error('TEE 연결 정보를 불러오는 중입니다. 다시 시도해 주세요.');const wallet=await s.getAddress();if(wallet.toLowerCase()!==sessionRef.current?.wallet.toLowerCase())throw Error('지갑이 변경되었습니다. 다시 로그인해 주세요.');const payload={action,wallet,strategyId:null,amount:null,depositId:null,txHash:null,nonce:hexlify(randomBytes(32)),...values};const signature=await s.signMessage(investmentMessage(payload));if(wallet.toLowerCase()!==sessionRef.current?.wallet.toLowerCase())throw Error('지갑이 변경되었습니다. 다시 로그인해 주세요.');return encryptedTeeRequest(config.teeEndpoint,config.teeEncryptionPublicKey,'/platform/encrypted-investments',{...payload,signature});}
 async function fetchPortfolio(s){const stamp=generation.current;const result=await privateRequest(s,'PORTFOLIO');if(stamp===generation.current)setPortfolio({...result,queriedAt:Date.now()});return result;}
 async function readBalance(s){if(!config?.cashTokenAddress)return;const stamp=generation.current;const value=await new Contract(config.cashTokenAddress,['function balanceOf(address) view returns(uint256)'],s).balanceOf(await s.getAddress());if(stamp===generation.current)setBalance(value.toString());}
 async function login(){return run(async()=>{const s=await signer(),wallet=await s.getAddress(),stamp=generation.current;const c=await request('/v1/auth/challenge',{body:{address:wallet}});const signature=await s.signMessage(c.message);if(stamp!==generation.current)throw Error('지갑이 변경되었습니다. 다시 시도해 주세요.');const next=await request('/v1/auth/verify',{body:{address:wallet,nonce:c.nonce,signature}});sessionRef.current=next;setSession(next);localStorage.setItem(SESSION,JSON.stringify(next));await refreshAccount(next);notify('로그인되었습니다. 내 자산을 조회하려면 지갑 서명으로 확인해 주세요.');});}
 async function reloadPortfolio(){return run(async()=>{const s=await signer();await fetchPortfolio(s);await readBalance(s);notify('내 자산을 업데이트했습니다.');});}
 async function refreshBalance(){return run(async()=>readBalance(await signer()));}
 const persist=c=>{setPending(c);if(c)localStorage.setItem(PENDING,JSON.stringify(c));else localStorage.removeItem(PENDING);};
 async function complete(candidate,s){await privateRequest(s,'COMPLETE',{depositId:candidate.depositId,txHash:candidate.txHash});persist(null);notify('입금 완료 · 다음 목표 제출부터 운용됩니다.');try{await fetchPortfolio(s);await readBalance(s);}catch(e){notify(`입금은 완료되었습니다. 자산 조회는 다시 시도해 주세요. ${platformError(e)}`,true);}return true;}
 async function deposit(strategy,amountText){return run(async()=>{
   if(pending?.txHash)throw Error('확인 중인 입금이 있습니다. 기존 입금 확인을 먼저 완료해 주세요.');
   const s=await signer(),wallet=await s.getAddress(),amount=parseUnits(amountText,6);if(amount<=0n)throw Error('투자 금액은 0보다 커야 합니다.');
   const token=new Contract(config.cashTokenAddress,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256)'],s);if(await token.balanceOf(wallet)<amount)throw Error('AUSD 잔액이 부족합니다.');
   setStage('투자 요청 확인');const prepared=await privateRequest(s,'PREPARE',{strategyId:strategy.id,amount:amount.toString()});
   let candidate={...prepared,wallet,strategyName:strategy.name,strategyId:strategy.id,txHash:null};persist(candidate);
   if(await token.allowance(wallet,prepared.vaultAddress)<amount){setStage('지갑에서 AUSD 사용 승인');await(await token.approve(prepared.vaultAddress,amount)).wait();}
   if(sessionRef.current?.wallet.toLowerCase()!==wallet.toLowerCase())throw Error('지갑이 변경되었습니다.');
   setStage('지갑에서 입금 승인');const tx=await new Contract(prepared.vaultAddress,['function deposit(uint256 amount,bytes32 id)'],s).deposit(amount,prepared.depositId);
   candidate={...candidate,txHash:tx.hash};persist(candidate);setStage('입금 거래 확인 중');await tx.wait();setStage('투자 내역 반영 중');return complete(candidate,s);
 });}
 async function resumeDeposit(){return run(async()=>{if(!pending?.txHash)throw Error('확인할 입금 거래가 없습니다.');const s=await signer();if((await s.getAddress()).toLowerCase()!==pending.wallet.toLowerCase())throw Error('입금한 지갑으로 로그인해 주세요.');setStage('입금 내역 확인 중');return complete(pending,s);});}
 async function withdraw(position,percentage,isPending){return run(async()=>{if(!Number.isInteger(percentage)||percentage<1||percentage>100)throw Error('출금 비율은 1~100%로 입력하세요.');const s=await signer();const amount=isPending?position.pending:(BigInt(position.units)*BigInt(percentage)/100n).toString();await privateRequest(s,isPending?'WITHDRAW_PENDING':'WITHDRAW',{strategyId:position.strategyId,amount});await fetchPortfolio(s);notify('출금을 신청했습니다. 정산 일정은 아래에서 확인할 수 있습니다.');return true;});}
 async function cancelWithdrawal(position,w){return run(async()=>{const s=await signer();await privateRequest(s,'CANCEL_WITHDRAWAL',{strategyId:position.strategyId,depositId:w.id});await fetchPortfolio(s);notify('출금 신청을 취소했습니다.');});}
 async function managerRequest(strategyId,action,values={}){if(!sessionRef.current)throw Error('로그인해 주세요.');return encryptedTeeRequest(config?.teeEndpoint,config?.teeEncryptionPublicKey,'/platform/encrypted-strategy',{sessionToken:sessionRef.current.sessionToken,strategyId,action,...values});}
 useEffect(()=>{refreshCatalog();const timer=setInterval(refreshCatalog,30000);const current=load(SESSION)||load('mmq.investor.session.v1');if(current?.sessionToken){sessionRef.current=current;refreshAccount(current).catch(()=>logout());}return()=>clearInterval(timer);},[]);
 useEffect(()=>{const wallet=window.ethereum;if(!wallet?.on)return;const change=()=>{logout();notify('지갑 또는 네트워크가 변경되었습니다. 다시 로그인해 주세요.');};wallet.on('accountsChanged',change);wallet.on('chainChanged',change);return()=>{wallet.removeListener?.('accountsChanged',change);wallet.removeListener?.('chainChanged',change);};},[]);
 return <Context.Provider value={{session,config,strategies,owned,portfolio,busy,message,catalogError,loading,pending,balance,stage,request,run,notify,login,logout,refreshCatalog,refreshAccount,reloadPortfolio,refreshBalance,deposit,resumeDeposit,withdraw,cancelWithdrawal,managerRequest}}>{children}</Context.Provider>;
}
export const usePlatform=()=>useContext(Context);
