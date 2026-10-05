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
      <h2>{manager ? "자기자본 추가" : "이 전략에 투자"}</h2>
      <p className="q-muted">입금한 자금은 다음 목표 제출부터 운용됩니다.</p>
      <ol className="q-invest-steps" aria-label="투자 진행 순서">
        <li className={done ? "complete" : "active"} aria-current={!done ? "step" : undefined}><span>1</span>입금</li>
        <li className={done ? "active" : ""} aria-current={done ? "step" : undefined}><span>2</span>운용 대기</li>
        <li><span>3</span>운용 시작</li>
      </ol>
      {done ? (
        <div className="q-success">
          <CheckCircle2 size={28} />
          <h3>입금이 완료되었습니다</h3>
          <p>현재는 운용 시작 대기 상태입니다.</p>
          <Link className="q-button" to="/assets">
            내 자산 확인
          </Link>
          <Button
            secondary
            onClick={() => {
              setDone(false);
              setAmount("");
            }}
          >
            추가 투자
          </Button>
        </div>
      ) : (
        <>
          <label className="q-field">
            투자 금액
            <div className="q-amount-input">
              <input
                aria-label="투자 금액"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-describedby="investment-hint"
                aria-invalid={!!amount && (!valid || (p.balance !== null && Number(amount) > Number(p.balance) / 1e6))}
              />
              <span>AUSD</span>
            </div>
          </label>
          <div className="q-row q-muted">
            <span>지갑 잔액 {money(p.balance)} AUSD</span>
            {p.session && (
              <button
                className="q-text-link"
                disabled={p.busy}
                onClick={p.refreshBalance}
              >
                잔액 확인
              </button>
            )}
          </div>
          {!valid && amount && (
            <p className="q-error" role="alert">
              0보다 큰 금액을 소수점 6자리까지 입력하세요.
            </p>
          )}
          {p.balance !== null &&
            valid &&
            Number(amount) > Number(p.balance) / 1e6 && (
              <p className="q-error">지갑 잔액이 부족합니다.</p>
            )}
          <dl className="q-invest-conditions">
            <div>
              <dt>성과보수</dt>
              <dd>{strategy.fee_bps / 100}%</dd>
            </div>
            <div>
              <dt>다음 출금 정산</dt>
              <dd>
                {strategy.policy
                  ? time(
                      nextSettlement(
                        strategy.policy,
                        Math.floor(Date.now() / 1000),
                      ),
                    )
                  : "확인 중"}
              </dd>
            </div>
          </dl>
          <p id="investment-hint" className="q-callout">
            <Clock size={16} />
            운용 시작 시각은 전략가의 다음 제출에 따라 정해집니다.
          </p>
          {p.session ? (
            <Button
              className="q-full"
              disabled={
                p.busy ||
                unavailable ||
                !valid ||
                !p.config ||
                (p.balance !== null && Number(amount) > Number(p.balance) / 1e6)
              }
              onClick={() => setConfirm(true)}
            >
              {unavailable ? "현재 투자할 수 없습니다" : "투자 내용 확인"}
            </Button>
          ) : (
            <Button
              className="q-full"
              disabled={p.busy || !p.config}
              onClick={p.login}
            >
              <Wallet size={17} /> 로그인하고 투자하기
            </Button>
          )}
        </>
      )}
      {confirm && (
        <Modal
          title="투자 내용 확인"
          busy={p.busy}
          onClose={() => setConfirm(false)}
        >
          <p className="q-muted">{strategy.name}</p>
          <div className="q-confirm-amount">
            {Number(amount).toLocaleString("ko-KR")} <small>AUSD</small>
          </div>
          <dl className="q-definition">
            <div>
              <dt>운용 시작</dt>
              <dd>다음 목표 제출부터</dd>
            </div>
            <div>
              <dt>성과보수</dt>
              <dd>{strategy.fee_bps / 100}% · 최고 평가액 초과 이익 기준</dd>
            </div>
            <div>
              <dt>출금 정산</dt>
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
            입금 확인 후에는 대기 자금으로 표시됩니다. 운용 전 자금도 정해진
            출금 일정에 따라 지급됩니다.
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
              const result = await p.deposit(strategy, amount);
              if (result) {
                setConfirm(false);
                setDone(true);
              }
            }}
          >
            {p.busy ? "처리 중…" : "지갑에서 승인하고 입금"}
          </Button>
        </Modal>
      )}
    </Panel>
  );
}
