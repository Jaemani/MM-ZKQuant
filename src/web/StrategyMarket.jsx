import React from "react";
import { Link, Badge, ArrowRight, Stat } from "./PlatformUI.jsx";
import { durationLabel, money, percent, riskLabel, statusLabel, time } from "./platformModel.js";
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
          <div className="q-market-byline"><span>{s.strategist_name}</span><div className="q-market-row-status"><StrategyStatus strategy={s} /><span className="q-market-mobile-risk">Risk {riskLabel(s.risk)}</span></div></div>
          <p>{s.description}</p>
        </div>
        <div className={`q-market-return ${returnTone(m?.pnlBps)}`}><small>Total return</small>{percent(m?.pnlBps)}</div>
        <div className="q-market-capital"><small>Own capital · AUSD</small>{money(m?.managerActive)}</div>
        <div className="q-market-fee"><small>Performance fee</small>{s.fee_bps / 100}%</div>
        <div className="q-market-risk"><small>Risk</small>{riskLabel(s.risk)}</div>
      </Link>
      <label className="q-market-compare" title={compareDisabled ? "Compare up to 3 strategies" : "Add to comparison"}>
        <input type="checkbox" aria-label={`${s.name} Compare`} checked={compare} disabled={compareDisabled} onChange={() => onCompare(s.id)} />
        <span>Compare</span>
      </label>
    </div>
  );
}
export function StrategyInspector({ strategy: s }) {
  const m = s.public_metrics;
  return <>
    <div className="q-inspector-heading">
      <div className="q-row"><StrategyStatus strategy={s} /><span className="q-muted">Risk {riskLabel(s.risk)}</span></div>
      <h2>{s.name}</h2>
      <p className="q-inspector-manager">{s.strategist_name}</p>
      <p className="q-inspector-description">{s.description}</p>
    </div>
    <div className="q-inspector-stats">
      <Stat label="Total return" value={percent(m?.pnlBps)} tone={returnTone(m?.pnlBps)} />
      <Stat label="Own capital" value={money(m?.managerActive)} suffix="AUSD" />
      <Stat label="Performance fee" value={`${s.fee_bps / 100}%`} />
    </div>
    <div className="q-inspector-observed"><span>Last observation</span><span>{s.marked_at ? time(s.marked_at) : "Not available"}</span></div>
    <div className="q-inspector-policy">
      <h3>Investment conditions</h3>
      <dl>
        <div><dt>Maximum leverage</dt><dd>{s.policy.maxLeverageBps / 10000}×</dd></div>
        <div><dt>Stop loss limit</dt><dd>{s.policy.stopLossBps / 100}%</dd></div>
        <div><dt>Maximum drawdown limit</dt><dd>{s.policy.maxDrawdownBps / 100}%</dd></div>
        <div><dt>Settlement frequency</dt><dd>{durationLabel(s.policy.settlementPeriodSeconds)}</dd></div>
      </dl>
    </div>
    <Link to={`/strategies/${s.slug}`} className="q-inspector-detail-link">

      View strategy details <ArrowRight size={16} aria-hidden="true" />
    </Link>
    <InvestmentPanel key={s.id} strategy={s} />
    <p className="q-inspector-note">Monad Testnet · Trading uses test AUSD.<br />Public performance is a TEE aggregate. Ledger arithmetic is verified separately by ZK proofs.</p>
  </>;
}
