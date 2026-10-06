import { formatUnits } from "ethers";
export const money = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(formatUnits(String(value), 6)).toLocaleString("en-US", {
        maximumFractionDigits:
          Math.abs(Number(formatUnits(String(value), 6))) > 0 &&
          Math.abs(Number(formatUnits(String(value), 6))) < 0.01
            ? 6
            : 2,
      });
export const rate = (value) =>
  Number.isFinite(value) ? `${(value / 100).toFixed(2)}%` : "Not available";
export const percent = (value) =>
  Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}%`
    : "Not available";
export const short = (value) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
export const time = (value) =>
  value
    ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
        "en-US",
        { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
      )
    : "—";
export const riskLabel = (value) =>
  ({ LOW: "Low", MEDIUM: "Medium", HIGH: "High" })[value] || value;
export const statusLabel = (value) =>
  ({
    FUNDING: "Open for investment",
    LIVE: "Invested",
    ACTIVE: "Invested",
    HALTED: "Trading halted",
    RISK_EXIT: "Closing positions",
    QUEUED: "Accepted",
    EXECUTING: "Confirming execution",
    EXECUTED: "Executed",
    PARTIALLY_FILLED: "Partially filled",
    EXPIRED: "Expired",
    FAILED: "Failed",
    REQUESTED: "Awaiting settlement",
    SETTLING: "Settling",
    PAID: "Paid",
    CANCELLED: "Cancelled",
    DRAFT: "Preparing",
  })[value] || "Check status";
export const investable = (s) =>
  ["FUNDING", "LIVE"].includes(s.status) &&
  !["HALTED", "RISK_EXIT"].includes(s.public_metrics?.status);
export function portfolioTotals(positions) {
  return positions.reduce(
    (a, p) => {
      a.active += BigInt(p.value || 0);
      a.pending += BigInt(p.pending || 0);
      a.paid += BigInt(p.paid || 0);
      if (p.deposited === undefined) a.hasPnl = false;
      else a.deposited += BigInt(p.deposited);
      return a;
    },
    { active: 0n, pending: 0n, paid: 0n, deposited: 0n, hasPnl: true },
  );
}
export function periodReturn(history, period, now = Date.now()) {
  const rows = [...history]
    .filter((r) => Number.isFinite(r.metrics?.pnlBps))
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const duration = { "1d": 86400000, "7d": 604800000, "30d": 2592000000 }[
    period
  ];
  if (
    rows.length < 2 ||
    (duration &&
      Date.parse(rows[0].observed_at) >
        now - duration + Math.min(duration * 0.02, 3600000))
  )
    return null;
  const first = rows[0].metrics.pnlBps,
    last = rows.at(-1).metrics.pnlBps;
  return first <= -10000
    ? null
    : ((10000 + last) / (10000 + first)) * 10000 - 10000;
}

export function durationLabel(seconds) {
  if(seconds%86400===0)return `${seconds/86400} day${seconds===86400?'':'s'}`;
  if(seconds%3600===0)return `${seconds/3600} hour${seconds===3600?'':'s'}`;
  return `${seconds/60} minute${seconds===60?'':'s'}`;
}
