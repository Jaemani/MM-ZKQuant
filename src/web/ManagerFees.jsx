import React from "react";
import { Panel, Stat, Badge, Button, RefreshCw } from "./PlatformUI.jsx";
import { money, rate, time, short } from "./platformModel.js";

const paymentMessages = {
  READY: "정산된 보수가 자동 지급을 기다리고 있습니다.",
  CONFIRMING: "지급 거래와 장부 반영을 확인하고 있습니다. 확인 후 누적 지급액에 반영됩니다.",
  SETTLING: "투자자 정산이 진행 중입니다. 정산 완료 후 보수가 자동 지급됩니다.",
  WAITING_CASH: "지급 가능한 현금이 확보되면 자동 지급됩니다. 보수 지급만을 위해 포지션을 강제로 종료하지 않습니다.",
  WAITING_PLATFORM: "플랫폼 연결 또는 실행 상태를 확인 중입니다. 미지급 보수는 장부에 유지됩니다.",
  FAILED: "지급 거래가 실패했습니다. 미지급 보수는 유지되며 플랫폼 확인이 필요합니다.",
};

export default function ManagerFees({ fees, loaded, stale, busy, onRefresh }) {
  return (
    <Panel className="q-manager-fees" aria-labelledby="manager-fees-title">
      <div className="q-row q-fee-heading">
        <div className="q-fee-title">
          <h2 id="manager-fees-title">내 성과보수</h2>
          {fees && <Badge>적용 보수율 {rate(fees.feeBps)}</Badge>}
        </div>
        <Button secondary disabled={busy} onClick={onRefresh} aria-label="성과보수 새로고침">
          <RefreshCw size={15} /> 새로고침
        </Button>
      </div>
      {!fees ? (
        <p className="q-muted q-space" role="status">
          {stale ? "성과보수를 조회하지 못했습니다. 다시 조회해 주세요."
            : loaded ? "성과보수 조회 준비 중입니다. 잠시 후 다시 조회해 주세요."
              : "내 성과보수를 확인하고 있습니다."}
        </p>
      ) : (
        <>
          {stale && <p role="status" className="q-callout q-space">최신 조회가 지연되어 마지막으로 확인한 보수를 표시합니다.</p>}
          <div className="q-stats q-space">
            <Stat label="미정산 예상 보수" value={money(fees.estimated)} suffix="AUSD"
              hint={fees.estimateReason === "SETTLEMENT_IN_PROGRESS" ? "정산 완료 후 다시 계산됩니다."
                : fees.estimateReason ? "최신 평가를 확인한 후 계산됩니다." : "현재 평가액 기준 · 정산 시 확정"} />
            <Stat label="정산 후 미지급" value={money(fees.outstanding)} suffix="AUSD" hint="확정되었으나 아직 받지 않은 보수" />
            <Stat label="누적 지급" value={money(fees.paid)} suffix="AUSD" hint="내 지갑으로 지급이 완료된 보수" />
          </div>
          {paymentMessages[fees.paymentState] && <p className="q-callout q-space" role="status">{paymentMessages[fees.paymentState]}</p>}
          <p className="q-muted q-space">투자 건별 이전 최고 평가액을 초과한 이익에만 보수가 적용됩니다. 예상 보수는 가격과 출금 비용에 따라 달라질 수 있습니다. 정산된 보수는 내 지갑으로 AUSD로 자동 지급됩니다.</p>
          <div className="q-row q-muted q-fee-timing">
            <span>다음 정산 {time(fees.nextSettlementAt)}</span>
            <span>평가 확인 {time(fees.valuedAt)}</span>
          </div>
          <h3 className="q-space">최근 지급 내역</h3>
          {fees.payments.length ? (
            <ul className="q-fee-payments">
              {fees.payments.map(payment => (
                <li key={payment.txHash}>
                  <div>
                    <strong>{money(payment.amount)} AUSD</strong>
                    <span className="q-muted">{payment.paidAt ? `확인 ${time(payment.paidAt)}` : payment.blockNumber ? `블록 #${payment.blockNumber.toLocaleString("ko-KR")}` : "확인 시각 미기록"}</span>
                  </div>
                  <div>
                    <Badge tone={payment.status === "PAID" ? "success" : "warning"}>{payment.status === "PAID" ? "지급 완료" : "장부 반영 중"}</Badge>
                    <a className="q-text-link" href={`https://testnet.monadexplorer.com/tx/${payment.txHash}`} target="_blank" rel="noreferrer" aria-label={`성과보수 지급 거래 ${payment.txHash} 확인`}>{short(payment.txHash)} ↗</a>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="q-muted q-space">{fees.historyComplete ? "아직 지급된 성과보수가 없습니다." : "상세 지급 기록을 확인할 수 없습니다."}</p>}
          {fees.historyCount > 20 && <p className="q-muted q-space">전체 {fees.historyCount}건 중 최근 20건을 표시합니다.</p>}
          {!fees.historyComplete && <p className="q-muted q-space">일부 과거 지급의 상세 기록이 없습니다. 누적 지급액은 전체 정산 장부 기준입니다.</p>}
        </>
      )}
    </Panel>
  );
}
