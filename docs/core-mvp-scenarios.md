# 코어 MVP 검토 시나리오

2026-09-23. 목적은 승인된 거래만 실행되고, 실제 체결을 기준으로 상태를 읽으며, 실패 시 자금이 잘못 이동하지 않는지 확인하는 것이다. 수익률이나 투자 성과를 평가하는 시연이 아니다.

## 실행과 준비

```sh
npm ci
npm run build:perpl-zk
npm run prove:perpl:atomic
npm run verify:perpl -- docs/evidence/perpl-atomic-mvp.json
```

기존 TEE 배포와 연결할 때는 먼저 [별도 TEE 절차](core-mvp.md#실제-tee-재현)를 따른다. 회로 재빌드는 proving key를 바꾸므로 기존 TEE manifest와 그대로 호환되지 않는다. 위 기본 시연에는 유료 TEE나 지갑의 실제 자금이 필요하지 않다. 공개 RPC 접근은 필요하다.

실행 결과는 `docs/evidence/perpl-atomic-mvp.json`이다. `transactions`는 로컬 체인의 채굴 영수증, `observations`는 목표와 실제 포지션, `proofs`는 승인 증명, `atomicity`는 내부 호출과 실패 전후 상태다. 기록된 JSON을 보는 것과 직접 재실행하는 것을 구분한다.

## 검토 순서

| 순서 | 행동과 질문 | 보여줄 데이터 | 합격 기준 |
|---|---|---|---|
| 1. 자금 분리 | A/B에 각각 1,000 AUSD 테스트 담보를 넣는다. 누구의 계정인가? | `accounts`: label, 계약 주소, Perpl accountId, allocation | 서로 다른 계약·계정, 정확한 입금, 불필요한 allowance 없음 |
| 2. 정상 승인 | A가 목표 +100 lot을 승인한다. 승인과 거래가 실제로 연결되는가? | `proofs`, 첫 `observations`, `atomicity.successfulExecutions`의 trace | verifier true 이후 같은 트랜잭션에서 Perpl IOC 호출, 실제 매수 체결 |
| 3. 잘못된 승인 | 목표 변조·B 계정 재사용·허위 현재 포지션·nonce 재사용을 시도한다. 우회 가능한가? | `checks`, `mined-invalid-proof-rejected` 영수증 | 거절되며 자금·nonce가 잘못 바뀌지 않음. 일부 반례는 staticCall/회로 검사임을 표시 |
| 4. 미체결 | A의 목표는 200이지만 체결 불가능한 가격을 낸다. 목표를 체결로 착각하는가? | A의 두 번째 관측: target 200, before 100, after 100 | 실제 포지션 100 유지, 사용한 요청은 재사용 불가 |
| 5. 부분 체결 | 추가 100 lot 요청에 상대 주문은 25 lot만 제공한다. 얼마나 보유하는가? | A의 세 번째 관측: target 200, before 100, after 125 | 실제 125로 확인. 로컬 maker 25 lot을 준비했다는 조건 공개 |
| 6. 다른 Product | A 거래가 B의 자금을 바꾸는가? | `B-capital-unchanged-after-A-trade`, `B-unchanged-after-zero-and-partial-fill`; B의 별도 -100→0 관측 | A 거래 동안 B 불변, B는 자신의 승인으로 별도 거래 |
| 7. 회수 | A는 실제 125 lot을 닫고, B도 전량 닫는다. 투자자에게 돌아오는가? | 마지막 포지션 0, `recover-A/B` 영수증, `recoveries` | 두 계정 모두 실제 회수액 > 0. 포지션 보유 중 회수·권한 없는 회수·중복 회수 거절 |
| 8. 실행 중 실패 | A 담보를 회수한 뒤 유효한 증명으로 다시 거래한다. 승인만 통과하면 상태가 꼬이는가? | `atomicity.venueFailure`: verifier true, Perpl revert, status 0, before/after | nonce·계정·포지션·AUSD 잔액 동일. 가스는 소비됨 |

## 기술 판단

**현재 코어 범위는 통과했다.** 6개 성공 주문 모두 단일 트랜잭션 내부에서 증명 검증→Perpl 호출 순서가 확인됐고, 거래소가 실패한 경우 상태 변경이 함께 취소됐다. TDX에서 만든 증명이 거래 계약에서 사용되는 연결은 별도 [하드웨어 실행 기록](evidence/perpl-tee-mvp.json)에 있다. 이 추가 원자성 검사 자체의 증명은 로컬에서 생성했다.

**제품 전체가 기술적으로 검증된 것은 아니다.** 다음 항목은 별도 합격이 필요하다.

| 남은 단계 | 완료의 기준 |
|---|---|
| 공개 Monad 테스트넷 거래 | 실제 테스트 토큰으로 배포·입금·거래·회수하고 공개 체인에서 영수증을 다시 조회한다. 현재 계약은 chain 31337 제한이라 별도 테스트넷 배포 설계가 필요하다. |
| 실제 시간·실패 대응 | 오라클 갱신/지연, 만료, 증명 생성 중 상태 변화, RPC timeout 및 중복 제출에도 잘못된 체결·회계가 없음을 확인한다. |
| TEE 운영 경로 | 실제 전략 입력 처리, 내부 relayer, 키 갱신과 재시작 복구, 장기 상태 연속성을 확인한다. |
| 장부와 정산 | 부분 체결·입출금에 맞는 Ledger transition, Product별 자본·지분·보수의 보존을 검증한다. |
| 공유 계정·출구 | slot 귀속 프라이버시, 비동기 증거금 해제, 출금 혼잡·청산·강제 종료를 검증한다. |

이 시나리오의 범위는 실행 코어 검토다. 공유 Single Vault 기반 완제품, 비공개 귀속, 투자자 지분 정산까지 되는 것처럼 시연하지 않는다.
