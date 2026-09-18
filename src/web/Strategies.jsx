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
  async function signed(signer,type,strategyId,data={}){const network=await signer.provider.getNetwork();if(Number(network.chainId)!==10143)throw new Error('지갑을 Monad 테스트넷(10143)으로 연결하세요.');const bytes=crypto.getRandomValues(new Uint8Array(32));const nonce='0x'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');const payload={domain:'CONFIDENTIAL_ALPHA_V02',chainId:10143,vault:state.vault.address,signer:await signer.getAddress(),type,strategyId,data,nonce,expiresAt:Math.floor(Date.now()/1000)+300};return {payload,signature:await signer.signMessage(canonicalJson(payload))};}
  async function load(){if(walletSigner)setState(await request('/api/sleeves/execution/view',await signed(walletSigner,'VIEW','')));else {const s=await request('/api/sleeves/execution');setState(s.mode==='LOCAL_EVM'?await request('/api/sleeves/execution/local-fixture',{investor,action:'view'}):s);}}
  async function connect(){setError('');try{if(!window.ethereum)throw new Error('브라우저의 EVM 지갑 확장 프로그램이 필요합니다.');const provider=new BrowserProvider(window.ethereum);await provider.send('eth_requestAccounts',[]);const signer=await provider.getSigner();const e=await signed(signer,'VIEW','');setState(await request('/api/sleeves/execution/view',e));setWalletSigner(signer);}catch(e){setError(e.message);}}
  async function finishDeposit(pending){
    const signer=walletSigner;if(!signer||await signer.getAddress()!==pending.envelope.payload.signer)throw new Error('예치를 시작한 지갑으로 연결하세요.');
    const key='omnibus-pending-'+state.vault.address;
    if(!pending.transactionHash){
      const token=new Contract(pending.prepared.cash,['function approve(address,uint256) returns(bool)'],signer);await (await token.approve(state.vault.address,pending.prepared.amount)).wait();
      const vault=new Contract(state.vault.address,['function deposit(uint256,bytes32)'],signer);
      const tx=await vault.deposit(pending.prepared.amount,pending.prepared.id);pending.transactionHash=tx.hash;localStorage.setItem(key,JSON.stringify(pending));await tx.wait();
    }
    const result=await request('/api/sleeves/execution/complete',{envelope:pending.envelope,transactionHash:pending.transactionHash});localStorage.removeItem(key);return result;
  }
  async function resumeDeposit(){setBusy(true);setError('');try{const pending=JSON.parse(localStorage.getItem('omnibus-pending-'+state.vault.address));if(!pending)throw new Error('이 브라우저에 보관된 예치 요청이 없습니다.');await finishDeposit(pending);await load();setNotice('기존 예치 거래를 확인하고 전략 지분을 반영했습니다.');}catch(e){setError(e.message);}finally{setBusy(false);}}

  useEffect(()=>{let cancelled=false;setState(null);setError('');request('/api/sleeves/execution').then(async s=>s.mode==='LOCAL_EVM'?request('/api/sleeves/execution/local-fixture',{investor,action:'view'}):s).then(s=>{if(!cancelled)setState(s);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[investor]);
  useEffect(()=>{request('/api/sleeves/evidence').then(setEvidence).catch(()=>{});},[]);
  async function act(action,body={}){setBusy(true);setError('');setNotice('');try{let result;if(state.mode==='LOCAL_EVM')result=await request('/api/sleeves/execution/local-fixture',{investor,action,...body});else{
      if(!walletSigner)throw new Error('먼저 본인 지갑을 연결하세요.');
      const {strategyId,...data}=body,envelope=await signed(walletSigner,action,strategyId,data);
      if(action==='ALLOCATE'){const prepared=await request('/api/sleeves/execution/prepare',envelope),pending={envelope,prepared};localStorage.setItem('omnibus-pending-'+state.vault.address,JSON.stringify(pending));setState(previous=>({...previous,pending:true}));result=await finishDeposit(pending);}
      else result=await request('/api/sleeves/execution/submit',envelope);
    }await load();setNotice(result.registered?'제공자 서명을 확인하고 독립 전략을 등록했습니다.':'EVM 거래 확인 · '+result.transactionHash+' · 실제 토큰 잔액과 장부 일치');}catch(e){setError(e.message);}finally{setBusy(false);}}
  return {investor,setInvestor,state,selected,setSelected,amount,setAmount,orderAmount,setOrderAmount,busy,error,setError,notice,setNotice,evidence,walletSigner,newName,setNewName,newDescription,setNewDescription,load,connect,resumeDeposit,act};
}
export default function Strategies({path,navigate}){
  const {investor,setInvestor,state,selected,setSelected,amount,setAmount,orderAmount,setOrderAmount,busy,error,setError,notice,setNotice,evidence,walletSigner,newName,setNewName,newDescription,setNewDescription,load,connect,resumeDeposit,act}=useExecutionSession();
  const section=path.startsWith('/strategies/')?'detail':({'/strategies':'catalog','/portfolio':'portfolio','/activity':'activity','/provider':'provider','/verification':'verification'}[path]||'catalog');
  let strategyId;try{strategyId=decodeURIComponent(path.split('/')[2]||'');}catch{strategyId='';}
  const strategy=state?.catalog.find(s=>s.id===strategyId);
  const heading=useRef(null);
  useEffect(()=>{setError('');setNotice('');heading.current?.focus();window.scrollTo(0,0);},[path]);
  const title={catalog:'전략 탐색',detail:strategy?.name||'전략 상세',portfolio:'내 투자',activity:'입출금 내역',provider:'제공자 운용',verification:'운영 검증'}[section];
  const subtitle={catalog:'원하는 전략을 찾아 비교하고 선택하세요.',detail:'이 전략의 조건을 확인하고 자본을 배정하세요.',portfolio:'선택한 전략의 지분과 환매를 관리합니다.',activity:'내 지갑의 배정과 환매 기록입니다.',provider:'내 전략의 주문, 정산, 보수를 관리합니다.',verification:'실행 환경과 자산 대사, 테스트넷 거래를 확인합니다.'}[section];
  const navigation=[['/strategies','전략 탐색'],['/portfolio','내 투자'],['/provider','제공자 운용'],['/verification','운영 검증']];
  return <div className="service-shell">
    <aside className="service-sidebar"><a className="service-brand" href="#/strategies">alpha<span>Confidential Alpha Protocol</span></a><nav aria-label="주 메뉴">{navigation.map(([href,label])=><a key={href} href={'#'+href} aria-current={(href==='/strategies'?['catalog','detail'].includes(section):href==='/portfolio'?['portfolio','activity'].includes(section):path===href)?'page':undefined}>{label}</a>)}</nav><div className="service-sidebar-foot">Many strategies.<br/>One shared vault.</div></aside>
    <div className="service-main"><header className="service-topbar"><span className="environment-chip">{state?.mode==='MONAD_TESTNET'?'Monad 테스트넷':'로컬 테스트'} · TEE 미적용</span>
      {state?.mode==='MONAD_TESTNET'?<div className="account-controls"><button className="secondary" disabled={busy} onClick={connect}>{state.investor?short(state.investor):'지갑 연결'}</button><span>{cash(state.wallet)} tUSD</span></div>:<div className="account-controls"><label htmlFor="review-investor">테스트 계정</label><select id="review-investor" value={investor} disabled={busy||!state} onChange={e=>setInvestor(e.target.value)}><option value="a">투자자 A</option><option value="b">투자자 B</option></select><span>{cash(state?.wallet)} tUSD</span></div>}
    </header>
    <main className="service-content"><div className="service-page-heading"><div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{subtitle}</p></div>{section==='portfolio'&&<button className="secondary" disabled={busy||!state} onClick={()=>load().catch(e=>setError(e.message))}>잔액 새로고침</button>}</div>
      {error&&<div role="alert" className="alert error">{error}</div>}{notice&&<div role="status" className="alert service-notice"><span>{notice.includes('EVM 거래 확인')?'거래가 확인되었습니다. 잔액에 반영했습니다.':notice}</span><button className="text-button" onClick={()=>setNotice('')} aria-label="알림 닫기">닫기</button></div>}
      {state?.pending&&<div className="alert"><span>완료하지 않은 요청이 있습니다.</span><button className="secondary" disabled={busy||!walletSigner} onClick={resumeDeposit}>예치 계속</button></div>}
      {!state?<p role="status">실행 환경을 불러오는 중입니다…</p>:<div className="service-page">
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
