import React,{useEffect,useState,useRef} from 'react';
import { Catalog,StrategyDetail,Portfolio,Activity,Provider,Verification } from './StrategyPages.jsx';
import { BrowserProvider,Contract } from 'ethers';
import { canonicalJson } from '../shared/protocol.js';
const value=v=>Number(v||0)/1e6;
const cash=v=>v==null?'—':value(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const short=x=>x?x.slice(0,8)+'…'+x.slice(-6):'—';
export function useExecutionSession(){
  const [investor,setInvestor]=useState('a'),[state,setState]=useState(null),[selected,setSelected]=useState('btc-trend'),[amount,setAmount]=useState('10000'),[orderAmount,setOrderAmount]=useState('2500'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[evidence,setEvidence]=useState(null),[walletSigner,setWalletSigner]=useState(null),[newName,setNewName]=useState(''),[newDescription,setNewDescription]=useState('');
  async function request(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
  async function signed(signer,type,strategyId,data={}){const network=await signer.provider.getNetwork();if(Number(network.chainId)!==10143)throw new Error("Connect your wallet to Monad Testnet (10143).");const bytes=crypto.getRandomValues(new Uint8Array(32));const nonce='0x'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');const payload={domain:'CONFIDENTIAL_ALPHA_V02',chainId:10143,vault:state.vault.address,signer:await signer.getAddress(),type,strategyId,data,nonce,expiresAt:Math.floor(Date.now()/1000)+300};return {payload,signature:await signer.signMessage(canonicalJson(payload))};}
  async function load(){if(walletSigner)setState(await request('/api/sleeves/execution/view',await signed(walletSigner,'VIEW','')));else {const s=await request('/api/sleeves/execution');setState(s.mode==='LOCAL_EVM'?await request('/api/sleeves/execution/local-fixture',{investor,action:'view'}):s);}}
  async function connect(){setError('');try{if(!window.ethereum)throw new Error("An EVM wallet extension is required for this archived flow.");const provider=new BrowserProvider(window.ethereum);await provider.send('eth_requestAccounts',[]);const signer=await provider.getSigner();const e=await signed(signer,'VIEW','');setState(await request('/api/sleeves/execution/view',e));setWalletSigner(signer);}catch(e){setError(e.message);}}
  async function finishDeposit(pending){
    const signer=walletSigner;if(!signer||await signer.getAddress()!==pending.envelope.payload.signer)throw new Error("Connect the wallet that started the deposit.");
    const key='omnibus-pending-'+state.vault.address;
    if(!pending.transactionHash){
      const token=new Contract(pending.prepared.cash,['function approve(address,uint256) returns(bool)'],signer);await (await token.approve(state.vault.address,pending.prepared.amount)).wait();
      const vault=new Contract(state.vault.address,['function deposit(uint256,bytes32)'],signer);
      const tx=await vault.deposit(pending.prepared.amount,pending.prepared.id);pending.transactionHash=tx.hash;localStorage.setItem(key,JSON.stringify(pending));await tx.wait();
    }
    const result=await request('/api/sleeves/execution/complete',{envelope:pending.envelope,transactionHash:pending.transactionHash});localStorage.removeItem(key);return result;
  }
  async function resumeDeposit(){setBusy(true);setError('');try{const pending=JSON.parse(localStorage.getItem('omnibus-pending-'+state.vault.address));if(!pending)throw new Error("No deposit request is stored in this browser.");await finishDeposit(pending);await load();setNotice("Deposit verified and strategy units updated.");}catch(e){setError(e.message);}finally{setBusy(false);}}

  useEffect(()=>{let cancelled=false;setState(null);setError('');request('/api/sleeves/execution').then(async s=>s.mode==='LOCAL_EVM'?request('/api/sleeves/execution/local-fixture',{investor,action:'view'}):s).then(s=>{if(!cancelled)setState(s);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[investor]);
  useEffect(()=>{request('/api/sleeves/evidence').then(setEvidence).catch(()=>{});},[]);
  async function act(action,body={}){setBusy(true);setError('');setNotice('');try{let result;if(state.mode==='LOCAL_EVM')result=await request('/api/sleeves/execution/local-fixture',{investor,action,...body});else{
      if(!walletSigner)throw new Error("Connect your wallet first.");
      const {strategyId,...data}=body,envelope=await signed(walletSigner,action,strategyId,data);
      if(action==='ALLOCATE'){const prepared=await request('/api/sleeves/execution/prepare',envelope),pending={envelope,prepared};localStorage.setItem('omnibus-pending-'+state.vault.address,JSON.stringify(pending));setState(previous=>({...previous,pending:true}));result=await finishDeposit(pending);}
      else result=await request('/api/sleeves/execution/submit',envelope);
    }await load();setNotice(result.registered?"Provider signature verified and independent strategy registered.":"EVM transaction confirmed · "+result.transactionHash+" · Token balances match the ledger");}catch(e){setError(e.message);}finally{setBusy(false);}}
  return {investor,setInvestor,state,selected,setSelected,amount,setAmount,orderAmount,setOrderAmount,busy,error,setError,notice,setNotice,evidence,walletSigner,newName,setNewName,newDescription,setNewDescription,load,connect,resumeDeposit,act};
}
export default function Strategies({path,navigate}){
  const {investor,setInvestor,state,selected,setSelected,amount,setAmount,orderAmount,setOrderAmount,busy,error,setError,notice,setNotice,evidence,walletSigner,newName,setNewName,newDescription,setNewDescription,load,connect,resumeDeposit,act}=useExecutionSession();
  const section=path.startsWith('/strategies/')?'detail':({'/strategies':'catalog','/portfolio':'portfolio','/activity':'activity','/provider':'provider','/verification':'verification'}[path]||'catalog');
  let strategyId;try{strategyId=decodeURIComponent(path.split('/')[2]||'');}catch{strategyId='';}
  const strategy=state?.catalog.find(s=>s.id===strategyId);
  const heading=useRef(null);
  useEffect(()=>{setError('');setNotice('');heading.current?.focus();window.scrollTo(0,0);},[path]);
  const title={catalog:"Explore",detail:strategy?.name||"Strategy details",portfolio:"My investments",activity:"Deposit and withdrawal history",provider:"Provider operations",verification:"Operational verification"}[section];
  const subtitle={catalog:"Find, compare and choose a strategy.",detail:"Review this strategy's conditions and allocate capital.",portfolio:"Manage your selected strategy units and redemptions.",activity:"Allocation and redemption history for your wallet.",provider:"Manage orders, settlement and fees for your strategies.",verification:"Check execution, asset reconciliation and testnet transactions."}[section];
  const navigation=[['/strategies',"Explore"],['/portfolio',"My investments"],['/provider',"Provider operations"],['/verification',"Operational verification"]];
  return <div className="service-shell">
    <aside className="service-sidebar"><a className="service-brand" href="#/strategies">alpha<span>Confidential Alpha Protocol</span></a><nav aria-label="Main navigation">{navigation.map(([href,label])=><a key={href} href={'#'+href} aria-current={(href==='/strategies'?['catalog','detail'].includes(section):href==='/portfolio'?['portfolio','activity'].includes(section):path===href)?'page':undefined}>{label}</a>)}</nav><div className="service-sidebar-foot">Many strategies.<br/>One shared vault.</div></aside>
    <div className="service-main"><header className="service-topbar"><span className="environment-chip">{state?.mode==='MONAD_TESTNET'?"Monad Testnet":"Local test"}  · No TEE in this archived prototype</span>
      {state?.mode==='MONAD_TESTNET'?<div className="account-controls"><button className="secondary" disabled={busy} onClick={connect}>{state.investor?short(state.investor):"Connect wallet"}</button><span>{cash(state.wallet)} tUSD</span></div>:<div className="account-controls"><label htmlFor="review-investor">Test account</label><select id="review-investor" value={investor} disabled={busy||!state} onChange={e=>setInvestor(e.target.value)}><option value="a">Investor A</option><option value="b">Investor B</option></select><span>{cash(state?.wallet)} tUSD</span></div>}
    </header>
    <main className="service-content"><div className="service-page-heading"><div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{subtitle}</p></div>{section==='portfolio'&&<button className="secondary" disabled={busy||!state} onClick={()=>load().catch(e=>setError(e.message))}>Refresh balance</button>}</div>
      {error&&<div role="alert" className="alert error">{error}</div>}{notice&&<div role="status" className="alert service-notice"><span>{notice.includes("EVM transaction confirmed")?"Transaction confirmed and balances updated.":notice}</span><button className="text-button" onClick={()=>setNotice('')} aria-label="Dismiss notification">Close</button></div>}
      {state?.pending&&<div className="alert"><span>An unfinished request exists.</span><button className="secondary" disabled={busy||!walletSigner} onClick={resumeDeposit}>Continue deposit</button></div>}
      {!state?<p role="status">Loading execution environment…</p>:<div className="service-page">
        {section==='catalog'&&<Catalog state={state} navigate={navigate}/>}
        {section==='detail'&&<StrategyDetail {...{strategy,state,amount,setAmount,busy,act,navigate}}/>}
        {section==='portfolio'&&<Portfolio {...{state,busy,act,navigate}}/>}
        {section==='activity'&&<Activity state={state}/>}
        {section==='provider'&&<Provider {...{state,selected,setSelected,orderAmount,setOrderAmount,busy,act,walletSigner,newName,setNewName,newDescription,setNewDescription}}/>}
        {section==='verification'&&<Verification {...{state,evidence}}/>}
      </div>}
    </main></div>
  </div>;
}
