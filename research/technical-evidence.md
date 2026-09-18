# ZK Alpha Market — 운용·증명·백테스트 검증 근거

조회일: 2026-09-16 (Asia/Seoul). 범위: 본 조사 E/F/G와 D의 proof-runtime 전제. **[사실]**은 확인한 1차 자료, **[추론]**은 그 자료를 바탕으로 한 제품/설계 판단, **[Unknown]**은 현재 증거로 확인되지 않은 항목이다. 이 문서는 proof benchmark나 실제 자금 운용 실험의 결과가 아니다.

## 핵심 판정

1. **[추론] mandatory epoch + state transition은 선택적 누락을 없애지 않는다.** 누락을 관찰 가능하게 하고, 누락한 뒤 정상 연속 이력으로 돌아오는 일을 차단할 수 있다. 비밀 전략과 실행 권한을 혼자 가진 creator에게 실행·제출·체결을 강제할 수는 없다. 규칙은 `모든 epoch에 증명이 나온다`가 아니라 `모든 epoch가 성공/HOLD/기한 초과/실행 실패 중 하나로 영구 기록된다`여야 한다. 누락은 HOLD도, 수익률 0도 아니다. [T1–T3, T9–T10에서 도출]
2. **[사실] zkVM이라는 이름만으로 모든 proof format의 영지식성이 보장되지는 않는다.** SP1 공식 security model은 개별 STARK proof가 현재 ZK 성질을 충족하지 않는다고 명시하고, Groth16/PLONK wrapper는 ZK라고 구분한다. Core/compressed proof를 공개하면서 비밀 전략이 보호된다고 주장하면 안 된다. [T4]
3. **[추론] image ID / verification key는 프로그램 식별과 실행 무결성의 결박이다.** 비공개 ELF에 대한 검증 자체가 원천 불가능하다는 뜻은 아니다. 그러나 hash만 보고 그 프로그램이 어떤 입력을 받아 어떤 제약 아래 작동하는지 알 수 없고, code secrecy의 위협 모델도 해결되지 않는다. 공개 검토된 제한 interpreter와 private committed artifact를 분리하면 보장의 의미가 더 명확하다. [T1–T4]
4. **[사실] 외부 prover는 기본적으로 witness를 본다.** RISC Zero가 직접 명시한다. SP1의 TEE Private Proving은 별도 Phala TEE 경로이고 조회 시점 문서상 private beta/Enterprise이다. 해당 workflow는 program을 S3로, encrypted inputs를 TEE로 보낸다고 설명한다. 따라서 secret program을 ELF로 올리면 비밀 입력 보호와 다른 문제가 된다. [T3, T6]
5. **[추론] 현실적인 MVP는 좁은 전략 DSL의 전향적 운용 기록 검증이며, 검증된 수익 창출이나 범용 전략 운용 marketplace가 아니다.** 자금 운용까지 확장할 때는 input authenticity, 실제 fill, withdrawal, emergency unwind, platform/vault risk가 계산 무결성보다 큰 작업이 된다. [T9–T16]

## 1. ZK가 정확히 증명할 명제

권장 public statement의 개념적 형태:

```text
public:
  registry_id, canonical_version, interpreter_image_id,
  epoch_id, previous_accepted_epoch, data_root, data_cutoff,
  previous_private_state_commitment, verified_execution_receipt_root,
  canonical_vault_accounting_state,
  action_or_HOLD, action_expiry, execution_constraints,
  next_pending_private_state_commitment

private witness:
  artifact, artifact_salt, previous_private_state, state_salt,
  canonical_input_data, authenticated_receipts / membership proofs

prove:
  H(artifact_salt || artifact || semantic_config) == registry_commitment
  H(previous_state_salt || previous_private_state) == recorded_state_commitment
  data belongs to the accepted data_root and obeys schema/cutoff rules
  fill reconciliation uses the canonical execution receipt/account state
  action, pending_state = vetted_interpreter(artifact, reconciled_state, data)
  action satisfies the public risk/venue constraints
```

- **[사실]** RISC Zero receipt의 journal은 public output이고 verification은 expected image ID에 대해 수행된다. Host는 공식적으로 untrusted이며 입력을 제공한다. 따라서 guest에 단순히 JSON market data나 fill을 넣었다는 사실만으로 그 데이터가 진짜가 되지는 않는다. [T1–T2]
- **[추론]** artifact는 logic만이 아니라 parameters, warm-up, rounding, precision, NA 처리, asset mapping, 데이터 schema, state schema, runtime/interpreter version을 결박해야 한다. indicator 숫자가 threshold를 넘는 경계에서는 작은 의미 차이가 주문 차이가 된다. Freqtrade 자체도 warm-up/recursive indicator의 backtest/live 차이를 별도로 검사한다. [T14]
- **[추론]** 공개 검토된 interpreter가 external HTTP, clock, randomness, file access를 허용하지 않거나 전부 인증된 입력으로 제한해야 한다. 그렇지 않으면 creator가 `private strategy`라는 명목의 자유 입력으로 원하는 주문을 출력하는 프로그램을 등록해도 실행 proof는 유효하다. 고정된 deterministic artifact를 원한다면 randomness를 없애거나 seed의 결정 규칙까지 사전에 정해야 한다. [T1–T4]
- **[추론]** hash는 등록 후 artifact를 바꿔치기하기 어렵게 만드는 binding 도구다. 작은 후보 집합에 대한 dictionary matching을 숨기는 수단은 아니므로 explicit salted commitment가 낫다. image ID만으로 전략의 의미·독창성·기밀성 전체를 보장한다고 표현하면 안 된다. Interpreter를 공개하고 artifact를 private input으로 두면 buyer는 적어도 허용된 semantics를 검토할 수 있다. [T1–T4]
- **[추론]** registered artifact가 언제 존재했는지의 주장은 등록 transaction의 timestamp/chain finality에 결박해야 한다. 증명 자체가 wall-clock 역사나 투자 가능 시점에 대한 timestamp를 만드는 것은 아니다. 등록된 digest와 실제 실행 artifact의 일치, data release 이후 제때 action이 확정되었음은 서로 다른 검사다. [T1–T2]
- **[추론]** ZK는 정해진 함수가 입력에서 출력을 만들었다고 증명한다. 입력의 경제적 진실, price discovery의 정확성, 미래 profitability, alpha, 독창성, 낮은 tail risk, 유동성, 실행 최선성은 그 명제에 자동 포함되지 않는다. [T1–T4, T9–T16]

## 2. Program secrecy와 input secrecy를 혼동하지 말 것

| 구성 | 확인되는 보장 | 남는 문제 |
|---|---|---|
| 비공개 native guest + 공개 image ID | [사실/추론] verifier는 expected image ID와 receipt로 실행을 검증할 수 있다. 소스 공개를 암호학적으로 항상 요구하는 API는 아니다. | buyer가 guest semantics를 검토하지 못함. image ID는 hiding commitment가 아님. prover에게 ELF를 주면 prover가 code를 봄. 해당 proof mode의 ZK 조건 필요. [T1–T4] |
| 공개 vetted interpreter + private artifact | [추론] interpreter가 commitment, input rules, transition, output schema를 강제. 숨긴 artifact를 같은 규칙으로 반복 실행했다는 주장을 표현하기 쉬움. | interpreter/DSL 설계·감사, computational overhead, 제한된 표현력, output leakage. 원래 Python과 동등하다는 보장은 별도. [T1–T4] |
| 암호화한 artifact를 buyer에게 배포 | [추론] 전달 중 기밀성과 실제 실행 시 기밀성은 다름. 일반 buyer machine에서 복호화 실행하면 extraction 방어가 해결되지 않음. | TEE, remote service, 또는 더 복잡한 암호학적 실행이 필요. 보통 ZK만으로 black-box executable DRM이 되지는 않음. [T3, T6–T8] |
| remote proving | [사실] 일반 prover는 secret witness에 접근한다. [T3] | local proving 또는 별도 private proving/TEE trust. "ZK니까 cloud prover도 못 본다"는 주장은 틀림. |
| SP1 Core/Compressed 공개 | [사실] 공식 security model상 individual STARK proofs는 현재 ZK가 아님. [T4] | 공개 proof format을 Groth16/PLONK 등 실제 ZK 경로로 제한하고, 내부 trace/log도 비공개 관리해야 함. |

**[Unknown]** 선택할 zkVM release, proof mode, prover placement와 해당 구현의 audit 상태를 아직 고정하지 않았다. RISC Zero main의 security model에는 privacy에 대한 caution과 length leakage 조건도 남아 있다. 공식 문서가 존재한다고 이 제품의 confidential execution이 검증된 것은 아니다. [T3]

## 3. 실제 end-to-end 운용 flow

아래는 **[설계 추론]**이며, 구현 완료를 의미하지 않는다. 처음에는 spot, 단일 chain/venue, 일별 또는 시간별 decision, marketable/즉시 종료되는 주문, 작은 universe로 제한한다. 정교한 limit-order inventory strategy는 제외한다.

### 등록과 자금 분리

1. Creator가 로컬에서 private artifact와 deterministic genesis state를 만든다. registry는 salted artifact commitment, public interpreter ID, version, schedule, input provider/schema/cutoff, risk envelope, execution policy를 기록한다.
2. Track record에는 모집 이전 pre-registration일, forward 시작일, 실제 funded live 시작일을 따로 남긴다. 등록 전략 전체와 종료/실패 전략을 보존한다. creator가 천 개를 등록한 뒤 승자 하나만 보여주는 선택 편향은 artifact timestamp만으로 제거되지 않는다.
3. Vault의 custody/accounting/execution controls는 공개된 별도 계층이다. 예: token/venue allowlist, exposure/leverage/notional/turnover limits, target deviation, minimum output, TTL, withdrawal policy. 전략 proof가 있다고 arbitrary external call을 허용하지 않는다.

### 매 epoch

4. 독립 scheduler가 epoch `e`를 예정한다. data publisher가 사전 지정 cutoff까지의 finalized input snapshot을 정해진 방식으로 확정하고 root를 anchor한다. provider의 서명/등록된 key 확인은 provenance를 보장할 뿐 provider가 정확한 시장을 보고했다고 보장하지는 않는다. 데이터 수정·누락·provider outage도 별도 상태로 기록한다.
5. Creator는 직전 private state와 실제 정산 receipt를 reconcile한다. 새 input으로 decision을 계산한다. **HOLD/no-action도 같은 proof를 생성**한다. 그래야 `전략이 아무것도 하지 않음`과 `실행자가 결과를 숨김`을 구분할 수 있다.
6. Deadline 전 decision proof가 registry/vault에 받아들여지면 `DECIDED(e)`가 영구 기록된다. Proof는 epoch, predecessor, data root, commitment, vault/account, nonce, expiry를 결박한다. 과거 proof 재전송·다른 vault 전용·순서 건너뛰기를 거부한다.
7. Keeper가 공개 execution policy에 따라 제한된 주문을 실행한다. proof의 target/action과 actual fill은 별도 기록이다. 가능한 시점 중 유리한 시점만 고르는 keeper discretion도 policy와 execution window로 제한한다. accepted proof 뒤 swap revert가 나더라도 decision 자체가 역사에서 사라지면 안 된다. decision acceptance와 execution success/failure는 분리 기록한다.
8. DEX면 canonical chain에서 transaction receipt, pool event, vault balance/accounting을 확인한다. chain reorg/finality 정책을 정한다. CEX면 executor가 `executionReport`, query order/trades, balances를 대조하고 complete ledger를 attestation해야 한다. Binance의 request signature를 exchange-signed fill receipt로 착각하면 안 된다. [T9–T10]
9. 다음 epoch proof는 실제 filled quantity/price/fee, remaining open orders, cancellations, funding/interest, deposits/withdrawals와 accounting state를 반영한다. 간단한 MVP는 즉시 체결/취소가 확정된 주문만 다루어 settlement-before-next-decision 경계를 명확히 한다. "예상 체결"을 next state에 넣어 실제 P&L과 떨어지는 것을 금지한다.

### 장애와 중단

10. Deadline에 proof가 없으면 creator의 협조 없이 누구나 `MISSED_DECISION(e)`를 확정한다. 연속 정상 이력은 끊기며 늦게 만든 hindsight proof를 on-time proof로 세탁하지 못한다. Missing epoch 뒤에도 복구 운영을 허용한다면 `RECOVERY`/새 segment를 명시하고 원래 이력을 유지한다.
11. Execution attempt 후 fill이 없으면 `EXECUTION_FAILED` 또는 `EXPIRED`다. 미제출과 다른 원인이므로 분리한다. 모든 failure에서도 mark-to-market NAV는 이어진다. orphan position을 숨기거나 손익을 0으로 보간하지 않는다.
12. Creator outage 때 autonomous continuation을 원하면 다른 주체가 code와 최신 private state를 얻을 수 있어야 한다. encrypted backup + 별도 키/TEE/escrow/failover는 추가 trust/design이다. **오직 creator만 secret을 보유하면서 creator가 영구 offline이어도 같은 secret strategy가 계속 실행된다는 보장은 이 구조에서 성립하지 않는다.**
13. Emergency reduce-only/unwind/withdrawal은 독립 executor가 public policy로 수행한다. 이것은 원전략의 action이라고 주장하지 않고 platform override로 기록한다. 유동성 부족·체인 장애에서는 즉시 청산도 보장되지 않는다.
14. Upgrade는 새 commitment/version과 사전 activation epoch를 쓴다. 기존 투자자의 opt-in 또는 출금 기회를 설계하고, legacy version의 record를 새 버전에 붙여서 같은 전략의 장기 live 성과로 표시하지 않는다. private state migration도 vetted migration relation 또는 reset/new segment로 처리한다.

### 이 flow가 보장하지 않는 것

- **[추론] Liveness:** ZK prover가 꺼지거나 결과를 보류하면 proof는 저절로 나오지 않는다. slashable bond/SLA는 경제적 억제이며 강제 계산 증명이 아니다. 의도적 누락과 진짜 장애의 동기도 proof 부재만으로 구별할 수 없다.
- **[추론] Selective publication의 완전 제거:** deadline, expected epoch, all-registered-strategy history가 없으면 선택된 proof만 게시할 수 있다. 이들을 도입해도 abort가 가능하며, 실패를 숨기지 못하게 할 뿐이다.
- **[추론] Actual fill guarantee:** decision proof는 fill을 만들지 않는다. DEX는 consensus/custody와 연결하기 쉽고 CEX는 exchange·executor·attester 신뢰가 추가된다. [T9–T10]
- **[추론] Output secrecy:** public vault의 orders/positions와 오래 쌓인 actions는 전략을 추정할 단서를 준다. ZK는 public outputs의 정보 자체를 숨기지 않는다. 반환한 signal은 buyer가 저장·분석·재배포할 수 있다. [T1, T9–T10]

### 사전 gate와 사후 audit / 시간예산

- **[추론] Before-trade proof:** vault가 proof를 검증한 뒤에만 주문을 허용하면, accepted transition을 따르지 않는 주문을 사전에 차단할 수 있다. 대신 데이터 확정→proof→transaction inclusion→execution이 전략의 latency budget 안에 들어가야 한다. `data publication/finality + local computation + proof + proof verification/transaction inclusion + execution`의 전체 P99를 측정해야 하며 proof time 하나만 측정하면 부족하다. [T1, T9–T10, T16]
- **[추론] Ex-post proof:** 나중에 같은 historical input으로 artifact를 재실행하고 proof를 생성하는 것은 계산 경로 재구성의 증거다. 그 당시 intent가 확정됐거나 그 시간에 실행됐다는 증거가 아니다. 사전 action commitment/timestamp 및 실제 fill record가 따로 있어야 한다. TEE live execution + delayed ZK는 그 둘을 적절히 결박하는 별도 trust model이지 ZK-gated execution과 같은 상품이 아니다. [T1–T6]
- **[추론] Proof amortization:** 여러 buyer에게 같은 market-data-based signal을 주면 공통 signal proof 하나를 공유할 수 있다. 그러나 전략이 actual positions/fills/cash flow를 next state로 사용하면 vault마다 state commitment와 action이 다르므로 해당 state-transition proof를 그대로 재사용할 수 없다. 공통 alpha proof와 vault별 portfolio/risk/execution proof를 분리해 일부 계산을 공유하거나 하나의 pooled vault를 쓰는 설계는 가능하지만 상품·accounting이 달라진다. [T1–T2, T9–T10]

## 4. Signal 판매와 vault 운용의 기술적 차이

| 항목 | Signal subscription | Capital in vault |
|---|---|---|
| 증명할 canonical output | creator의 timestamped target/signal | target + 실제 vault execution/accounting |
| 실제 execution 책임 | buyer 또는 buyer broker/bot | 명시된 keeper/executor 및 vault policy |
| P&L 귀속 | buyer별 latency, fills, fee tier, sizing, leverage가 달라 하나의 실현 수익률 보장 불가 | 같은 share-class/accounting이면 실제 realized/MTM NAV를 공통으로 산출하기 쉬움 |
| 전략 자체 state | model portfolio 기준인지 실제 account 기준인지 계약에 명시 필요 | actual fills와 balances를 canonical next state에 연결 가능 |
| secrecy | signal은 구매자에게 즉시 누설. downstream sharing 통제 별도 | public orders/positions에서 추론 가능. private code와 private trades는 다름 |
| 주요 trust | signal continuity + buyer own execution | 위 항목에 custody, contract, keeper, oracle, withdrawal 추가 |

표는 [T1, T9–T13]에서 도출한 **[설계 추론]**이다. Signal별 theoretical return을 buyer의 achieved return처럼 표시하면 안 된다. Vault에서도 asset inflow/outflow와 수수료를 반영한 share NAV/time-weighted return 정의를 고정해야 하며, creator strategy P&L과 platform/execution drag를 분리한다.

## 5. zkVM / TEE / trusted executor / commitment / hybrid 비교

| 방식 | 실제로 줄이는 trust | 그대로 남는 trust/부담 | 판단 |
|---|---|---|---|
| Local zkVM + ZK proof mode | 제출된 output이 공개 검증 relation과 사전 commitment를 따랐는지 creator/executor를 믿을 필요 감소 | guest/interpreter correctness, proof system, input provenance, execution/fill, custody, liveness, code/output leakage | [추론] 좁은 deterministic subset에 가능. 현재 artifact별 지연·원가 unknown. [T1–T5] |
| TEE | host/operator가 enclave 내부 data/code를 임의 열람·변경한다는 위험을 hardware isolation/attestation으로 줄임 | AWS/CPU/firmware/hypervisor/attestation chain, code measurement 검토, keys, rollback/freshness, external data와 liveness | [추론] Python/native dependencies 이전 부담을 낮출 수 있으나 ZK와 다른 trust다. Nitro는 외부 network/storage가 없어 parent proxy/지속 상태 구성이 필요. [T7–T8] |
| Centralized trusted executor | creator의 일방적 변경·선택적 실행을 독립 운영자가 통제할 수 있음 | operator가 code/keys를 보고 실행·ledger를 정직하게 관리한다는 신뢰, 보안과 감사 | [추론] 초기 수요 검증에 가장 단순. buyer가 이 운영자를 신뢰하면 ZK 추가 willingness-to-pay는 unknown. |
| Commitment + audited execution | 사후 version 바꿔치기·이력 변경에 대한 증거, 감사 가능한 기록 | commitment 자체는 실행을 증명하지 않음. 감사인이 source/record를 검토하거나 운영자에게 의존 | [추론] ZK가 필요한 고객인지 비교하는 현실적인 기준선. [T1–T3] |
| TEE execution + 후속 ZK batch | live latency를 TEE 경로로 두고 사후 계산 audit 강화 | 주문 전에 ZK를 검증하지 않으면 잘못된 실행을 사전에 막는 보장은 없음. TEE confidentiality trust 남음 | [추론] 지연에 민감한 전략의 별도 상품; ZK-gated execution과 다른 보장. [T4–T8] |
| ZK + independent TEE co-verification | 둘 중 한 경로의 integrity flaw에 대비 | 두 구현/운영 경로·attestation admins 관리. source data가 같으면 data 오류는 공통 실패 | [사실] SP1-2FA가 실제 제공되며, 문서상 whitelist admin trust가 있다. private proving과는 별도 기능. [T5] |

**[사실]** AWS Nitro attestation은 AWS Nitro Attestation PKI가 서명한 문서와 certificate chain에 의존한다. measurement/PCR이 expected code와 맞는지 검증해야 한다. Nitro는 parent instance와만 통신하며 persistent storage, interactive access, external networking이 없고 parent 종료 시 enclave도 종료된다. 이는 "TEE면 data/availability trust도 제거"를 반박한다. [T7–T8]

**[추론]** ZK의 사업적 필요 조건은 구매자가 `creator나 운영자에게 code와 execution의 정직성을 맡길 수 없지만, 지정된 데이터·venue·vault·cryptography는 신뢰할 수 있다`는 구체적 경계에 비용을 지불하는 것이다. 이미 code를 NDA 아래 auditor/hosted executor에 맡기는 구조로 같은 거래가 성립한다면 ZK는 MVP 전제가 아니라 후속 integrity 기능일 수 있다.

## 6. 기존 Python을 그대로 proof 환경에서 실행한다는 가정

- **[사실]** RISC Zero 공식 구현 설명은 Rust에서 ELF로 compile하고 RV32IM 환경에서 실행하는 flow다. SP1도 RISC-V로 compile되는 Rust/C/C++ 등 언어를 설명하고 표준 setup은 Rust crate다. [T1, T15]
- **[추론]** 기존 Freqtrade/LEAN Python 환경을 같은 이름의 Python 파일이라는 이유만으로 proof guest에 넣을 수 없다. CPython/interpreter, NumPy/Pandas/TA-Lib의 native extensions, OS/system calls, network, threading, floating-point semantics를 지원/port하는 문제는 별도다. 이 조사에서 해당 전체 stack의 drop-in production 지원은 확인하지 못했다. **"불가능"과 "공식 drop-in 지원/비용이 확인되지 않음"을 구분한다.**
- **[추론]** 고정한 Python interpreter를 zkVM 안에서 돌리는 연구/구현은 원리적으로 가능하지만, 전체 quant ecosystem과 native libraries를 그대로 지원한다는 결론이나 경제적인 proof라는 결론은 나오지 않는다. 작은 Rust/fixed-point DSL로 로직을 옮기는 편이 검증 명제를 좁히기 쉽다. [T1, T15]
- **[추론]** 네 개의 보장은 구별한다: (1) original code의 같은 runtime 실행; (2) logic을 다른 artifact로 port; (3) frozen data/assumptions에서 finite historical replay agreement; (4) adapted artifact를 새 canonical strategy로 forward 등록. (3)은 (1)이나 모든 미래 입력에 대한 formal equivalence가 아니다. (4)의 integrity는 original과의 동등성 없이도 새 전략의 정직한 forward 기록을 만들 수 있다.
- **[Unknown]** 실제 selected artifact의 cycles, memory, end-to-end P50/P95/P99 proving latency, ZK wrapper overhead, verification cost, cloud-vs-local 원가, worst-case failure가 측정되지 않았다. SP1은 cycle tracking과 prover gas 측정 API, network cost 산식 및 SLA/reserved-capacity 상담을 제공한다. 문서의 일반 benchmark/마케팅 수치를 quant artifact 실측값으로 전용하지 않는다. [T16]

## 7. Backtest: universal engine 가정 기각

### 실제 engine별로 다른 모델

| Engine / 공식 근거 | 확인한 사실 | 제품에 주는 함의 [추론] |
|---|---|---|
| Freqtrade | candle 안 상세 경로가 없어 가정이 필요. 기본 entry는 open; high/low 범위 내 requested price에서 no-slippage fill. current exchange limits/precision을 historical backtest에 적용하는 한계. dynamic pairlist 재현성 경고. [T11] | 같은 논리라도 candle/tick, pair universe, fee와 rounding을 바꾸면 결과가 달라짐. backtest ZK는 가정 아래 계산 무결성만 보장. |
| TradingView Pine | broker emulator가 chart data로 trades를 모사. OHLC proximity로 open→high→low→close 또는 open→low→high→close를 가정. 다음 tick fill, bar magnifier, commission/slippage 옵션. slippage는 dynamic/unpredictable하여 정확한 simulation 불가라고 설명. [T12] | Pine strategy의 order lifecycle과 fill semantics를 port할 때 별도 재현 필요. 단순 indicator translation으로 원본 P&L을 재현한다고 하면 안 됨. |
| QuantConnect/LEAN | security-level fill, slippage, fee, buying power, settlement, option/short availability 등 customizable reality models. default는 highly liquid asset을 가정하며 큰 거래/illiquid asset은 custom model 권고. [T13] | professional quants가 하나의 fill model에 동의한다고 가정하기 어려운 직접 근거. benchmark는 선언된 조건 비교에 한정. |
| LEAN slippage models | Null/Constant/VolumeShare/MarketImpact 등 다수 모델. volume share는 order/bar volume의 제곱과 impact coefficient를 사용. [T13] | capital capacity 변화는 return stream 재계산 문제. 소액 검증 수익률을 큰 AUM에 그대로 적용할 수 없음. |
| HftBacktest | market-data replay에서 주문이 시장을 바꾸지 못해 market impact 미포함. 작은 주문 가정, live test 권고. no-partial/partial fill과 queue 모델 구분. market-by-order 없으면 queue position 추정 필요. feed/order-entry/order-response latency를 별도 모델링. [T17] | order-book MM/HFT에 OHLCV universal benchmark를 쓰는 것은 부적합. 고급 전용 engine조차 live reality 보장하지 않음. |

### 나눠야 할 세 종류의 검증

1. **[추론] Migration replay:** original과 adapted implementation에 같은 historical inputs/initial conditions/assumptions를 주고 indicators→signals→targets→orders를 단계별 비교한다. 첫 divergence, boundary case, rounding, warm-up을 기록한다. 최종 P&L만 비슷하면 성공이 아니다. [T11–T14]
2. **[추론] Standardized screening benchmark:** 소수 liquid crypto spot, closed OHLCV, fixed universe, bounded notional/turnover, 명시한 fees, conservative slippage/stress model 등의 좁은 환경이라면 비교가 유용하다. 그 환경에서의 비교이지 creator의 공식 record를 대체하거나 실현수익을 예측한다는 뜻은 아니다. [T11–T13]
3. **[추론] Forward/live allocation evidence:** prospective artifact 등록, 모든 scheduled outcomes, 실제 funded NAV와 costs, outages/overrides/version changes, live capital 규모를 기록한다. forward paper는 새 데이터에 대한 continuity를 검증하고 live는 실제 fills/costs를 관측하므로 별도 label이 필요하다. [T9–T14, T17]

**[추론]** universal benchmark 없이 forward/live record 중심 상품은 기술적으로 성립한다. 다만 새 creator를 충분히 검증할 시간이 걸리고 historical risk regimes/rare tail events/capacity를 판단할 자료가 부족하다는 cold-start 문제가 생긴다. Backtest는 screening/stress/history 설명용, 충분한 forward와 제한된 funded live는 allocation evidence로 분리하는 편이 타당하다. **Live도 미래 alpha나 새 AUM에서의 capacity를 증명하지 않는다.**

**[Unknown]** 한 달이나 정해진 몇 번의 거래가 allocator의 통계적/운영적 due diligence를 만족한다는 보편적 기준은 확인되지 않았다. 4주 MVP의 성공을 Sharpe 달성이나 수익률로 판정하면 과최적화/선택편향을 부를 수 있다.

## 8. Privacy-preserving DD에서 가능한 계산 범위

본 절은 [T1–T4, T9–T14]에서 도출한 **[설계 추론]**이다.

- commitment로 결박된 **완전한** NAV/return stream에 대한 return, drawdown, volatility, turnover, exposure/risk-limit 준수 등을 proof로 계산할 수 있다. sample selection, cash flows, MTM, valuation source, fees, missing period를 먼저 정해야 한다. selected winning periods에 대한 정확한 metric proof는 투자자를 보호하지 못한다.
- 공개하거나 지연 공개한 return stream이면 strategy code 없이 buyer portfolio와 empirical correlation, rolling beta, factor regression이 가능하다. 단 특정 window의 estimation이고 미래 regime/hidden nonlinear exposure 보장은 아니다.
- code를 공개하지 않고 자산 whitelist, leverage bounds, gross/net exposure, holding-time/turnover bounds를 검증할 수 있다. 직접 관찰한 accounting state 또는 vetted semantics에 제약을 걸어야 하며 arbitrary secret binary의 behavior를 알아서 분석하는 일반 도구는 아니다.
- buyer portfolio와 strategy return 모두를 서로에게 숨기려면 단일 standard prover가 두 private witnesses를 아는 구조와 충돌한다. 한쪽을 공개/지연 공개하거나, trusted enclave/MPC/joint proof 같은 추가 설계가 필요하다. ZK라는 한 단어로 양 당사자의 모든 data privacy가 해결되지 않는다.
- return correlation이나 유사 factor behavior는 경제적 중복의 지표이지 source-code/idea originality proof가 아니다. 다른 전략이 같은 return을 낼 수 있고 같은 전략도 execution/universe/parameters에 따라 달라진다. 이 상품이 보장할 것은 canonical execution과 관측 가능한 portfolio fit까지다.

## 9. 4주 MVP에 넣을 가장 작은 기술적 실험

전체는 **[제안]**이며 기간 내 달성 확정이 아니다.

- **Week 1:** 공개 Rust interpreter 하나, private parameterized rule artifact, 1–2 assets, closed hourly/daily OHLCV, spot long/flat, no external HTTP/ML/funding/order book. registration/version/epoch schema를 고정한다. data publisher trust를 명시한다.
- **Week 2:** 로컬 ZK proof mode로 commitment/state/action/HOLD 검증. wrong artifact, wrong data root, reordered/replayed epoch, corrupted state, missing HOLD, deadline miss를 실제 adversarial test한다. proof costs/latency를 representative + worst-case inputs로 측정한다.
- **Week 3:** independent expected-epoch ledger와 full strategy registry를 운영. 원본 작은 전략과 adapted artifact의 historical replay를 decision/target level로 비교하되 adapted artifact를 새 canonical로 등록한다. paper execution은 하나의 공개 fill policy로만 계산하고 paper label을 붙인다.
- **Week 4:** 최소 1주 이상 forward paper로 모든 epoch의 success/HOLD/miss/failure ledger, version history, synthetic NAV와 실제 proof timings을 대시보드에 표시한다. 선택적으로 testnet vault에서 nonce/expiry/revert/override/fill reconciliation을 검증한다. 실제 고객 자금 운용·allocator-grade long live record는 결과물에 포함시키지 않는다.

**[추론]** 처음부터 custody vault, universal adapters, encrypted executable delivery, every quant framework, private correlation protocol까지 한 번에 만들면 4주 안에 thesis를 반증하는 데 필요한 최소 증거를 얻기 어렵다. 기술 MVP는 narrowly scoped 검증이고 commercial thesis는 별도 유료 고객 증거로 판단해야 한다.

## 10. 기술 Kill / Pivot criteria

- **KILL 해당 보장:** secret과 state를 creator만 보유하면서 creator failure와 의도적 abort에도 무중단 동작을 보장하겠다는 요구를 유지한다. 이는 이 architecture와 모순된다.
- **KILL 해당 보장:** no-miss state transition을 selective execution 제거라고 광고하면서 registry outside attempts, deadline, miss record, recovery/abort policy를 만들지 않는다.
- **KILL 해당 보장:** proof가 exchange fill authenticity, alpha, strategy originality 또는 모든 미래 original/ported equivalence까지 보장한다고 요구한다.
- **PIVOT runtime:** 선정 subset의 실제 end-to-end P99 proof/verification 지연이 사전에 정한 decision-to-order budget을 반복 초과하거나, worst-case cost가 고객 수익 모델에 맞지 않는다. 구체 threshold는 선택한 trading cadence/AUM/fee 기준으로 먼저 고정하고 측정한다. native/TEE execution 또는 더 낮은 frequency로 바꾼다.
- **PIVOT trust:** CEX/publisher/hosted executor 신뢰가 결국 필수이고 고객이 그 trusted baseline과 ZK의 차이에 비용을 지불하지 않는다. integrity ledger/managed-strategy tooling이 더 자연스럽다.
- **PIVOT scope:** canonical artifact를 등록한 뒤 new forward record를 쌓는 creator는 확보되지만 original code의 범용 auto-port가 반복 실패한다. adapter를 제한 DSL SDK/migration assistant로 축소한다.

## 1차 자료와 확인한 발췌

다음 URL은 실제 열람했다. GitHub source는 확인 시점 commit으로 가능한 한 고정했다. 날짜가 최신이어도 문서 내부 오래된 문구/모순 가능성이 있어 release-specific 보장은 별도 확인해야 한다.

### T1 — RISC Zero receipt / image ID

- [Receipts 101](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/receipts.md)
- [zkVM overview](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/zkvm-overview.md)
- 발췌: “The journal attests to the public outputs of the program”; verification: “the guest program that executed was consistent with the expected image ID.” Overview: “the ImageID serves as a cryptographic identifier for the expected ELF binary.”

### T2 — RISC Zero untrusted host / I/O

- [Host Code 101](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/host-code-101.md)
- [Guest Code 101](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/guest-code-101.md)
- 발췌: “The host is an untrusted agent that sets up the zkVM environment and handles inputs/outputs during execution.” Guest는 read inputs / write private outputs to host / commit public outputs to journal을 구별한다.

### T3 — RISC Zero security / prover visibility

- [Cryptographic Security Model](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/security-model.md)
- 발췌: “Whoever is generating the proofs can see the secret data.”
- 발췌: “RISC Zero technology cannot prevent many types of security issues in user guest programs ... or contracts.”
- 해당 문서에는 “targets perfect zero-knowledge”, mathematical argument/engineering changes 관련 caution 및 recursion 전 execution length leakage warning이 남아 있다. 따라서 이 문서만으로 임의 release/proof path의 강한 privacy를 확정하지 않는다.

### T4 — SP1 security model / ZK proof format

- [SP1 Security Model](https://docs.succinct.xyz/docs/sp1/security/security-model)
- 발췌: “While our implementations of Groth16 and PLONK are zero-knowledge, individual STARK proofs in SP1 do not currently satisfy the zero-knowledge property.”
- 발췌: “SP1 only aims to provide proof of correct execution for the user-provided program”; “SP1 assumes that the program compiled into SP1 is non-malicious.”
- [Proof Types](https://docs.succinct.xyz/docs/sp1/generating-proofs/proof-types)는 Core와 Compressed를 STARK proof로 구별한다. 이 페이지의 비용/latency 숫자는 현재 제품 artifact 실측이 아니므로 본 조사에서 성능 주장에 쓰지 않았다. 또한 PLONK trusted setup 표현은 security model의 universal trusted setup 설명을 우선한다.

### T5 — SP1-2FA (integrity hybrid)

- [TEE Two-Factor Authentication](https://docs.succinct.xyz/docs/sp1/prover-network/tee)
- 발췌: “two independent verification paths”; same program/inputs를 ZK와 TEE execution path에서 실행하고 public outputs를 cross-reference.
- 발췌: “SP1-2FA relies on a trusted admin to verify attestations and whitelist signing keys onchain.” private proving과 다른 기능이다.

### T6 — SP1 private proving (confidentiality hybrid)

- [TEE Private Proving](https://docs.succinct.xyz/docs/sp1/prover-network/private-proving)
- 발췌: “powered by the Phala Cloud solution”; “A presigned URL is sent to the client to store the program in S3”; “encrypted proof inputs in the TEE”; “Currently, TEE Private Proving is in private beta and is only available through the Enterprise offering.”

### T7 — AWS Nitro capabilities / limitations

- [What is AWS Nitro Enclaves?](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)
- 발췌: “They have no persistent storage, interactive access, or external networking.” “Enclaves can communicate only with the parent instance.” parent instance terminated/stopped이면 enclave terminated.

### T8 — AWS Nitro attestation root / measurements

- [Verifying the root of trust](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html)
- [Cryptographic attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html)
- 발췌: “Attestation documents are signed by the AWS Nitro Attestation Public Key Infrastructure (PKI).” certificate chain와 COSE signature verification을 요구한다. measurements/PCR와 KMS policy binding을 설명한다.

### T9 — Binance order/fill events and request signing

- [User Data Stream](https://github.com/binance/binance-spot-api-docs/blob/b8a0f61e088c65d18a157f2e11a8e273826b6c08/user-data-stream.md)
- [REST API security](https://github.com/binance/binance-spot-api-docs/blob/b8a0f61e088c65d18a157f2e11a8e273826b6c08/rest-api.md#request-security)
- 발췌: “Orders are updated with the executionReport event.” Event는 last/cumulative executed quantity, executed price, commission, transaction time, trade ID 등을 포함한다.
- Request signing 문서는 “SIGNED requests (i.e. including a signature)”와 client API key 인증을 설명한다. 열람한 executionReport payload에는 제3자가 공개키로 검증하는 exchange signature 필드가 없다. **관측 범위의 사실**이며 Binance의 모든 가능한 별도 institutional data product가 없다는 주장은 아니다.

### T10 — Uniswap actual on-chain swap fields

- [IUniswapV3PoolEvents.sol](https://github.com/Uniswap/v3-core/blob/d0831dc6b8a318df3872b6d68f6de135c9f3ec29/contracts/interfaces/pool/IUniswapV3PoolEvents.sol)
- 발췌: “Emitted by the pool for any swaps between token0 and token1”; `amount0`/`amount1`은 pool token balance deltas. `sender`, `recipient`, `sqrtPriceX96`, `liquidity`, `tick`을 기록한다. 실제 vault accounting 연결에는 transaction provenance/finality와 token balance reconciliation을 더해야 한다.

### T11 — Freqtrade backtest assumptions

- [Backtesting](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/backtesting.md#assumptions-made-by-backtesting)
- 발췌: “All orders are filled at the requested price (no slippage) as long as the price is within the candle's high/low range.”
- 발췌: dynamic pairlists에서 “reproducibility of backtesting-results cannot be guaranteed”; historical precision limits가 없어 current exchange limits 사용.

### T12 — TradingView Pine broker emulator

- [Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
- 발췌: “the broker emulator fills a strategy’s orders using only the available chart data by default.”
- 발췌: “Slippage is dynamic and unpredictable, making it impossible to simulate precisely.” OHLC path assumptions, commission, slippage, bar magnifier, next available tick fills를 설명한다.

### T13 — QuantConnect reality and slippage models

- [Reality Modeling: Key Concepts](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts)
- [Slippage: Supported Models](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/slippage/supported-models)
- 발췌: “The default models assume you trade highly liquid assets. If you trade high volumes or on illiquid assets, you should create custom reality models to be more realistic.”
- 발췌: `NullSlippageModel` “sets the slippage of each order to zero”; VolumeShare는 order/volume 비율의 제곱, MarketImpact는 별도 parameters를 둔다.

### T14 — Freqtrade lookahead / recursive / forward distinctions

- [Lookahead analysis](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/lookahead-analysis.md)
- [Recursive analysis](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/recursive-analysis.md)
- [Strategy customization](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-customization.md)
- 발췌: “Backtesting initializes all timestamps ... and calculates all indicators at once.” future candles 참조는 backtest를 falsify.
- 발췌: backtest는 full timerange인 반면 dry/live는 exchange가 주는 candle 수에 제한되어 recursive indicator 차이가 발생.
- 발췌: dry = forward testing을 live와 별도 mode로 구분; live의 computation/trade-processing delay도 설명한다.

### T15 — Supported runtime, not a generic Python promise

- [RISC Zero technical specification](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/zkvm-specification.md)
- [SP1 Introduction](https://docs.succinct.xyz/docs/sp1/introduction)
- [SP1 Writing Programs Setup](https://docs.succinct.xyz/docs/sp1/writing-programs/setup)
- 발췌: RISC Zero `RV32IM`; SP1 “Rust, C++, C, or any language that compiles to RISC-V.” Standard setup은 Rust crate와 `sp1-zkvm` dependency다.
- 주의: RISC Zero specification 페이지는 privilege split 관련 옛 문장과 새 kernel 설명이 공존하므로 OS-feature 세부 단정에는 사용하지 않았다. `arbitrary Rust`와 전체 Python quant stack의 same-environment support는 같은 말이 아니다.

### T16 — Measurement tools / proving costs and latency

- [SP1 Cycle Tracking](https://docs.succinct.xyz/docs/sp1/optimizing-programs/cycle-tracking)
- [SP1 Prover Network FAQ](https://docs.succinct.xyz/docs/sp1/prover-network/faq)
- 발췌: “Proofs can be fulfilled by provers at any point within the specified timeout”; too-short timeout에는 “it's possible no prover will pick it up.”
- 발췌: cost estimate = `Base Fee + PGUs * Price per PGU`; Reserved Capacity/latency SLAs는 별도 협의.
- 비용 비교 시 `monthly fixed costs + decisions × (proof + verification + keeper/data marginal costs)`와 `AUM × management fee / 12 + uncertain performance fees`를 비교해야 한다. 이는 산식 제안이지 실제 quote가 아니다.

### T17 — HftBacktest replay, queue and latency limitations

- [Order Fill source](https://github.com/nkaz001/hftbacktest/blob/master/docs/order_fill.rst)
- [Latency Models source](https://github.com/nkaz001/hftbacktest/blob/master/docs/latency_models.rst)
- 발췌: “your order cannot make any changes to the simulated market, no market impact is considered”; “you must test it in a live market ... adjust your backtesting based on the discrepancies”.
- 발췌: “If an exchange doesn't provide Market-By-Order, you have to guess it by modeling.”
- Latency Models는 feed / order entry / order response latency를 구분하고 actual latency data로 interpolation하는 model을 제공한다.
