import React, { useState } from "react";
import { nextSettlement } from "../platform/policy.js";
import { usePlatform } from "./PlatformContext.jsx";
import { money, time, investable } from "./platformModel.js";
import {
  Button,
  Panel,
  Modal,
  Wallet,
  Clock,
  CheckCircle2,
  Link,
} from "./PlatformUI.jsx";
export default function InvestmentPanel({ strategy, manager = false }) {
  const p = usePlatform(),
    [amount, setAmount] = useState(""),
    [confirm, setConfirm] = useState(false),
    [done, setDone] = useState(false);
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0;
  const unavailable = !investable(strategy);
  return (
    <Panel id="q-investment" className="q-invest-panel">
      <h2>{manager ? "Allocate own capital" : "Invest in this strategy"}</h2>
      {p.session && p.portfolio && BigInt(p.portfolio.cash?.available||0)===0n && <p className="q-callout">Add funds to your platform balance first. <Link className="q-text-link" to="/assets">Go to assets →</Link></p>}
      <p className="q-muted">Allocated funds wait for the next target submission.</p>
      <ol className="q-invest-steps" aria-label="Allocation progress">
        <li className={done ? "complete" : "active"} aria-current={!done ? "step" : undefined}><span>1</span>Allocate</li>
        <li className={done ? "active" : ""} aria-current={done ? "step" : undefined}><span>2</span>Pending</li>
        <li><span>3</span>Trading starts</li>
      </ol>
      {done ? (
        <div className="q-success">
          <CheckCircle2 size={28} />
          <h3>Allocation confirmed</h3>
          <p>Your allocation is waiting for trading to start.</p>
          <Link className="q-button" to="/assets">

            View my assets
          </Link>
          <Button
            secondary
            onClick={() => {
              setDone(false);
              setAmount("");
            }}
          >

            Allocate more
          </Button>
        </div>
      ) : (
        <>
          <label className="q-field">

            Allocation amount
            <div className="q-amount-input">
              <input
                aria-label="Allocation amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-describedby="investment-hint"
                aria-invalid={!!amount && (!valid || (p.portfolio?.cash?.available != null && Number(amount) > Number(p.portfolio.cash.available) / 1e6))}
              />
              <span>AUSD</span>
            </div>
          </label>
          <div className="q-row q-muted">
            <span>Available balance {money(p.portfolio?.cash?.available)} AUSD</span>
            {p.session && (
              <button
                className="q-text-link"
                disabled={p.busy}
                onClick={p.reloadPortfolio}
              >
                Refresh balance
              </button>
            )}
          </div>
          {!valid && amount && (
            <p className="q-error" role="alert">

              Enter a positive amount with up to six decimal places.
            </p>
          )}
          {p.portfolio?.cash?.available != null &&
            valid &&
            Number(amount) > Number(p.portfolio?.cash?.available) / 1e6 && (
              <p className="q-error">Your platform balance is insufficient.</p>
            )}
          <dl className="q-invest-conditions">
            <div>
              <dt>Performance fee</dt>
              <dd>{strategy.fee_bps / 100}%</dd>
            </div>
            <div>
              <dt>Next redemption settlement</dt>
              <dd>
                {strategy.policy
                  ? time(
                      nextSettlement(
                        strategy.policy,
                        Math.floor(Date.now() / 1000),
                      ),
                    )
                  : "Checking"}
              </dd>
            </div>
          </dl>
          <p id="investment-hint" className="q-callout">
            <Clock size={16} />

            Trading starts with the strategist's next submission.
          </p>
          {p.session ? (
            <Button
              className="q-full"
              disabled={
                p.busy ||
                unavailable ||
                !valid ||
                !p.config ||
                !p.portfolio ||
                (p.portfolio?.cash?.available != null && Number(amount) > Number(p.portfolio?.cash?.available) / 1e6)
              }
              onClick={() => setConfirm(true)}
            >
              {unavailable ? "Currently unavailable" : "Review allocation"}
            </Button>
          ) : (
            <Button
              className="q-full"
              disabled={p.busy || !p.config}
              onClick={p.login}
            >
              Sign in to invest
            </Button>
          )}
        </>
      )}
      {confirm && (
        <Modal
          title="Review allocation"
          busy={p.busy}
          onClose={() => setConfirm(false)}
        >
          <p className="q-muted">{strategy.name}</p>
          <div className="q-confirm-amount">
            {Number(amount).toLocaleString("en-US")} <small>AUSD</small>
          </div>
          <dl className="q-definition">
            <div>
              <dt>Trading starts</dt>
              <dd>Next target submission</dd>
            </div>
            <div>
              <dt>Performance fee</dt>
              <dd>{strategy.fee_bps / 100}% · gains above the high watermark</dd>
            </div>
            <div>
              <dt>Redemption settlement</dt>
              <dd>
                {time(
                  nextSettlement(
                    strategy.policy,
                    Math.floor(Date.now() / 1000),
                  ),
                )}
              </dd>
            </div>
          </dl>
          <p className="q-callout">
            Funds move from your platform balance to pending allocation. Redemptions return to your balance at the scheduled settlement.
          </p>
          {p.stage && (
            <p role="status" className="q-progress">
              <span className="q-spinner" />
              {p.stage}
            </p>
          )}
          {p.message?.error && (
            <p role="alert" className="q-error">
              {p.message.text}
            </p>
          )}
          <Button
            className="q-full"
            disabled={p.busy}
            onClick={async () => {
              const result = await p.allocate(strategy, amount);
              if (result) {
                setConfirm(false);
                setDone(true);
              }
            }}
          >
            {p.busy ? "Processing…" : "Confirm allocation"}
          </Button>
        </Modal>
      )}
    </Panel>
  );
}
