import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Wallet,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  X,
  RefreshCw,
  TrendingUp,
  Layers,
  Home,
  Settings2,
  SlidersHorizontal,
  ArrowDownToLine,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  durationLabel, money,
  percent,
  time,
  statusLabel,
  riskLabel,
} from "./platformModel.js";
export {
  ArrowUpRight,
  ArrowRight,
  Wallet,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  X,
  RefreshCw,
  TrendingUp,
  Layers,
  Home,
  Settings2,
  SlidersHorizontal,
  ArrowDownToLine,
};
export function navigate(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0, 0);
  }
}
export function Link({ to, children, className = "", ...props }) {
  return (
    <a
      href={to}
      className={className}
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        if (
          !e.defaultPrevented &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          e.button === 0
        ) {
          e.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const change = () => setPath(window.location.pathname);
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  return path;
}
export const Button = ({
  children,
  secondary = false,
  className = "",
  ...props
}) => (
  <button
    className={`q-button ${secondary ? "secondary" : ""} ${className}`}
    {...props}
  >
    {children}
  </button>
);
export const Badge = ({ children, tone = "" }) => (
  <span className={`q-badge ${tone}`}>{children}</span>
);
export function PageTitle({ eyebrow, title, description, action }) {
  return (
    <div className="q-page-title">
      <div>
        {eyebrow && <span className="q-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export const Panel = ({ children, className = "", ...props }) => (
  <section className={`q-panel ${className}`} {...props}>{children}</section>
);
export function Empty({ title, description, action }) {
  return (
    <div className="q-empty">
      <Layers size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export const Stat = ({ label, value, suffix, hint, tone = "" }) => (
  <div className="q-stat">
    <span>{label}</span>
    <strong className={value === "—" || value === "Not available" ? "" : tone}>
      {value}
      <small>{suffix}</small>
    </strong>
    {hint && <p>{hint}</p>}
  </div>
);
export function Modal({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="q-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="q-dialog-title">
        <h2 id={titleId}>{title}</h2>
        <button aria-label="Close" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Conditions({ policy, feeBps }) {
  if (!policy) return <p className="q-muted">Loading investment conditions.</p>;
  return (
    <dl className="q-definition">
      <div>
        <dt>Performance fee</dt>
        <dd>
          {feeBps / 100}% <small>Charged on individual gains above the high watermark</small>
        </dd>
      </div>
      <div>
        <dt>Maximum leverage</dt>
        <dd>{policy.maxLeverageBps / 10000}×</dd>
      </div>
      <div>
        <dt>Stop loss / maximum drawdown limit</dt>
        <dd>
          {policy.stopLossBps / 100}% / {policy.maxDrawdownBps / 100}%
        </dd>
      </div>
      <div>
        <dt>Redemption settlement frequency</dt>
        <dd>
          {durationLabel(policy.settlementPeriodSeconds)}
        </dd>
      </div>
      <div>
        <dt>Redemption cutoff</dt>
        <dd>{policy.withdrawalCutoffSeconds / 60} minutes before settlement</dd>
      </div>
      <div>
        <dt>Order validity / slippage</dt>
        <dd>
          {policy.orderTtlSeconds} seconds / {policy.slippageBps / 100}%
        </dd>
      </div>
    </dl>
  );
}
export function StrategyCard({ strategy, compare, onCompare, compareDisabled = false }) {
  const m = strategy.public_metrics;
  return (
    <article className={`q-strategy-card${compare ? " is-selected" : ""}`}>
      <div className="q-row">
        <Badge tone={["HALTED", "RISK_EXIT"].includes(m?.status) ? "warning" : ["LIVE", "ACTIVE"].includes(m?.status || strategy.status) ? "success" : ""}>
          {statusLabel(m?.status || strategy.status)}
        </Badge>
        <span className="q-muted">Risk {riskLabel(strategy.risk)}</span>
      </div>
      <Link to={`/strategies/${strategy.slug}`} className="q-strategy-name">
        {strategy.name}
        <ArrowUpRight size={18} />
      </Link>
      <p className="q-muted">{strategy.strategist_name}</p>
      <p className="q-card-description">{strategy.description}</p>
      <div className="q-card-return">
        <span>Total return</span>
        <strong className={!Number.isFinite(m?.pnlBps) ? "q-unavailable" : m.pnlBps < 0 ? "negative" : m.pnlBps > 0 ? "positive" : ""}>
          {percent(m?.pnlBps)}
        </strong>
      </div>
      <dl className="q-card-metrics">
        <div>
          <dt>Strategist's own capital</dt>
          <dd>
            {money(m?.managerActive)} <small>AUSD</small>
          </dd>
        </div>
        <div>
          <dt>Performance fee</dt>
          <dd>{strategy.fee_bps / 100}%</dd>
        </div>
        <div>
          <dt>Trading data</dt>
          <dd>{strategy.marked_at ? time(strategy.marked_at) : "Not available"}</dd>
        </div>
      </dl>
      <div className="q-row q-card-actions">
        <Link className="q-text-link" to={`/strategies/${strategy.slug}`}>

          Explore strategy <ArrowRight size={15} />
        </Link>
        {onCompare && (
          <label className="q-checkbox" title={compareDisabled ? "Compare up to 3 strategies. Remove a selected strategy first." : undefined}>
            <input
              type="checkbox"
              checked={compare}
              disabled={compareDisabled}
              aria-label={`${strategy.name} Compare`}
              onChange={() => onCompare(strategy.id)}
            />{" "}

            Compare
          </label>
        )}
      </div>
    </article>
  );
}
export function HistoryChart({ history, capital = false }) {
  const rows = [...history]
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))
    .map((r) => ({
      date: Date.parse(r.observed_at),
      value: capital
        ? r.metrics.managerActive == null ? null : Number(r.metrics.managerActive) / 1e6
        : Number.isFinite(r.metrics.pnlBps) ? r.metrics.pnlBps / 100 : null,
    }))
    .filter((r) => Number.isFinite(r.date));
  if (!rows.some((r) => Number.isFinite(r.value)))
    return (
      <Empty
        title="No history yet"
        description="Charts will show actual observations as trading history grows."
      />
    );
  return (
    <>
      <div
        className="q-chart"
        role="img"
        aria-label={
          capital
            ? "Strategist's own invested capital history"
            : "Reference investor return history"
        }
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={rows}
            margin={{ top: 12, right: 16, bottom: 8, left: 4 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--q-line)" />
            <XAxis
              dataKey="date"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) =>
                new Date(v).toLocaleDateString("en-US", {
                  month: "numeric",
                  day: "numeric",
                })
              }
              minTickGap={45}
              tick={{ fontSize: 12, fill: "var(--q-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              width={58}
              tickFormatter={(v) => (capital ? v.toLocaleString() : `${v}%`)}
              tick={{ fontSize: 12, fill: "var(--q-muted)" }}
              axisLine={false}
              tickLine={false}
              domain={["auto", "auto"]}
            />
            <Tooltip
              labelFormatter={(v) => new Date(v).toLocaleString("en-US")}
              formatter={(v) => [
                `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${capital ? " AUSD" : "%"}`,
                capital ? "Own capital" : "Total return",
              ]}
            />
            <Line
              type="linear"
              dataKey="value"
              stroke="var(--q-primary)"
              strokeWidth={2.5}
              dot={rows.length < 3}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="q-chart-data">
        <summary>View records as a table</summary>
        <div className="q-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Observed at</th>
                <th>{capital ? "Own capital (AUSD)" : "Total return"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.date).toLocaleString("en-US")}</td>
                  <td>
                    {Number.isFinite(r.value) ? r.value.toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    }) : "Not available"}
                    {capital || !Number.isFinite(r.value) ? "" : "%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
