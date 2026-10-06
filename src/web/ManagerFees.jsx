import React from "react";
import { Panel, Stat, Badge, Button, RefreshCw } from "./PlatformUI.jsx";
import { money, rate, time, short } from "./platformModel.js";

const paymentMessages = {
  READY: "Settled fees are waiting for automatic payment.",
  CONFIRMING: "Checking the payment transaction and ledger update. Confirmed payments will appear in the lifetime total.",
  SETTLING: "Investor settlement is in progress. Fees are paid automatically afterwards.",
  WAITING_CASH: "Fees are paid when cash is available. Positions are not forcibly closed solely to pay fees.",
  WAITING_PLATFORM: "Checking platform connection or execution status. Unpaid fees remain in the ledger.",
  FAILED: "Payment failed. Unpaid fees are retained and need platform review.",
};

export default function ManagerFees({ fees, loaded, stale, busy, onRefresh }) {
  return (
    <Panel className="q-manager-fees" aria-labelledby="manager-fees-title">
      <div className="q-row q-fee-heading">
        <div className="q-fee-title">
          <h2 id="manager-fees-title">My performance fees</h2>
          {fees && <Badge>Current fee rate {rate(fees.feeBps)}</Badge>}
        </div>
        <Button secondary disabled={busy} onClick={onRefresh} aria-label="Refresh performance fees">
          <RefreshCw size={15} />  Refresh
        </Button>
      </div>
      {!fees ? (
        <p className="q-muted q-space" role="status">
          {stale ? "Could not load performance fees. Try again."
            : loaded ? "Preparing fee information. Try again shortly."
              : "Checking your performance fees."}
        </p>
      ) : (
        <>
          {stale && <p role="status" className="q-callout q-space">Latest update delayed. Showing the last confirmed fee information.</p>}
          <div className="q-stats q-space">
            <Stat label="Estimated accrued fees" value={money(fees.estimated)} suffix="AUSD"
              hint={fees.estimateReason === "SETTLEMENT_IN_PROGRESS" ? "Recalculated after settlement."
                : fees.estimateReason ? "Calculated after valuation is available." : "Based on current valuation · finalized at settlement"} />
            <Stat label="Settled and unpaid" value={money(fees.outstanding)} suffix="AUSD" hint="Finalized fees awaiting payment" />
            <Stat label="Lifetime paid" value={money(fees.paid)} suffix="AUSD" hint="Fees confirmed as paid to your wallet" />
          </div>
          {paymentMessages[fees.paymentState] && <p className="q-callout q-space" role="status">{paymentMessages[fees.paymentState]}</p>}
          <p className="q-muted q-space">Fees apply only to gains above each allocation's previous high watermark. Estimates vary with prices and redemption costs. Settled fees are paid automatically in AUSD to your wallet.</p>
          <div className="q-row q-muted q-fee-timing">
            <span>Next settlement {time(fees.nextSettlementAt)}</span>
            <span>Valuation checked {time(fees.valuedAt)}</span>
          </div>
          <h3 className="q-space">Recent payments</h3>
          {fees.payments.length ? (
            <ul className="q-fee-payments">
              {fees.payments.map(payment => (
                <li key={payment.txHash}>
                  <div>
                    <strong>{money(payment.amount)} AUSD</strong>
                    <span className="q-muted">{payment.paidAt ? `View ${time(payment.paidAt)}` : payment.blockNumber ? `Block #${payment.blockNumber.toLocaleString("en-US")}` : "Confirmation time unavailable"}</span>
                  </div>
                  <div>
                    <Badge tone={payment.status === "PAID" ? "success" : "warning"}>{payment.status === "PAID" ? "Paid" : "Updating ledger"}</Badge>
                    <a className="q-text-link" href={`https://testnet.monadexplorer.com/tx/${payment.txHash}`} target="_blank" rel="noreferrer" aria-label={`Performance fee payment transaction ${payment.txHash} View`}>{short(payment.txHash)} ↗</a>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="q-muted q-space">{fees.historyComplete ? "No performance fee payments yet." : "Detailed payment records are unavailable."}</p>}
          {fees.historyCount > 20 && <p className="q-muted q-space">All {fees.historyCount}payments; showing the most recent 20.</p>}
          {!fees.historyComplete && <p className="q-muted q-space">Some older payment details are unavailable. Lifetime paid uses the full settlement ledger.</p>}
        </>
      )}
    </Panel>
  );
}
