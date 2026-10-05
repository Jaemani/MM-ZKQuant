import React from "react";
import { Link, Badge, ArrowRight, Stat } from "./PlatformUI.jsx";
import { money, percent, riskLabel, statusLabel, time } from "./platformModel.js";
import InvestmentPanel from "./InvestmentPanel.jsx";

function returnTone(value) {
  return !Number.isFinite(value) || value === 0 ? "" : value < 0 ? "negative" : "positive";
}
export function StrategyStatus({ strategy }) {
  const status = strategy.public_metrics?.status || strategy.status;
  const tone = ["HALTED", "RISK_EXIT"].includes(status) ? "warning" : ["LIVE", "ACTIVE"].includes(status) ? "success" : "";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}
export function StrategyRow({ strategy: s, active, onInspect, compare, onCompare, compareDisabled }) {
  const m = s.public_metrics;
  return (
    <div role="listitem" className={`q-market-row${active ? " active" : ""}${compare ? " compared" : ""}`}>
      <Link className="q-market-row-link" to={`/strategies/${s.slug}`}
        aria-current={active ? "true" : undefined}
        onClick={event => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0 && window.matchMedia("(min-width: 1180px)").matches) {
            event.preventDefault(); onInspect();
          }
        }}>
        <div className="q-market-identity">
          <strong>{s.name}</strong>
          <div className="q-market-byline"><span>{s.strategist_name}</span><div className="q-market-row-status"><StrategyStatus strategy={s} /><span className="q-market-mobile-risk">위험 {riskLabel(s.risk)}</span></div></div>
          <p>{s.description}</p>
        </div>
        <div className={`q-market-return ${returnTone(m?.pnlBps)}`}><small>누적 수익률</small>{percent(m?.pnlBps)}</div>
        <div className="q-market-capital"><small>자기자본 · AUSD</small>{money(m?.managerActive)}</div>
        <div className="q-market-fee"><small>성과보수</small>{s.fee_bps / 100}%</div>
        <div className="q-market-risk"><small>위험</small>{riskLabel(s.risk)}</div>
      </Link>
      <label className="q-market-compare" title={compareDisabled ? "최대 3개까지 비교할 수 있습니다" : "전략 비교에 추가"}>
        <input type="checkbox" aria-label={`${s.name} 비교`} checked={compare} disabled={compareDisabled} onChange={() => onCompare(s.id)} />
        <span>비교</span>
      </label>
    </div>
  );
}
export function StrategyInspector({ strategy: s }) {
  const m = s.public_metrics;
  return <>
    <div className="q-inspector-heading">
      <div className="q-row"><StrategyStatus strategy={s} /><span className="q-muted">위험 {riskLabel(s.risk)}</span></div>
      <h2>{s.name}</h2>
      <p className="q-inspector-manager">{s.strategist_name}</p>
      <p className="q-inspector-description">{s.description}</p>
    </div>
    <div className="q-inspector-stats">
      <Stat label="누적 수익률" value={percent(m?.pnlBps)} tone={returnTone(m?.pnlBps)} />
      <Stat label="자기자본" value={money(m?.managerActive)} suffix="AUSD" />
      <Stat label="성과보수" value={`${s.fee_bps / 100}%`} />
    </div>
    <div className="q-inspector-observed"><span>마지막 관측</span><span>{s.marked_at ? time(s.marked_at) : "집계 전"}</span></div>
    <div className="q-inspector-policy">
      <div className="q-row"><h3>운용 조건</h3><Link to={`/strategies/${s.slug}`} className="q-text-link">성과·조건 상세 <ArrowRight size={14} /></Link></div>
      <dl>
        <div><dt>최대 레버리지</dt><dd>{s.policy.maxLeverageBps / 10000}배</dd></div>
        <div><dt>손절 한도</dt><dd>{s.policy.stopLossBps / 100}%</dd></div>
        <div><dt>최대 낙폭 한도</dt><dd>{s.policy.maxDrawdownBps / 100}%</dd></div>
        <div><dt>정산 주기</dt><dd>{s.policy.settlementPeriodSeconds % 86400 === 0 ? `${s.policy.settlementPeriodSeconds / 86400}일` : `${s.policy.settlementPeriodSeconds / 3600}시간`}</dd></div>
      </dl>
    </div>
    <InvestmentPanel key={s.id} strategy={s} />
    <p className="q-inspector-note">Monad Testnet · 테스트 AUSD로 운용됩니다.<br />공개 성과는 TEE 집계이며 ZK 검증 성과는 아닙니다.</p>
  </>;
}
