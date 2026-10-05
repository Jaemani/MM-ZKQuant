import React, { useState } from "react";
import { nextSettlement } from "../platform/policy.js";
import { usePlatform } from "./PlatformContext.jsx";
import { money, time, statusLabel, portfolioTotals } from "./platformModel.js";
import {
  PageTitle,
  Panel,
  Stat,
  Empty,
  Button,
  Link,
  Badge,
  Modal,
  RefreshCw,
  ArrowRight,
  Clock,
} from "./PlatformUI.jsx";
export function PortfolioSummary() {
  const p = usePlatform(),
    t = portfolioTotals(p.portfolio?.positions || []),
    pnl = t.active + t.pending + t.paid - t.deposited;
  return (
    <div className="q-stats">
      <Stat
        label="운용 평가액"
        value={p.portfolio ? money(t.active.toString()) : "—"}
        suffix="AUSD"
        hint="성과보수 반영"
      />
      <Stat
        label="누적 손익"
        value={p.portfolio && t.hasPnl ? money(pnl.toString()) : "—"}
        suffix="AUSD"
        tone={pnl < 0n ? "negative" : "positive"}
        hint="지급 완료액 포함 · 현금 흐름 반영"
      />
      <Stat
        label="운용 시작 대기"
        value={p.portfolio ? money(t.pending.toString()) : "—"}
        suffix="AUSD"
        hint="다음 목표 제출부터 운용"
      />
    </div>
  );
}
export function PortfolioGate() {
  const p = usePlatform();
  return (
    <Empty
      title={
        p.session
          ? "내 자산을 확인해 주세요"
          : "로그인하고 내 자산을 확인하세요"
      }
      description={
        p.session
          ? "개인 투자 내역은 지갑 서명으로 비공개 조회합니다. 조회 전에는 금액을 표시하지 않습니다."
          : "한 계정으로 투자와 전략 운용을 함께 관리할 수 있습니다."
      }
      action={
        <Button
          disabled={p.busy || !p.config}
          onClick={p.session ? p.reloadPortfolio : p.login}
        >
          {p.session ? "지갑 서명으로 자산 조회" : "지갑으로 로그인"}
        </Button>
      }
    />
  );
}
export function PositionList() {
  const p = usePlatform(),
    [exit, setExit] = useState(null),
    [percent, setPercent] = useState(100);
  if (!p.portfolio) return <PortfolioGate />;
  if (!p.portfolio.positions.length)
    return (
      <Empty
        title="첫 투자를 시작해 보세요"
        description="전략가의 성과와 자기자본, 운용 조건을 비교하고 투자할 전략을 선택하세요."
        action={
          <Link to="/strategies" className="q-button">
            전략 찾아보기 <ArrowRight size={16} />
          </Link>
        }
      />
    );
  const s = exit && p.strategies.find((s) => s.id === exit.position.strategyId),
    settlement = s?.policy
      ? nextSettlement(s.policy, Math.floor(Date.now() / 1000))
      : null;
  return (
    <>
      <div className="q-position-list">
        {p.portfolio.positions.map((position) => {
          const strategy = p.strategies.find(
              (s) => s.id === position.strategyId,
            ),
            pendingWithdrawal = (position.withdrawals || []).some(
              (w) =>
                w.kind === "PENDING" &&
                ["REQUESTED", "SETTLING"].includes(w.status),
            ),
            activeWithdrawal = (position.withdrawals || []).some(
              (w) =>
                w.kind !== "PENDING" &&
                ["REQUESTED", "SETTLING"].includes(w.status),
            );
          const pnl =
            position.deposited === undefined
              ? null
              : BigInt(position.value) +
                BigInt(position.pending) +
                BigInt(position.paid) -
                BigInt(position.deposited);
          return (
            <Panel key={position.strategyId}>
              <div className="q-row">
                <div>
                  <Link
                    to={
                      strategy ? `/strategies/${strategy.slug}` : "/strategies"
                    }
                    className="q-position-name"
                  >
                    {strategy?.name || "내 투자 전략"}
                  </Link>
                  <p className="q-muted">{strategy?.strategist_name}</p>
                </div>
                <Badge tone={position.status === "HALTED" ? "warning" : ""}>
                  {BigInt(position.units) > 0n
                    ? statusLabel(position.status)
                    : BigInt(position.pending) > 0n
                      ? "운용 시작 대기"
                      : "투자 종료"}
                </Badge>
              </div>
              <div className="q-position-stats">
                <Stat
                  label="운용 평가액"
                  value={money(position.value)}
                  suffix="AUSD"
                />
                <Stat
                  label="누적 손익"
                  value={money(pnl?.toString())}
                  suffix="AUSD"
                  tone={pnl !== null && pnl < 0n ? "negative" : "positive"}
                />
                <Stat
                  label="운용 시작 대기"
                  value={money(position.pending)}
                  suffix="AUSD"
                />
              </div>
              <div className="q-row q-wrap">
                <div className="q-actions">
                  {strategy && (
                    <Link
                      className="q-button secondary"
                      to={`/strategies/${strategy.slug}`}
                    >
                      추가 투자
                    </Link>
                  )}
                  <Button
                    secondary
                    disabled={
                      p.busy ||
                      BigInt(position.units) === 0n ||
                      activeWithdrawal
                    }
                    onClick={() => {
                      setPercent(100);
                      setExit({ position, pending: false });
                    }}
                  >
                    운용 자금 출금
                  </Button>
                  <Button
                    secondary
                    disabled={
                      p.busy ||
                      BigInt(position.pending) === 0n ||
                      pendingWithdrawal
                    }
                    onClick={() => setExit({ position, pending: true })}
                  >
                    대기 자금 출금
                  </Button>
                </div>
                <details className="q-muted">
                  <summary>투자 상세</summary>
                  <p>누적 입금 {money(position.deposited)} AUSD</p>
                  <p>지급 완료 {money(position.paid)} AUSD</p>
                  <p>정산 보수 {money(position.fees)} AUSD</p>
                  <p>미정산 보수 {money(position.accruedFee)} AUSD</p>
                </details>
              </div>
              {(position.withdrawals || []).map((w) => (
                <div className="q-withdrawal" key={w.id}>
                  <Clock size={17} />
                  <div>
                    <strong>
                      {w.kind === "PENDING" ? "대기 자금" : "운용 자금"} 출금 ·{" "}
                      {statusLabel(w.status)}
                    </strong>
                    <p>
                      정산 예정 {time(w.settlementAt)}
                      {w.amount ? ` · ${money(w.amount)} AUSD` : ""}
                    </p>
                    {w.status === "REQUESTED" && (
                      <p>취소 가능 {time(w.cutoffAt)}까지</p>
                    )}
                    {w.error && (
                      <p className="q-error">
                        지급 확인이 지연되고 있습니다. 자산 조회를 다시 시도해
                        주세요.
                      </p>
                    )}
                  </div>
                  {w.txHash ? (
                    <a
                      className="q-text-link"
                      href={`https://testnet.monadscan.com/tx/${w.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      지급 거래 ↗
                    </a>
                  ) : w.status === "REQUESTED" &&
                    Date.now() < w.cutoffAt * 1000 ? (
                    <button
                      className="q-text-link"
                      disabled={p.busy}
                      onClick={() => p.cancelWithdrawal(position, w)}
                    >
                      신청 취소
                    </button>
                  ) : null}
                </div>
              ))}
            </Panel>
          );
        })}
      </div>
      {exit && (
        <Modal
          title={exit.pending ? "대기 자금 출금" : "운용 자금 출금 신청"}
          busy={p.busy}
          onClose={() => setExit(null)}
        >
          <p>{s?.name || "내 투자 전략"}</p>
          {!exit.pending && (
            <label className="q-field">
              출금 비율 (%)
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
              />
            </label>
          )}
          <div className="q-confirm-amount">
            {money(
              exit.pending
                ? exit.position.pending
                : (
                    (BigInt(exit.position.value) *
                      BigInt(Number.isInteger(percent) ? percent : 0)) /
                    100n
                  ).toString(),
            )}{" "}
            <small>AUSD</small>
          </div>
          <p className="q-muted">
            {exit.pending ? "대기 자금 전액" : "현재 평가액 기준 예상 금액"} ·
            실제 지급액은 정산 시 확정됩니다.
          </p>
          <dl className="q-definition">
            <div>
              <dt>정산 예정</dt>
              <dd>{time(settlement)}</dd>
            </div>
            <div>
              <dt>취소 마감</dt>
              <dd>
                {s?.policy
                  ? time(settlement - s.policy.withdrawalCutoffSeconds)
                  : "확인 중"}
              </dd>
            </div>
          </dl>
          <p className="q-callout">
            출금은 정해진 정산 시점에 지급됩니다. 운용 자금의 출금 비용과
            성과보수는 정산 결과에 반영됩니다.
          </p>
          {p.message?.error && (
            <p className="q-error" role="alert">
              {p.message.text}
            </p>
          )}
          <Button
            className="q-full"
            disabled={
              p.busy ||
              !Number.isInteger(percent) ||
              percent < 1 ||
              percent > 100 ||
              !settlement
            }
            onClick={async () => {
              const result = await p.withdraw(
                exit.position,
                percent,
                exit.pending,
              );
              if (result) setExit(null);
            }}
          >
            출금 신청 확인
          </Button>
        </Modal>
      )}
    </>
  );
}
export default function InvestorPortal() {
  const p = usePlatform();
  return (
    <>
      <PageTitle
        eyebrow="MY ASSETS"
        title="내 자산"
        description="운용 중인 자금과 시작 대기 자금, 출금 일정을 확인하세요."
        action={
          p.session && (
            <Button secondary disabled={p.busy} onClick={p.reloadPortfolio}>
              <RefreshCw size={16} />
              지갑 서명으로 새로고침
            </Button>
          )
        }
      />
      <PortfolioSummary />
      {p.portfolio && (
        <p className="q-data-time">
          마지막 자산 조회{" "}
          {new Date(p.portfolio.queriedAt).toLocaleString("ko-KR")}
        </p>
      )}
      <PositionList />
      {!!p.portfolio?.deposits.length && (
        <Panel>
          <h2>입금 내역</h2>
          <div className="q-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>전략</th>
                  <th>금액</th>
                  <th>상태</th>
                  <th>일시</th>
                  <th>거래</th>
                </tr>
              </thead>
              <tbody>
                {p.portfolio.deposits.map((d) => (
                  <tr key={d.depositId}>
                    <td>
                      {p.strategies.find((s) => s.id === d.strategyId)?.name ||
                        "내 투자 전략"}
                    </td>
                    <td>{money(d.amount)} AUSD</td>
                    <td>
                      {d.status === "CONFIRMED" ? "입금 완료" : "입금 준비"}
                    </td>
                    <td>{time(d.confirmedAt || d.createdAt)}</td>
                    <td>
                      {d.txHash ? (
                        <a
                          href={`https://testnet.monadscan.com/tx/${d.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          확인 ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
