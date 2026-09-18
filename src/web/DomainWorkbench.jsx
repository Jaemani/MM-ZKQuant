import React,{useEffect,useRef,useState} from 'react';
import {useExecutionSession} from './Strategies.jsx';
import {cash,short,Provider,Verification} from './StrategyPages.jsx';
import {domains,flows} from './domainModel.js';
const domain=id=>domains.find(d=>d.id===id);
const href=(id,tab='contract')=>'#/domains/'+id+'/'+tab;
const DomainLink=({id,children})=><a href={href(id)}>{children||domain(id)?.name||id} ↗</a>;
const Empty=({children})=><p className="workbench-empty">{children}</p>;
function Data({value,label='원본 데이터'}){return <details className="domain-data"><summary>{label}</summary><pre>{JSON.stringify(value,null,2)}</pre></details>;}
function Fields({rows}){return <dl className="domain-fields">{rows.map(([name,description])=><div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl>;}
function Flow({flow}){return <ol className="flow-steps">{flow.steps.map(([id,text],i)=><li key={i}><span className="step-index">{i+1}</span><div><DomainLink id={id}/><p>{text}</p></div></li>)}</ol>;}

function Architecture({scenario='allocate'}){
  const flow=flows.find(f=>f.id===scenario)||flows.find(f=>f.id==='allocate');
  return <>
    <div className="workbench-note">설계 검토용 워크벤치입니다. 아래 도메인은 논리적 책임의 경계이며, 각각 별도 서비스로 배포되었다는 뜻은 아닙니다.</div>
    <section className="domain-panel"><h2>전체 연결 구조</h2><p className="domain-muted">경제적 권리는 전략별로 나누고, 실제 자산과 주문의 실행 주소는 하나로 공유합니다.</p>
      <div className="architecture-lanes">
        <div><span className="lane-label">판단·권한</span><DomainLink id="provider"/><span>서명된 요청 →</span><DomainLink id="authorization"/><span>승인된 명령 →</span><DomainLink id="ledger"/></div>
        <div><span className="lane-label">자금·체결</span><DomainLink id="investor"/><span>실제 예치 →</span><DomainLink id="vault"/><span>동일 주소로 실행 ⇄</span><DomainLink id="market"/></div>
        <div><span className="lane-label">귀속·검증</span><DomainLink id="market"/><span>체결·부채 →</span><DomainLink id="settlement"/><span>전략별 권리 →</span><DomainLink id="ledger"/><span>조회·환매 →</span><DomainLink id="investor"/></div>
      </div>
      <div className="privacy-boundary"><DomainLink id="privacy"/> <span>목표: 민감 데이터와 귀속 관계를 TEE 안에서 처리 / 현재: 운영자 신뢰, TEE 미연결</span></div>
    </section>
    <section className="domain-panel"><div className="domain-panel-heading"><div><h2>흐름별로 따라가기</h2><p className="domain-muted">단계를 누르면 해당 도메인의 입력·출력·제약을 확인합니다.</p></div><label>시나리오<select value={flow.id} onChange={e=>{window.location.hash='/domains/overview/'+e.target.value;}}>{flows.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label></div><Flow flow={flow}/></section>
    <section className="domain-panel"><h2>도메인별 구현 상태</h2><div className="domain-status-grid">{domains.map(d=><a key={d.id} href={href(d.id)}><strong>{d.name}</strong><span>{d.implementation}</span><small>{d.gap}</small></a>)}</div></section>
  </>;
}
function Contract({item}){return <>
  <section className="domain-panel"><h2>이 도메인이 책임지는 것</h2><p>{item.owns}</p><div className="domain-io"><div><h3>들어오는 것</h3><p>{item.input}</p><div>{item.up.map(id=><DomainLink key={id} id={id}/>)}</div></div><div><h3>나가는 것</h3><p>{item.output}</p><div>{item.down.map(id=><DomainLink key={id} id={id}/>)}</div></div></div></section>
  <section className="domain-panel"><h2>데이터와 규칙</h2><Fields rows={item.fields}/><ul className="domain-rules">{item.rules.map(rule=><li key={rule}>{rule}</li>)}</ul></section>
  <section className="domain-panel"><h2>현재 코드와 설계 사이</h2><p><strong>{item.implementation}</strong></p><p className="implementation-gap">{item.gap}</p><code>{item.source}</code></section>
  <section className="domain-panel"><h2>이 도메인이 참여하는 흐름</h2>{flows.filter(f=>f.steps.some(([id])=>id===item.id)).map(f=><details className="domain-data" key={f.id}><summary>{f.name}</summary><Flow flow={f}/></details>)}</section>
</>;}
function StrategySelector({session}){return <label className="domain-strategy-select">검토할 전략<select value={session.selected} disabled={session.busy} onChange={e=>session.setSelected(e.target.value)}>{session.state?.catalog.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>;}
function LedgerState({snapshot,selected}){
  const s=snapshot.ledger.strategies.find(s=>s.id===selected),equity=snapshot.reconciliation.equities.find(e=>e.strategyId===selected);
  if(!s)return <Empty>전략을 선택하세요.</Empty>;
  return <><Fields rows={[["전략 / 제공자",s.id+' / '+short(s.provider)],['현금',cash(s.cash)+' tUSD'],['투자자 권리 합계',cash(String(BigInt(equity.equity)-BigInt(equity.providerAccrual)))+' tUSD'],['제공자 미지급 보수',cash(s.providerAccrual)+' tUSD'],['전략 자산가치',cash(equity.equity)+' tUSD']]}/><h3>투자자별 권리</h3><div className="table-scroll"><table className="pilot-table"><thead><tr><th>투자자</th><th>Units</th><th>현재 권리</th></tr></thead><tbody>{Object.entries(s.investors).map(([owner,units])=><tr key={owner}><td><code title={owner}>{short(owner)}</code></td><td>{cash(units)}</td><td>{cash(equity.investorClaims[owner]||'0')} tUSD</td></tr>)}</tbody></table></div><Data label="현물 포지션 · 차입 lot · 담보" value={{positions:s.positions,shorts:s.shorts}}/><Data label="이 전략에 귀속된 실제 주문" value={snapshot.ledger.orders.filter(o=>o.strategyId===selected)}/></>;
}
function StatePanel({item,session,snapshot,snapshotError}){
  const {state,selected,evidence}=session;
  if(item.id==='privacy')return <section className="domain-panel"><h2>보호 경계</h2><Fields rows={[["외부 공개",'Vault 주소, 실제 거래, opaque 주문 ID'],['목표 보호 대상','alpha, 전략 포지션, 투자자 권리, provider → order → fill 연결'],['현재 저장·계산','운영자 프로세스와 로컬 파일'],['TEE / attestation','미연결 — 환경 준비 전']]}/><p className="implementation-gap">이 화면의 상세 장부는 로컬 테스트 키로 생성한 데이터만 열람합니다. 테스트넷 모드에서는 상세 검사 API가 거절됩니다.</p></section>;
  if(item.id==='settlement')return <><section className="domain-panel"><h2>대사 결과</h2><Fields rows={[["Vault Equity",cash(state?.vault.vaultEquity)+' tUSD'],['Σ Strategy Equity',cash(state?.vault.strategyEquity)+' tUSD'],['Protocol Accruals',cash(state?.vault.protocolAccrual)+' tUSD'],['일치 여부',state?.vault.balanced?'일치':'미확인']]}/>{snapshot&&<Data label="전략별 Investor Claim + Provider Accrual 대사" value={snapshot.reconciliation}/>}</section><Verification state={state} evidence={evidence}/></>;
  if(!snapshot)return <Empty>{snapshotError||'로컬 도메인 상태를 읽는 중입니다.'}</Empty>;
  const own=snapshot.ledger.strategies.find(s=>s.id===selected);
  return <section className="domain-panel"><div className="domain-panel-heading"><h2>실제 로컬 상태</h2><StrategySelector session={session}/></div><p className="domain-muted">실행기와 계약에서 읽은 테스트 데이터입니다. 아래 값은 설계 예시를 채운 숫자가 아닙니다.</p>
    {item.id==='ledger'&&<LedgerState snapshot={snapshot} selected={selected}/>}
    {item.id==='investor'&&<><Fields rows={[["선택한 테스트 투자자",state?.investor||'미연결'],['지갑 잔액',cash(state?.wallet)+' tUSD']]}/><Data label="전략별 보유 units와 Investor Claim" value={state?.portfolio}/></>}
    {item.id==='provider'&&<><Fields rows={[["전략",own?.name||'—'],['provider',own?.provider||'—'],['독립 계정',own?.id||'—']]}/><Data label="전략 등록 근거" value={snapshot.registrations?.find(r=>r.strategyId===selected)||{source:'초기 테스트 fixture',signedRegistration:false}}/><Data label="전략별 정산 이력 (실전 forward 이력 아님)" value={snapshot.track.filter(t=>t.strategyId===selected)}/><p className="implementation-gap">현재 서명 주문 원문은 처리 중 요청에 존재합니다. 완료 후 저장된 추적 데이터는 서명 해시·주문 귀속·체결 영수증이며, 영구적인 alpha 원문 보관·평가 경로는 별도 구현이 필요합니다.</p></>}
    {item.id==='authorization'&&<><Fields rows={[["요청 상태",snapshot.pending?'복구 또는 확정 대기':'대기 요청 없음'],['처리 완료 요청 수',String(snapshot.completedRequests)],['중복 방지 키 수',String(snapshot.completedRequests)]]}/><Data label="처리 중인 요청 (민감 원문 제외)" value={snapshot.pending}/><Data label="최근 권한·서명 해시 기록" value={snapshot.trace.slice(-5).map(t=>({type:t.type,signer:t.signer,strategyId:t.strategyId,requestId:t.id,signatureHash:t.signatureHash}))}/></>}
    {item.id==='vault'&&<><Fields rows={[["공동 Vault",snapshot.vault],['실제 현금 잔액',cash(snapshot.custody.cash)+' tUSD'],['연결된 거래소',snapshot.venue]]}/><Data label="실제 토큰 수량·차입·담보" value={snapshot.custody}/><Data label="최근 Vault 이벤트 (공개 형태에는 strategyId 없음)" value={snapshot.trace.slice(-5).map(t=>({transactionHash:t.transactionHash,events:t.events}))}/></>}
    {item.id==='market'&&<><Fields rows={[["거래소 주소",snapshot.venue],['종류','이 프로젝트가 배포한 테스트 토큰용 AMM'],['거래 주체',snapshot.vault]]}/><Data label="현재 풀 가격 평가값 (6자리 정수 단위)" value={snapshot.marks}/><Data label="선택한 전략의 차입 lot·담보" value={own?.shorts}/><Data label="실제 체결에 포함된 수수료 귀속" value={own?.venueFees||[]}/></>}
  </section>;
}
function Experiment({item,session}){
  const {state,selected,amount,setAmount,busy,act}=session;
  if(item.id==='provider')return <><div className="workbench-note">도메인 명령 시험입니다. 테스트 지갑으로 실제 로컬 계약을 실행합니다. 주문 결과는 ‘실행 추적’에서 앞뒤 도메인과 함께 확인하세요.</div><Provider {...session}/>{state?.mode==='LOCAL_EVM'&&<section className="domain-panel"><h2>전략 등록 요청 시험</h2><p>제공자 A의 테스트 키로 REGISTER를 서명해 별도 전략 계정을 만듭니다. 등록 자체는 오프체인 명령이며 체인 예치나 거래를 발생시키지 않습니다.</p><form className="domain-command" onSubmit={e=>{e.preventDefault();act('REGISTER',{strategyId:'strategy-'+crypto.randomUUID().slice(0,8),name:session.newName,description:session.newDescription});}}><label>전략 이름<input required maxLength={100} value={session.newName} onChange={e=>session.setNewName(e.target.value)}/></label><label>전략 설명<input maxLength={500} value={session.newDescription} onChange={e=>session.setNewDescription(e.target.value)}/></label><button className="primary" disabled={busy}>REGISTER 실행</button></form></section>}</>;
  if(item.id==='investor')return <><section className="domain-panel"><h2>배정 요청 시험</h2><StrategySelector session={session}/><form className="domain-command" onSubmit={e=>{e.preventDefault();act('ALLOCATE',{strategyId:selected,amount});}}><label>amount (tUSD)<input required type="number" min="0.000001" step="0.000001" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="primary" disabled={busy}>ALLOCATE 실행</button></form><p className="domain-muted">투자자 → 권한 → Vault 예치 → 영수증 확인 → 해당 전략 units 발행</p></section><section className="domain-panel"><h2>환매 요청 시험</h2>{state?.portfolio.length?state.portfolio.map(p=><div className="domain-withdraw" key={p.strategyId}><span>{p.name} · {cash(p.claim)} tUSD</span><button className="secondary" disabled={busy||!p.canRedeem} onClick={()=>act('REDEEM',{strategyId:p.strategyId})}>{p.canRedeem?'REDEEM 실행':'포지션 정산 필요'}</button></div>):<Empty>환매할 지분이 없습니다.</Empty>}</section></>;
  return <section className="domain-panel"><h2>명령 진입점</h2><p>이 도메인의 상태를 직접 수정하지 않습니다. 서명된 요청을 통해 아래 경로에서 실행하고 결과를 추적합니다.</p><div className="domain-links"><a href={href('investor','commands')}>투자자 배정·환매 명령 →</a><a href={href('provider','commands')}>제공자 주문·정산 명령 →</a><a href="#/domains/trace">실행 추적 →</a></div><p className="implementation-gap">{item.id==='privacy'?'TEE 실행은 아직 연결되지 않았습니다.':item.gap}</p></section>;
}
function Trace({snapshot,error}){
  const [filter,setFilter]=useState('all'),[selectedId,setSelectedId]=useState('');
  if(!snapshot)return <Empty>{error||'실행 기록을 읽는 중입니다.'}</Empty>;
  const rows=[...snapshot.trace].reverse().filter(t=>filter==='all'||t.strategyId===filter),row=rows.find(t=>t.id===selectedId)||rows[0];
  const order=row&&snapshot.ledger.orders.find(o=>o.orderId===row.id);
  return <><div className="workbench-note">실제 요청 하나를 기준으로 비공개 귀속 → 공개 계약 이벤트 → 정산 결과를 함께 확인합니다. 로컬 테스트 데이터 전용입니다.</div><label className="domain-strategy-select">전략 필터<select value={filter} onChange={e=>{setFilter(e.target.value);setSelectedId('');}}><option value="all">모든 전략</option>{snapshot.ledger.strategies.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {!rows.length?<Empty>실행 기록이 없습니다. 투자자 또는 제공자 도메인에서 명령을 실행하세요.</Empty>:<div className="trace-layout"><nav className="trace-list" aria-label="실행 기록">{rows.map(t=><button key={t.id} aria-pressed={row.id===t.id} onClick={()=>setSelectedId(t.id)}><strong>{t.type}</strong><span>{t.strategyId}</span><small>블록 {t.blockNumber} · {short(t.transactionHash)}</small></button>)}</nav><section className="domain-panel"><h2>{row.type} · {row.strategyId}</h2>
      <div className="trace-stage"><DomainLink id="authorization"/><Fields rows={[["requestId",row.id],['signer',row.signer],['서명 요청 해시',row.signatureHash]]}/></div>
      <div className="trace-stage"><DomainLink id="ledger"/><Fields rows={[["비공개 전략 귀속",row.strategyId],['주문 방향',order?.side||'자본 이동'],['체결 수량 (원시 정수 · 10⁶ = 1 토큰)',order?.quantity||'—']]}/></div>
      <div className="trace-stage"><DomainLink id="vault"/><Fields rows={[["체결 / 자금 이동 tx",row.transactionHash],['사전 commitment tx',row.commitmentHash||'해당 없음']]}/><Data label="공개 Vault 이벤트 전체" value={row.events}/></div>
      <div className="trace-stage"><DomainLink id="settlement"/><Fields rows={[["이 요청 직후 대사",row.reconciliation.balanced?'일치':'불일치'],['Vault Equity',cash(row.reconciliation.vaultEquity)+' tUSD'],['Σ Strategy Equity',cash(row.reconciliation.strategyEquity)+' tUSD']]}/><Data label="이 시점의 전략별 투자자 권리" value={row.reconciliation.equities}/></div>
    </section></div>}
  </>;
}
export default function DomainWorkbench({path}){
  const session=useExecutionSession(),[snapshot,setSnapshot]=useState(null),[snapshotError,setSnapshotError]=useState('');
  const heading=useRef(null);const parts=path.split('/'),id=parts[2]||'overview',item=domain(id),tab=['state','commands'].includes(parts[3])?parts[3]:'contract';
  async function refreshSnapshot(){if(session.state?.mode!=='LOCAL_EVM'){setSnapshot(null);setSnapshotError('상세 도메인 상태 열람은 로컬 테스트 환경에서만 가능합니다.');return;}const res=await fetch('/api/sleeves/execution/inspect-local-domains',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await res.json();if(!res.ok)throw new Error(data.error);setSnapshot(data);setSnapshotError('');}
  useEffect(()=>{if(session.state)refreshSnapshot().catch(e=>setSnapshotError(e.message));},[session.state]);
  useEffect(()=>{heading.current?.focus();window.scrollTo(0,0);},[path]);
  const title=id==='trace'?'실행 추적':item?item.name:'전체 설계 흐름';
  return <div className="workbench-shell"><aside className="workbench-sidebar"><a className="workbench-brand" href="#/domains/overview">MM-ZKQuant<span>설계·도메인 검토</span></a><nav aria-label="도메인 탐색"><a href="#/domains/overview" aria-current={!item&&id!=='trace'?'page':undefined}>전체 설계 흐름</a><div className="domain-nav-label">DOMAIN BOUNDARIES</div>{domains.map((d,i)=><a href={href(d.id)} key={d.id} aria-current={id===d.id?'page':undefined}><span>{String(i+1).padStart(2,'0')}</span>{d.name}</a>)}<div className="domain-nav-label">OBSERVABILITY</div><a href="#/domains/trace" aria-current={id==='trace'?'page':undefined}>실행 추적</a></nav></aside>
    <div className="workbench-main"><header className="workbench-topbar"><span>Concept v0.2 <b>설계 검토 환경</b></span><span>{session.state?.mode==='MONAD_TESTNET'?'Monad 테스트넷':'로컬 EVM'} · TEE 미연결</span></header><main className="workbench-content"><div className="workbench-heading"><div><small>{item?.en||'Confidential Alpha Protocol'}</small><h1 ref={heading} tabIndex={-1}>{title}</h1></div><button className="secondary" disabled={session.busy||!session.state} onClick={()=>Promise.all([session.load(),refreshSnapshot()]).catch(e=>session.setError(e.message))}>실행 상태 새로고침</button></div>
    {item&&<nav className="domain-tabs" aria-label="도메인 보기">{[['contract','책임·입출력'],['state','실제 상태'],['commands','명령 시험']].map(([key,label])=><a href={href(id,key)} key={key} aria-current={tab===key?'page':undefined}>{label}</a>)}</nav>}
    {session.error&&<div role="alert" className="alert error">{session.error}</div>}{session.notice&&<div role="status" className="alert domain-notice"><span>{session.notice}</span><a href="#/domains/trace">실행 추적 →</a></div>}
    {item&&tab==='commands'&&<div className="domain-test-context">{session.state?.mode==='LOCAL_EVM'?<label>명령 시험용 투자자<select value={session.investor} disabled={session.busy} onChange={e=>session.setInvestor(e.target.value)}><option value="a">테스트 투자자 A</option><option value="b">테스트 투자자 B</option></select></label>:<button className="secondary" onClick={session.connect}>외부 지갑 연결</button>}<span>지갑 {short(session.state?.investor)} · {cash(session.state?.wallet)} tUSD</span></div>}
    <div className="workbench-body">{!item&&id!=='trace'&&<Architecture scenario={parts[3]}/>}{id==='trace'&&<Trace snapshot={snapshot} error={snapshotError}/>}{item&&tab==='contract'&&<Contract item={item}/>} {item&&tab==='state'&&<StatePanel {...{item,session,snapshot,snapshotError}}/>}{item&&tab==='commands'&&(session.state?<Experiment item={item} session={session}/>:<Empty>실행 환경을 불러오는 중입니다.</Empty>)}</div>
    </main></div></div>;
}
