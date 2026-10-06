import React, { useState } from "react";
import CashPanel from './CashPanel.jsx';
import LedgerProofPanel from "./LedgerProofPanel.jsx";
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
    cash=BigInt(p.portfolio?.cash?.total||0),total=t.active+t.pending+cash,
    pnl = p.portfolio?.externalDeposited!==undefined?total+BigInt(p.portfolio.externalWithdrawn)-BigInt(p.portfolio.externalDeposited):t.active+t.pending+t.paid-t.deposited;
  return (
    <div className="q-stats">
      <Stat
        label="Total assets"
        value={p.portfolio ? money(total.toString()) : "—"}
        suffix="AUSD"
        hint="Cash, pending allocation and investments"
      />
      <Stat
        label="Total investment P&L"
        value={p.portfolio && t.hasPnl ? money(pnl.toString()) : "—"}
        suffix="AUSD"
        tone={pnl < 0n ? "negative" : "positive"}
        hint="Includes withdrawn funds and external cash flows"
      />
      <Stat
        label="Pending allocation"
        value={p.portfolio ? money(t.pending.toString()) : "—"}
        suffix="AUSD"
        hint="Starts with the next target submission"
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
          ? "Check your assets"
          : "Sign in to view your assets"
      }
      description={
        p.session
          ? "Your account privately retrieves investment records from the TEE. Refresh to check your assets."
          : "Invest and manage strategies with one account."
      }
      action={
        <Button
          disabled={p.busy || !p.config}
          onClick={p.session ? p.reloadPortfolio : p.login}
        >
          {p.session ? "Refresh assets" : "Sign in"}
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
        title="Make your first allocation"
        description="Compare performance, own capital and investment conditions to choose a strategy."
        action={
          <Link to="/strategies" className="q-button">

            Explore strategies <ArrowRight size={16} />
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
                    {strategy?.name || "My strategy"}
                  </Link>
                  <p className="q-muted">{strategy?.strategist_name}</p>
                </div>
                <Badge tone={position.status === "HALTED" ? "warning" : ""}>
                  {BigInt(position.units) > 0n
                    ? statusLabel(position.status)
                    : BigInt(position.pending) > 0n
                      ? "Pending allocation"
                      : "Investment ended"}
                </Badge>
              </div>
              <div className="q-position-stats">
                <Stat
                  label="Investment value"
                  value={money(position.value)}
                  suffix="AUSD"
                />
                <Stat
                  label="Total investment P&L"
                  value={money(pnl?.toString())}
                  suffix="AUSD"
                  tone={pnl !== null && pnl < 0n ? "negative" : "positive"}
                />
                <Stat
                  label="Pending allocation"
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

                      Allocate more
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
                    Redeem investment
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
                    Return pending allocation
                  </Button>
                </div>
                <details className="q-muted">
                  <summary>Investment details</summary>
                  <p>Lifetime allocated {money(position.deposited)} AUSD</p>
                  <p>Redeemed {money(position.paid)} AUSD</p>
                  <p>Settled fees {money(position.fees)} AUSD</p>
                  <p>Accrued fees {money(position.accruedFee)} AUSD</p>
                </details>
              </div>
              {(position.withdrawals || []).map((w) => (
                <div className="q-withdrawal" key={w.id}>
                  <Clock size={17} />
                  <div>
                    <strong>
                      {w.kind === "PENDING" ? "Pending allocation" : "Invested capital"}  redemption ·{" "}
                      {statusLabel(w.status)}
                    </strong>
                    <p>

                      Scheduled settlement {time(w.settlementAt)}
                      {w.amount ? ` · ${money(w.amount)} AUSD` : ""}
                    </p>
                    {w.status === "REQUESTED" && (
                      <p>Cancel before {time(w.cutoffAt)}</p>
                    )}
                    {w.error && (
                      <p className="q-error">

                        Payment confirmation is delayed. Refresh your assets to check progress.
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

                      Payment transaction ↗
                    </a>
                  ) : w.status === "REQUESTED" &&
                    Date.now() < w.cutoffAt * 1000 ? (
                    <button
                      className="q-text-link"
                      disabled={p.busy}
                      onClick={() => p.cancelWithdrawal(position, w)}
                    >

                      Cancel request
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
          title={exit.pending ? "Return pending allocation" : "Request redemption"}
          busy={p.busy}
          onClose={() => setExit(null)}
        >
          <p>{s?.name || "My strategy"}</p>
          {!exit.pending && (
            <label className="q-field">

              Redeem percentage (%)
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
            {exit.pending ? "All pending allocation" : "Estimated at current valuation"}  · The final amount is determined at settlement.
          </p>
          <dl className="q-definition">
            <div>
              <dt>Scheduled settlement</dt>
              <dd>{time(settlement)}</dd>
            </div>
            <div>
              <dt>Cancellation cutoff</dt>
              <dd>
                {s?.policy
                  ? time(settlement - s.policy.withdrawalCutoffSeconds)
                  : "Checking"}
              </dd>
            </div>
          </dl>
          <p className="q-callout">
            Proceeds return to your platform balance at settlement. Trading costs and performance fees are included in the final amount.
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
            Confirm redemption
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
        title="My assets"
        description="Track platform cash, investments, pending allocations and redemptions."
        action={
          p.session && (
            <Button secondary disabled={p.busy} onClick={p.reloadPortfolio}>
              <RefreshCw size={16} />
              Refresh assets
            </Button>
          )
        }
      />
      <PortfolioSummary />
      <CashPanel />
      <LedgerProofPanel />
      {p.portfolio && (
        <p className="q-data-time">

          Assets last updated{" "}
          {new Date(p.portfolio.queriedAt).toLocaleString("en-US")}
        </p>
      )}
      <PositionList />
      {!!p.portfolio?.deposits.length && (
        <Panel>
          <h2>Deposit history</h2>
          <div className="q-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {p.portfolio.deposits.map((d) => (
                  <tr key={d.depositId}>
                    <td>
                      {p.strategies.find((s) => s.id === d.strategyId)?.name ||
                        (d.strategyId ? "My strategy" : "Platform balance")}
                    </td>
                    <td>{money(d.amount)} AUSD</td>
                    <td>
                      {d.status === "CONFIRMED" ? "Confirmed" : "Prepared"}
                    </td>
                    <td>{time(d.confirmedAt || d.createdAt)}</td>
                    <td>
                      {d.txHash ? (
                        <a
                          href={`https://testnet.monadscan.com/tx/${d.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >

                          View ↗
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
