import { formatUnits } from "ethers";
export const money = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(formatUnits(String(value), 6)).toLocaleString("ko-KR", {
        maximumFractionDigits:
          Math.abs(Number(formatUnits(String(value), 6))) > 0 &&
          Math.abs(Number(formatUnits(String(value), 6))) < 0.01
            ? 6
            : 2,
      });
export const rate = (value) =>
  Number.isFinite(value) ? `${(value / 100).toFixed(2)}%` : "집계 전";
export const percent = (value) =>
  Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}%`
    : "집계 전";
export const short = (value) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
export const time = (value) =>
  value
    ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
        "ko-KR",
        { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
      )
    : "—";
export const riskLabel = (value) =>
  ({ LOW: "낮음", MEDIUM: "보통", HIGH: "높음" })[value] || value;
export const statusLabel = (value) =>
  ({
    FUNDING: "투자 모집 중",
    LIVE: "운용 중",
    ACTIVE: "운용 중",
    HALTED: "운용 중단",
    RISK_EXIT: "포지션 정리 중",
    QUEUED: "접수 완료",
    EXECUTING: "실행 확인 중",
    EXECUTED: "실행 완료",
    PARTIALLY_FILLED: "부분 체결",
    EXPIRED: "유효 시간 만료",
    FAILED: "실행 실패",
    REQUESTED: "정산 대기",
    SETTLING: "정산 중",
    PAID: "지급 완료",
    CANCELLED: "취소 완료",
    DRAFT: "준비 중",
  })[value] || "상태 확인 필요";
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
