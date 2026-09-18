import React, { useState } from 'react';
export const value=v=>Number(v||0)/1e6;
export const cash=v=>v==null?'—':value(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const short=x=>x?x.slice(0,8)+'…'+x.slice(-6):'—';
const names={ALLOCATE:'자본 배정',REDEEM:'환매',PAY_PROVIDER:'보수 지급',ORDER:'주문'};
const Empty=({children})=><div className="service-empty">{children}</div>;

export function Catalog({state,navigate}) {
  const [search,setSearch]=useState('');
  const list=state?.catalog.filter(s=>(s.name+' '+s.description+' '+s.provider).toLowerCase().includes(search.toLowerCase()))||[];
  return <>
    <div className="catalog-tools"><label htmlFor="strategy-search">전략 검색</label><input id="strategy-search" placeholder="전략 이름 또는 제공자 주소" value={search} onChange={e=>setSearch(e.target.value)}/><span>{list.length}개 전략</span></div>
    <div className="strategy-directory">{list.map(s=><article className="directory-row" key={s.id}>
      <div className="directory-identity"><span className="strategy-letter">{s.name.slice(0,1)}</span><div><h2><a href={'#/strategies/'+encodeURIComponent(s.id)}>{s.name}</a></h2><p>{s.description}</p><small>제공자 {short(s.provider)}</small></div></div>
      <div className="directory-metric"><small>지분당 가치</small><strong>{value(s.unitPrice).toFixed(6)} <small>tUSD</small></strong></div>
      <div className="directory-metric"><small>정산 기록</small><strong>{s.settledRounds}회</strong></div>
      <button className="secondary" onClick={()=>navigate('/strategies/'+encodeURIComponent(s.id))}>상세 보기</button>
    </article>)}</div>
    {!list.length&&state&&<Empty>조건에 맞는 전략이 없습니다.</Empty>}
    <p className="service-caption">현재 목록은 테스트 자산으로 운영됩니다. 실전 운용 실적은 아직 없습니다.</p>
  </>;
}

export function StrategyDetail({strategy,state,amount,setAmount,busy,act,navigate}) {
  if(!strategy)return state?<Empty>찾을 수 없는 전략입니다. <a href="#/strategies">목록으로 돌아가기</a></Empty>:null;
  const position=state.portfolio.find(p=>p.strategyId===strategy.id);
  return <>
    <a className="back-link" href="#/strategies">← 전략 목록</a>
    <div className="strategy-detail-grid">
      <section className="card"><div className="eyebrow">STRATEGY</div><h2>{strategy.name}</h2><p>{strategy.description}</p><p className="service-caption">제공자 <span className="address-text">{strategy.provider}</span></p>
        <dl className="service-facts"><div><dt>지분당 가치</dt><dd>{value(strategy.unitPrice).toFixed(6)} tUSD</dd></div><div><dt>투자자 자산</dt><dd>{cash(strategy.investorEquity)} tUSD</dd></div><div><dt>정산 기록</dt><dd>{strategy.settledRounds}회</dd></div><div><dt>성과보수</dt><dd>{strategy.feeBps/100}%</dd></div></dl>
        <h3>투자 조건</h3><p>이 전략에 배정한 자본의 지분을 받습니다. 입출금은 이 전략의 포지션이 모두 정산된 때 가능합니다.</p><p>이전 지분가치 고점을 넘는 이익에서만 성과보수를 적립합니다.</p>
      </section>
      <section className="card allocation-panel"><h2>자본 배정</h2><p>사용 가능한 잔액 <strong>{cash(state.wallet)} tUSD</strong></p><form onSubmit={e=>{e.preventDefault();act('ALLOCATE',{strategyId:strategy.id,amount});}}><label htmlFor="allocation-amount">배정 금액 (tUSD)</label><input id="allocation-amount" type="number" min="0.000001" step="0.000001" required value={amount} onChange={e=>setAmount(e.target.value)}/><button className="primary full-width" disabled={busy}>{busy?'처리 중…':'이 전략에 배정'}</button></form>
        {position&&<p>현재 내 권리 <strong>{cash(position.claim)} tUSD</strong></p>}<button className="text-button" onClick={()=>navigate('/portfolio')}>내 투자 확인 →</button>
      </section>
    </div>
  </>;
}

export function Portfolio({state,busy,act,navigate}) {
  const total=state?.portfolio.reduce((n,p)=>n+BigInt(p.claim),0n)||0n;
  return <>
    <div className="portfolio-summary"><div><span>내 전략 자산 합계</span><strong>{cash(String(total))} <small>tUSD</small></strong></div><div><span>투자 중인 전략</span><strong>{state?.portfolio.length||0}<small>개</small></strong></div><a href="#/activity">입출금 내역 →</a></div>
    <section className="card">{state?.portfolio.length?<div className="table-scroll"><table className="pilot-table"><thead><tr><th>전략</th><th>내 지분</th><th>현재 내 권리</th><th>관리</th></tr></thead><tbody>{state.portfolio.map(p=><tr key={p.strategyId}><td><a href={'#/strategies/'+encodeURIComponent(p.strategyId)}>{p.name}</a></td><td>{value(p.units).toLocaleString('en-US',{maximumFractionDigits:6})}</td><td>{cash(p.claim)} tUSD</td><td><button className="secondary" disabled={busy||!p.canRedeem} onClick={()=>act('REDEEM',{strategyId:p.strategyId})}>{p.canRedeem?'환매':'정산 대기'}</button></td></tr>)}</tbody></table></div>:<Empty><p>아직 배정한 전략이 없습니다.</p><button className="primary" onClick={()=>navigate('/strategies')}>전략 찾아보기</button></Empty>}</section>
  </>;
}

export function Activity({state}) {
  return <><a className="back-link" href="#/portfolio">← 내 투자</a><section className="card">{state?.receipts.length?<div className="table-scroll"><table className="pilot-table"><thead><tr><th>작업</th><th>전략</th><th>블록</th><th>거래 해시</th></tr></thead><tbody>{state.receipts.map(r=><tr key={r.hash}><td>{names[r.type]||r.type}</td><td>{state.catalog.find(s=>s.id===r.strategyId)?.name||r.strategyId}</td><td>{r.block}</td><td>{state.mode==='MONAD_TESTNET'?<a href={'https://testnet.monadexplorer.com/tx/'+r.hash} target="_blank" rel="noreferrer">{short(r.hash)}</a>:<code title={r.hash}>{short(r.hash)}</code>}</td></tr>)}</tbody></table></div>:<Empty>입출금 내역이 없습니다.</Empty>}</section></>;
}

export function Provider({state,selected,setSelected,orderAmount,setOrderAmount,busy,act,walletSigner,newName,setNewName,newDescription,setNewDescription}) {
  const eligible=state?.catalog.filter(s=>state.mode==='LOCAL_EVM'||s.provider.toLowerCase()===state.investor?.toLowerCase())||[];
  const strategy=eligible.find(s=>s.id===selected);
  return <>
    {state?.mode==='LOCAL_EVM'&&<p className="service-caption">제공자 테스트 계정으로 운용하는 로컬 환경입니다.</p>}
    <div className="provider-picker"><label htmlFor="provider-strategy">운용할 전략</label><select id="provider-strategy" value={strategy?.id||''} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="" disabled>전략을 선택하세요</option>{eligible.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></div>
    {strategy?<div className="strategy-detail-grid"><section className="card"><h2>{strategy.name}</h2><dl className="service-facts"><div><dt>전략 투자자 자산</dt><dd>{cash(strategy.investorEquity)} tUSD</dd></div><div><dt>미지급 보수</dt><dd>{cash(strategy.providerAccrual)} tUSD</dd></div></dl>{strategy.id==='cash-reserve'?<p>현금 보관 전략에는 주문 기능이 없습니다.</p>:<form onSubmit={e=>{e.preventDefault();act('ORDER',{strategyId:strategy.id,side:strategy.id==='btc-hedge'?'SHORT_OPEN':'BUY',amount:orderAmount});}}><label htmlFor="order-amount">매수 자금 / 숏 담보 (tUSD)</label><input id="order-amount" type="number" min="0.000001" step="0.000001" required value={orderAmount} onChange={e=>setOrderAmount(e.target.value)}/><p className="service-caption">이 전략 투자자 자산의 25% 이내에서 주문할 수 있습니다.</p><button className="primary" disabled={busy}>{strategy.id==='btc-hedge'?'차입·매도 주문':'BTC 매수 주문'}</button></form>}</section>
      <section className="card"><h2>정산과 보수</h2><p>해당 전략의 포지션만 정산합니다. 정산 후 투자자는 환매할 수 있습니다.</p>{strategy.id!=='cash-reserve'&&<button className="secondary" disabled={busy} onClick={()=>act('ORDER',{strategyId:strategy.id,side:strategy.id==='btc-hedge'?'SHORT_CLOSE':'SELL'})}>포지션 정산</button>}<hr/><p>적립된 보수를 제공자 지갑으로 지급합니다.</p><button className="secondary" disabled={busy||!BigInt(strategy.providerAccrual)} onClick={()=>act('PAY_PROVIDER',{strategyId:strategy.id})}>보수 {cash(strategy.providerAccrual)} tUSD 지급</button></section></div>:<Empty>본인이 제공자인 전략을 선택하거나 새 전략을 등록하세요.</Empty>}
    {state?.mode==='MONAD_TESTNET'&&<details className="card"><summary>새 전략 등록</summary><form className="registration-form" onSubmit={e=>{e.preventDefault();act('REGISTER',{strategyId:'strategy-'+crypto.randomUUID().slice(0,8),name:newName,description:newDescription});}}><label>전략 이름<input required maxLength={100} value={newName} onChange={e=>setNewName(e.target.value)}/></label><label>전략 설명<input maxLength={500} value={newDescription} onChange={e=>setNewDescription(e.target.value)}/></label><button className="primary" disabled={busy||!walletSigner}>서명하고 등록</button></form></details>}
  </>;
}

export function Verification({state,evidence}) {
  return <>
    <div className="strategy-detail-grid"><section className="card"><h2>현재 실행 환경</h2><dl className="service-facts"><div><dt>네트워크</dt><dd>{state?.mode==='MONAD_TESTNET'?'Monad 테스트넷':'로컬 EVM'}</dd></div><div><dt>자산</dt><dd>테스트 토큰</dd></div><div><dt>TEE</dt><dd>미적용</dd></div></dl><p>{state?.mode==='MONAD_TESTNET'?'외부 지갑의 서명을 확인해 요청을 처리합니다.':'테스트 키로 서버가 서명합니다. 실제 지갑 로그인은 아닙니다.'} 비공개 장부와 계약 실행은 운영자를 신뢰합니다.</p><p><a href="/docs/sleeves-v0.2.md" target="_blank" rel="noreferrer">개발 명세와 검증 범위 ↗</a></p><p><a href="/docs/confidential-alpha-v0.2.md" target="_blank" rel="noreferrer">제품 명세 ↗</a></p></section>
      <section className="card"><h2>공동 Vault 대사</h2><p className="address-text">{state?.vault.address}</p><dl className="service-facts"><div><dt>Vault 자산가치</dt><dd>{cash(state?.vault.vaultEquity)} tUSD</dd></div><div><dt>전략 자산가치 합계</dt><dd>{cash(state?.vault.strategyEquity)} tUSD</dd></div><div><dt>프로토콜 귀속·반올림</dt><dd>{cash(state?.vault.protocolAccrual)} tUSD</dd></div><div><dt>대사 결과</dt><dd>{state?.vault.balanced?'일치':'대기'}</dd></div></dl></section></div>
    {evidence?.available?<section className="card"><h2>Monad 테스트넷 거래 증거</h2><p>{evidence.operations}개 작업 · 최종 장부 {evidence.balanced?'일치':'확인 필요'} · 통제된 테스트 계정과 자산</p><p><a href={'https://testnet.monadexplorer.com/address/'+evidence.vault} target="_blank" rel="noreferrer">테스트넷 Vault {short(evidence.vault)} ↗</a></p><div className="table-scroll"><table className="pilot-table"><thead><tr><th>작업</th><th>전략</th><th>거래</th></tr></thead><tbody>{evidence.transactions.map(t=><tr key={t.hash}><td>{names[t.type]||t.type}</td><td>{t.strategyId}</td><td><a href={'https://testnet.monadexplorer.com/tx/'+t.hash} target="_blank" rel="noreferrer">{short(t.hash)} ↗</a></td></tr>)}</tbody></table></div></section>:<Empty>테스트넷 검증 기록을 불러올 수 없습니다.</Empty>}
    <a href="#/legacy">이전 공동 펀드 기록 보기 →</a>
  </>;
}
