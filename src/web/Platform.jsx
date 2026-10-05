import React, { useEffect, useState } from 'react';
import InvestorPortal from './InvestorPortal.jsx';
import ManagerConsole from './ManagerConsole.jsx';

const explorer = value => `https://testnet.monadscan.com/address/${value}`;
const short = value => `${value.slice(0, 7)}…${value.slice(-5)}`;
const platformApi = import.meta.env.VITE_PLATFORM_API_BASE?.replace(/\/$/, '') || '/api';
const platformRequest = async (path, options = {}) => {
  const response = await fetch(`${platformApi}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || '플랫폼 API 요청이 거절되었습니다.');
  return body;
};


function Header({ page, setPage }) {
  return <header className="platform-header"><a href="#/" className="platform-brand" onClick={event=>{event.preventDefault();setPage('explore');}}>MM<span>Quant</span></a><nav>{[['explore', '전략 탐색'], ['invest', '내 포트폴리오'], ['manage', '전략가 콘솔']].map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav><span className="platform-network">Monad Testnet</span></header>;
}

function StrategyCard({ strategy, onSelect }) {
  const hasNav = Number.isFinite(strategy.pnlBps);
  return <article className="strategy-card"><div className="strategy-card-top"><span>{strategy.executionStatus==='HALTED'?'운용 중단':'투자 가능'}</span><b className={strategy.risk.toLowerCase()}>{strategy.risk} risk</b></div><h2>{strategy.name}</h2><p>{strategy.description}</p><dl><div><dt>전략가</dt><dd>{strategy.manager}</dd></div><div><dt>누적 손익</dt><dd className={hasNav ? (strategy.pnlBps >= 0 ? 'positive' : 'negative') : ''}>{hasNav ? `${strategy.pnlBps >= 0 ? '+' : ''}${strategy.pnlBps.toFixed(2)}%` : '집계 전'}</dd></div><div><dt>연환산 변동성</dt><dd>{Number.isFinite(strategy.volatilityBps) ? `${strategy.volatilityBps.toFixed(2)}%` : '집계 전'}</dd></div><div><dt>전략가 자기자본</dt><dd>{strategy.managerActive===undefined?'집계 전':`${(Number(strategy.managerActive)/1e6).toLocaleString('ko-KR',{maximumFractionDigits:2})} AUSD`}</dd></div></dl><button className="platform-button" onClick={() => onSelect(strategy)}>전략 상세 보기</button></article>;
}

function PublicConditions({strategy}) {
  const p=strategy.policy;
  const money = value => (Number(value || 0)/1e6).toLocaleString('ko-KR',{maximumFractionDigits:2});
  const conditions = (policy,fee) => <dl><dt>최대 레버리지</dt><dd>{policy.maxLeverageBps/10000}배</dd><dt>손절 / 최대 낙폭 한도</dt><dd>{policy.stopLossBps/100}% / {policy.maxDrawdownBps/100}% · 한도 도달 시 자동 종료</dd><dt>출금 정산</dt><dd>{policy.settlementPeriodSeconds/3600}시간마다 · UTC 기준 오프셋 {policy.settlementOffsetSeconds/60}분</dd><dt>출금 신청 마감</dt><dd>정산 {policy.withdrawalCutoffSeconds/60}분 전</dd><dt>주문 유효 시간 / 허용 슬리피지</dt><dd>{policy.orderTtlSeconds}초 / {policy.slippageBps/100}%</dd><dt>성과보수</dt><dd>{fee/100}% · 투자자별 최고 평가액 초과 이익에 부과</dd></dl>;
  return <section className="portfolio-card"><div><h2>공개 운용 조건과 자기자본</h2>{p&&conditions(p,strategy.feeBps)}<p>자기자본 운용 평가액: {strategy.managerActive===undefined?'집계 전':money(strategy.managerActive)} AUSD</p><p>자기자본 대기 입금: {money(strategy.managerPending)} AUSD · 출금 요청: {money(strategy.managerWithdrawing)} AUSD</p><p>실제 운용 성과는 거래 비용과 성과보수를 반영한 기준 투자자의 수익률입니다. 개인별 가입 시점에 따라 수익률은 다를 수 있습니다.</p>
    {strategy.pending_policy&&<aside className="manager-note"><strong>운용 조건 변경 예고</strong><p>{new Date(strategy.pending_policy.effectiveAfter*1000).toLocaleString('ko-KR')} 이후 기존 출금 요청 정산이 완료되면 적용됩니다. 변경 전 현재 일정으로 출금할 수 있습니다.</p>{conditions(strategy.pending_policy.policy,strategy.pending_policy.feeBps)}</aside>}
    {!!strategy.liveHistory?.length&&<details><summary>공개 성과와 자기자본 이력</summary><div style={{overflowX:'auto'}}><table><thead><tr><th>기록 시각</th><th>누적 손익</th><th>자기자본 운용</th><th>대기 입금</th><th>출금 요청</th></tr></thead><tbody>{strategy.liveHistory.map(row=><tr key={row.observed_at}><td>{new Date(row.observed_at).toLocaleString('ko-KR')}</td><td>{(row.metrics.pnlBps/100).toFixed(2)}%</td><td>{money(row.metrics.managerActive)} AUSD</td><td>{money(row.metrics.managerPending)} AUSD</td><td>{money(row.metrics.managerWithdrawing)} AUSD</td></tr>)}</tbody></table></div></details>}
  </div></section>;
}

function Explore({ select, strategies }) {
  return <><section className="platform-hero"><small>CONFIDENTIAL QUANT STRATEGIES · TESTNET</small><h1>실적으로 선택하는,<br /><em>퀀트 전략 투자.</em></h1><p>전략가의 자기자본과 실제 운용 성과를 확인하세요. 내 투자 내역과 전략의 포지션은 비공개로 관리됩니다.</p><div className="platform-hero-stats"><span><strong>{strategies.length}</strong> 공개 전략</span><span><strong>1</strong> shared vault</span><span><strong>TEE</strong> private allocations</span></div></section><section className="platform-section"><div className="platform-heading"><div><small>PUBLIC STRATEGY CATALOG</small><h2>전략 목록</h2></div><p>실제 운용 성과, 전략가 자기자본, 공개된 위험 한도를 비교하세요.</p></div>{strategies.length ? <div className="strategy-grid">{strategies.map(strategy => <StrategyCard key={strategy.id} strategy={strategy} onSelect={select} />)}</div> : <div className="platform-empty-card"><strong>공개된 전략이 없습니다.</strong><span>전략가 콘솔에서 첫 전략을 등록하면 이 목록에 표시됩니다.</span></div>}</section></>;
}

function StrategyDetail({ strategy, config, back, invest }) {
  const hasNav = Number.isFinite(strategy.pnlBps);
  return <section className="platform-detail"><button className="platform-back" onClick={back}>← 전략 목록</button><div className="platform-detail-heading"><div><span>{strategy.status}</span><h1>{strategy.name}</h1><p>{strategy.description}</p></div><div className="platform-detail-target"><small>PUBLIC PERFORMANCE</small><strong className={hasNav ? (strategy.pnlBps >= 0 ? 'positive' : 'negative') : ''}>{hasNav ? `${strategy.pnlBps >= 0 ? '+' : ''}${strategy.pnlBps.toFixed(2)}%` : '집계 중'}</strong><span>연환산 변동성 {Number.isFinite(strategy.volatilityBps) ? `${strategy.volatilityBps.toFixed(2)}%` : '집계 중'} · fee {strategy.feeBps / 100}%</span></div></div><div className="platform-detail-grid"><article><small>SHARED CUSTODY</small><h2>모든 전략이 하나의 Vault 사용</h2><p>투자자의 AUSD는 공용 Vault에 입금됩니다. 전략 선택 정보는 입금 거래에 기록되지 않고 TEE 내부 장부에만 연결됩니다.</p>{config?.vaultAddress && <a className="platform-text-button" href={explorer(config.vaultAddress)} target="_blank" rel="noreferrer">공용 Vault {short(config.vaultAddress)} ↗</a>}</article><article><small>PRIVATE ATTRIBUTION</small><h2>{strategy.status === 'LIVE' ? '운용 중' : strategy.status === 'FUNDING' ? '투자 모집 중' : '준비 중'}</h2><p>전략 주문은 다른 전략과 합산하지 않습니다. 온체인 포지션과 체결은 보일 수 있지만, 해당 execution slot과 전략의 연결 및 투자자별 배분은 TEE 밖에 공개하지 않습니다.</p><button className="platform-button" disabled={!['FUNDING','LIVE'].includes(strategy.status)} onClick={invest}>{['FUNDING','LIVE'].includes(strategy.status) ? '이 전략에 투자하기' : '현재 모집 준비 중'}</button></article></div></section>;
}


export default function Platform() {
  const [page, setPage] = useState('explore');
  const [selected, setSelected] = useState(null);
  const [teeStrategies, setTeeStrategies] = useState([]);
  const [config, setConfig] = useState(null);
  const [connectionError, setConnectionError] = useState('');
  const [investStrategyId, setInvestStrategyId] = useState('');

  const refreshStrategies = () => {
    platformRequest('/v1/strategies').then(result => {
      setTeeStrategies(result.strategies.map(item => ({
        ...item,
        manager: item.strategist_name,
        settledRounds: 0,
        pnlBps: item.pnl_bps === null ? null : Number(item.pnl_bps) / 100,
        volatilityBps: item.volatility_bps === null ? null : Number(item.volatility_bps) / 100,
        feeBps: Number(item.fee_bps),
        ...(item.public_metrics?{managerActive:item.public_metrics.managerActive,managerPending:item.public_metrics.managerPending,managerWithdrawing:item.public_metrics.managerWithdrawing}:{}),
        receipts: []
      })));
    }).catch(() => setConnectionError('전략 목록을 불러오지 못했습니다. 연결을 다시 시도해 주세요.'));
  };

  const refreshConnection = async () => {
    try { setConfig(await platformRequest('/v1/config')); setConnectionError(''); }
    catch { setConnectionError('플랫폼 연결이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'); }
    refreshStrategies();
  };

  useEffect(() => {
    refreshConnection();
  }, []);

  useEffect(() => { if (config) return; const timer = setInterval(refreshConnection, 10000); return () => clearInterval(timer); }, [config]);

  useEffect(()=>{
    if(!config?.teeEndpoint)return;
    let cancelled=false;
    const refresh=async()=>{try{const r=await fetch(`${config.teeEndpoint}/platform/metrics`);if(!r.ok)return;const j=await r.json();if(cancelled)return;setTeeStrategies(rows=>rows.map(s=>{const m=j.strategies.find(m=>m.strategyId===s.id);return m?{...s,...m,pnlBps:m.pnlBps/100,volatilityBps:m.volatilityBps===null?null:m.volatilityBps/100,status:s.status,executionStatus:m.status}:s;}));}catch{}};
    refresh();const timer=setInterval(refresh,15000);return()=>{cancelled=true;clearInterval(timer);};
  },[config,teeStrategies.length]);

  const strategies = teeStrategies;
  const selectStrategy = strategy => {
    platformRequest(`/v1/strategies/${strategy.slug}`).then(detail => setSelected({ ...strategy, ...detail.strategy, manager: detail.strategy.strategist_name, feeBps: Number(detail.strategy.fee_bps), latestNav: detail.latestNav,liveHistory:detail.liveHistory })).catch(() => setSelected(strategy));
  };
  const body = selected ? <StrategyDetail strategy={selected} config={config} back={() => setSelected(null)} invest={() => { setInvestStrategyId(selected.id); setSelected(null); setPage('invest'); }} /> : page === 'explore' ? <Explore select={selectStrategy} strategies={strategies} /> : page === 'invest' ? <InvestorPortal apiBase={platformApi} config={config} strategies={strategies} initialStrategyId={investStrategyId} onBack={() => setPage('explore')} /> : <ManagerConsole apiBase={platformApi} config={config} onRefresh={refreshStrategies} onInvest={id=>{setInvestStrategyId(id);setPage('invest');}} />;
  return <div className="platform-shell"><Header page={page} setPage={p=>{setSelected(null);setPage(p);}} /><main>{connectionError&&<div className="manager-note" role="alert"><span>{connectionError}</span><button className="platform-text-button" onClick={refreshConnection}>연결 다시 시도</button></div>}{body}{selected&&<PublicConditions strategy={selected}/>}</main><footer><span>MM-ZKQuant · Monad Testnet</span><span>Shared custody · strategy-specific execution</span></footer></div>;
}
