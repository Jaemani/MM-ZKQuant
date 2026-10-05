import React, { useEffect, useState } from 'react';
import perpl from '../../docs/evidence/perpl-tee-testnet-readiness.json';
import sleeves from '../../docs/evidence/omnibus-rpc-verification.json';
import omnibus from '../../docs/evidence/omnibus-testnet.json';

const explorer = value => `https://testnet.monadscan.com/address/${value}`;
const short = value => `${value.slice(0, 7)}…${value.slice(-5)}`;
const platformApi = import.meta.env.VITE_PLATFORM_API_BASE?.replace(/\/$/, '') || '/api';
const platformRequest = async (path, options = {}) => {
  const response = await fetch(`${platformApi}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || '플랫폼 API 요청이 거절되었습니다.');
  return body;
};

const snapshot = omnibus.before.a;
const evidenceStrategies = snapshot.catalog.map(item => ({ ...item, manager: short(item.provider), status: 'TESTNET VERIFIED', risk: item.id === 'cash-reserve' ? 'Low' : 'High', pnlBps: Number(item.unitPrice) / 10000 - 100, target: item.id === 'btc-trend' ? 'BTC long' : item.id === 'btc-hedge' ? 'BTC short' : 'Cash', receipts: snapshot.receipts.filter(receipt => receipt.strategyId === item.id) }));

function Header({ page, setPage }) {
  return <header className="platform-header"><a href="#/" className="platform-brand">MM<span>Quant</span></a><nav>{[['explore', '전략 탐색'], ['invest', '내 포트폴리오'], ['manage', '전략가 콘솔']].map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav><span className="platform-network">Monad Testnet</span></header>;
}

function StrategyCard({ strategy, onSelect }) {
  const hasNav = Number.isFinite(strategy.pnlBps);
  return <article className="strategy-card"><div className="strategy-card-top"><span>{strategy.status}</span><b className={strategy.risk.toLowerCase()}>{strategy.risk} risk</b></div><h2>{strategy.name}</h2><p>{strategy.description}</p><dl><div><dt>전략가</dt><dd>{strategy.manager}</dd></div><div><dt>제출 / 정산</dt><dd>{strategy.settledRounds} epoch</dd></div><div><dt>{hasNav ? '마지막 snapshot NAV' : '최근 target 제출'}</dt><dd className={hasNav ? (strategy.pnlBps >= 0 ? 'positive' : 'negative') : ''}>{hasNav ? `${strategy.pnlBps >= 0 ? '+' : ''}${strategy.pnlBps.toFixed(2)}%` : (strategy.lastTargetAt ? new Date(strategy.lastTargetAt).toLocaleString('ko-KR') : '대기')}</dd></div></dl><button className="platform-button" onClick={() => onSelect(strategy)}>전략 상세 보기</button></article>;
}

function Explore({ select, strategies }) {
  return <><section className="platform-hero"><small>CONFIDENTIAL QUANT STRATEGIES · TESTNET</small><h1>전략을 선택하고,<br /><em>검증된 실행</em>에 참여하세요.</h1><p>전략 입력은 TEE에서 처리하고, 투자자 자금·지분·추정 NAV는 전략별로 분리합니다.</p><div className="platform-hero-stats"><span><strong>{strategies.length}</strong> 공개 전략</span><span><strong>4</strong> TDX hardware proofs</span><span><strong>1 min</strong> NAV mark interval</span></div></section><section className="platform-section"><div className="platform-heading"><div><small>STRATEGIES</small><h2>전략 목록</h2></div><p>TEE에 새로 등록된 전략과, Monad 테스트넷에서 예치·정산·환매를 검증한 과거 catalog snapshot을 함께 표시합니다. 새 전략은 vault 배포 전까지 입금을 받지 않습니다.</p></div><div className="strategy-grid">{strategies.map(strategy => <StrategyCard key={strategy.id} strategy={strategy} onSelect={select} />)}</div></section></>;
}

function StrategyDetail({ strategy, back, invest }) {
  const hasNav = Number.isFinite(strategy.pnlBps);
  return <section className="platform-detail"><button className="platform-back" onClick={back}>← 전략 목록</button><div className="platform-detail-heading"><div><span>{strategy.status}</span><h1>{strategy.name}</h1><p>{strategy.description}</p></div><div className="platform-detail-target"><small>{hasNav ? 'LAST TESTNET SNAPSHOT' : 'TEE TARGET STATUS'}</small><strong className={hasNav ? (strategy.pnlBps >= 0 ? 'positive' : 'negative') : ''}>{hasNav ? `${strategy.pnlBps >= 0 ? '+' : ''}${strategy.pnlBps.toFixed(2)}%` : '대기'}</strong><span>{strategy.settledRounds} settled / submitted epoch · fee {strategy.feeBps / 100}%</span></div></div><div className="platform-detail-grid"><article><small>ONCHAIN EXECUTION</small><h2>예치 → 정산 → 환매</h2>{strategy.receipts.length ? <ol>{strategy.receipts.map(receipt => <li key={receipt.hash}><span>{receipt.type}</span><a href={`https://testnet.monadscan.com/tx/${receipt.hash}`} target="_blank" rel="noreferrer">{short(receipt.hash)} ↗</a></li>)}</ol> : <p>이 전략은 플랫폼 DB에 등록됐고 온체인 rolling vault 배포를 기다리고 있습니다.</p>}</article><article><small>TEE / PERPL</small><h2>통합 epoch 대기</h2><p>현재 전략별 Vault 회계와 TDX proof 기반 Perpl 실행은 각각 테스트넷 검증을 마쳤습니다. 다음 epoch부터 target 제출, Perpl 체결, 1분 mark NAV를 하나의 전략 이력으로 연결합니다.</p><button className="platform-button" onClick={invest}>테스트 AUSD 배정 준비</button></article></div></section>;
}

function Investor({ setPage }) {
  return <section className="platform-empty"><small>INVESTOR PORTFOLIO</small><h1>내 전략 지분과<br />추정 NAV</h1><p>지갑 연결과 첫 통합 testnet epoch가 시작되면 여기서 전략별 지분, 1분 mark 기준 추정 PnL, 다음 환매 가능 시점을 확인합니다.</p><div className="platform-empty-card"><strong>Epoch 참여는 마감 전 예치, epoch 종료 후 환매로 처리됩니다.</strong><span>현재 공개 실행은 proof-gated Perpl 왕복과 sleeves 회계가 별도 증거로 존재하는 단계입니다.</span></div><button className="platform-button" onClick={() => setPage('explore')}>전략 둘러보기</button></section>;
}

function Manager({ onRefresh }) {
  const [state, setState] = useState({ address: '', sessionToken: '', apiKey: '', message: '', busy: false, strategyId: '', strategySlug: '' });
  const [form, setForm] = useState({
    name: '',
    bio: '',
    id: '',
    strategyName: '',
    description: '',
    risk: 'HIGH',
    feeBps: 2000,
    periodStart: '2026-08-01T00:00',
    periodEnd: '2026-09-30T00:00',
    navStart: '1000000',
    navEnd: '1154000',
    returnBps: 1540,
    source: 'Monad Testnet Backtest',
    evidenceUri: 'https://mm-zkquant.vercel.app/#/demo'
  });
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const fail = error => setState(current => ({ ...current, busy: false, message: error.message || String(error) }));

  async function signedAuthorization() {
    if (!window.ethereum) throw Error('브라우저 지갑이 필요합니다.');
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const challenge = await platformRequest('/v1/auth/challenge', { method: 'POST', body: JSON.stringify({ address }) });
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [challenge.message, address] });
    return { address, nonce: challenge.nonce, signature };
  }

  async function enroll() {
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      const authorization = await signedAuthorization();
      const session = await platformRequest('/v1/auth/verify', { method: 'POST', body: JSON.stringify(authorization) });
      await platformRequest('/v1/strategists', { method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}` }, body: JSON.stringify({ displayName: form.name, bio: form.bio }) });
      const key = await platformRequest('/v1/api-keys', { method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}` }, body: JSON.stringify({}) });
      setState(current => ({ ...current, address: session.wallet, sessionToken: session.sessionToken, apiKey: key.apiKey, message: 'API key가 발급되었습니다. 지금 복사해 보관하세요.', busy: false, strategyId: '' }));
    } catch (error) { fail(error); }
  }

  async function createStrategy(event) {
    event.preventDefault();
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      const result = await platformRequest('/v1/strategies', { method: 'POST', headers: { Authorization: `Bearer ${state.apiKey}` }, body: JSON.stringify({ slug: form.id, name: form.strategyName, description: form.description, risk: form.risk, feeBps: Number(form.feeBps) }) });
      setState(current => ({ ...current, busy: false, strategyId: result.id, strategySlug: result.slug, message: `${result.name} 전략이 플랫폼 DB에 등록되었습니다. (ID: ${result.slug})` }));
      if (onRefresh) onRefresh();
    } catch (error) { fail(error); }
  }

  async function recordPerformance(event) {
    event.preventDefault();
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      const start = new Date(form.periodStart).toISOString();
      const end = new Date(form.periodEnd).toISOString();
      const result = await platformRequest(`/v1/strategies/${state.strategyId}/performance-records`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.apiKey}` },
        body: JSON.stringify({
          periodStart: start,
          periodEnd: end,
          navStart: String(form.navStart),
          navEnd: String(form.navEnd),
          returnBps: Number(form.returnBps),
          source: form.source,
          evidenceUri: form.evidenceUri
        })
      });
      setState(current => ({ ...current, busy: false, message: `과거 성과 기록이 등록되었습니다. (수익률: ${(result.return_bps / 100).toFixed(2)}%, 출처: ${result.source})` }));
      if (onRefresh) onRefresh();
    } catch (error) { fail(error); }
  }

  return (
    <section className="platform-manager">
      <small>STRATEGIST CONSOLE · PLATFORM API</small>
      <h1>전략을 등록하고<br />과거 성과를 공개하세요.</h1>
      <p>지갑 서명으로 전략가 프로필을 생성하고 API key를 발급받습니다. 등록된 전략과 과거 실적 근거는 플랫폼 DB에 안전하게 보관되고 투자자에게 공개됩니다.</p>
      <div className="manager-grid">
        <article>
          <span>01</span>
          <h2>전략가 등록 · API key</h2>
          <label>표시 이름
            <input required value={form.name} onChange={event => update('name', event.target.value)} placeholder="예: Seongmin Quant" />
          </label>
          <label>공개 소개
            <textarea required value={form.bio} onChange={event => update('bio', event.target.value)} placeholder="전략 운영 철학 및 소개" />
          </label>
          <button className="platform-button" disabled={state.busy || !form.name || !form.bio} onClick={enroll}>
            지갑 서명 후 key 발급
          </button>
          {state.apiKey && (
            <>
              <small className="manager-key-label">한 번만 표시되는 API key</small>
              <code className="manager-key">{state.apiKey}</code>
            </>
          )}
        </article>
        <article>
          <span>02</span>
          <h2>전략 공개 등록</h2>
          <form onSubmit={createStrategy}>
            <label>전략 ID (slug)
              <input required pattern="^[a-z][a-z0-9-]{2,47}$" value={form.id} onChange={event => update('id', event.target.value)} placeholder="btc-momentum" />
            </label>
            <label>전략명
              <input required value={form.strategyName} onChange={event => update('strategyName', event.target.value)} placeholder="BTC Momentum" />
            </label>
            <label>설명
              <textarea required value={form.description} onChange={event => update('description', event.target.value)} placeholder="투자자에게 공개할 설명" />
            </label>
            <div className="manager-row">
              <label>위험도
                <select value={form.risk} onChange={event => update('risk', event.target.value)}>
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </label>
              <label>수수료 (bps)
                <input type="number" min="0" max="2000" value={form.feeBps} onChange={event => update('feeBps', event.target.value)} />
              </label>
            </div>
            <button className="platform-button" disabled={state.busy || !state.apiKey}>
              플랫폼에 전략 등록
            </button>
          </form>
        </article>
        <article>
          <span>03</span>
          <h2>과거 성과 등록</h2>
          <form onSubmit={recordPerformance}>
            <label>기간 시작
              <input type="datetime-local" required value={form.periodStart} onChange={event => update('periodStart', event.target.value)} />
            </label>
            <label>기간 종료
              <input type="datetime-local" required value={form.periodEnd} onChange={event => update('periodEnd', event.target.value)} />
            </label>
            <div className="manager-row">
              <label>시작 NAV
                <input required pattern="^[0-9]+$" value={form.navStart} onChange={event => update('navStart', event.target.value)} placeholder="1000000" />
              </label>
              <label>종료 NAV
                <input required pattern="^[0-9]+$" value={form.navEnd} onChange={event => update('navEnd', event.target.value)} placeholder="1154000" />
              </label>
            </div>
            <label>수익률 (bps, 100 = 1%)
              <input type="number" required value={form.returnBps} onChange={event => update('returnBps', event.target.value)} placeholder="1540" />
            </label>
            <label>검증 출처
              <input required value={form.source} onChange={event => update('source', event.target.value)} placeholder="Monad Testnet Backtest" />
            </label>
            <label>증거 URI
              <input required value={form.evidenceUri} onChange={event => update('evidenceUri', event.target.value)} placeholder="https://mm-zkquant.vercel.app/#/demo" />
            </label>
            <button className="platform-button" disabled={state.busy || !state.strategyId}>
              과거 성과 등록
            </button>
          </form>
          <p>등록된 성과는 전략 상세 화면에서 투자자에게 공개 검증 근거로 표시됩니다.</p>
        </article>
      </div>
      {state.message && <div className="manager-note"><strong>플랫폼 응답:</strong> {state.message}</div>}
      <div className="manager-note">
        <strong>현재 연동 상태:</strong> 지갑 세션 인증, 전략가 프로필, API key 발급, 전략 및 과거 성과 등록이 PostgreSQL DB API로 연동되어 작동합니다. 온체인 rolling vault 배포와 TEE target execution은 다음 단계에서 연결됩니다.
      </div>
    </section>
  );
}

export default function Platform() {
  const [page, setPage] = useState('explore');
  const [selected, setSelected] = useState(null);
  const [teeStrategies, setTeeStrategies] = useState([]);

  const refreshStrategies = () => {
    platformRequest('/v1/strategies').then(result => {
      setTeeStrategies(result.strategies.map(item => ({
        ...item,
        manager: item.strategist_name,
        settledRounds: 0,
        pnlBps: item.pnl_bps === null ? null : Number(item.pnl_bps) / 100,
        target: 'Rolling Epoch Vault',
        receipts: []
      })));
    }).catch(() => {});
  };

  useEffect(() => {
    refreshStrategies();
  }, []);

  const strategies = [...teeStrategies, ...evidenceStrategies];
  const body = selected ? <StrategyDetail strategy={selected} back={() => setSelected(null)} invest={() => { setSelected(null); setPage('invest'); }} /> : page === 'explore' ? <Explore select={setSelected} strategies={strategies} /> : page === 'invest' ? <Investor setPage={setPage} /> : <Manager onRefresh={refreshStrategies} />;
  return <div className="platform-shell"><Header page={page} setPage={setPage} /><main>{body}</main><footer><span>MM-ZKQuant · Monad Testnet</span><a href="#/domains/overview">기술 검토 화면</a><a href="#/demo">검증 증거</a><span>Shared Vault verification: {sleeves.verdict}</span></footer></div>;
}
