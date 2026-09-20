# 팀 개발명세·작업 분담

기준: [Confidential Alpha Protocol v0.1](specs/confidential-alpha-protocol-v0.1.pdf), 2026-09-19. 구현 상태는 [team-status.md](team-status.md)를 봅니다. 아래 역할은 작업 경계이며 실제 팀원 이름 배정은 아닙니다.

## 1. 도메인별 작업 분담

| 담당 역할 | 책임·입출력 | 인수 근거 |
|---|---|---|
| 입력·TEE | 등록 운용자의 서명·암호화 intent, 순서/만료/mandate 확인, 장부·witness 처리 | 다른 운용자·재전송 거부, 실 attestation, host 평문 미노출 |
| 장부·ZK | Book별 자산·부채·지분·예약·청구권, 승인/정산/입출금 증명, 공개 입력 | 자산 전가·누락·중복·범위 초과 거부, 온체인 proof 검증 |
| 계약·DEX | canonical root, 입출금·시장 호출·체결 기록, 직렬 처리 | calldata/recipient 검증, 실패 원자성, receipt 재검증 |
| 위험·평가 | 인증 가격·시간, 노출·누적 비용·빈도·손실 대응, 공개 지표 | pending 포함 한도, 오래된 가격 거부, 손실 정산 보장 |
| 운용자 경제조건 | 자기자본 유지, stake epoch, 점수·보상·차감·보수·종료 | 잠금 우회 거부, 차감 상한, 실제 보상 재원, 지분 보존 |
| 복구·서비스·검증 | 암호화 백업·대체 TEE·재실행, 도메인별 입력/상태/결과/증거 | 과거 snapshot 거부, 연속 복구, 미정산 종료 거부 |

일반 외부 prover로 비공개 witness를 보내지 않습니다. Relayer는 증명 전달자이며 자금·장부 변경 권한의 근거가 아닙니다.

## 2. 데이터 계약

### Intent

서명 대상: `protocolDomain, chainId, vaultId, bookId, providerSequence, targets[], validUntil, maxExecutionLatency, providerPriceConstraints, mandateVersion, randomNonce`.

전략 코드가 아닌 목표 운용 의도입니다. 난수를 포함한 입력 commitment를 실제 승인에 사용한 원본과 연결합니다. 상태는 `RECEIVED → ACCEPTED → AUTHORIZED → EXECUTED → SETTLED`. 교체는 승인 전까지만 가능하며 제출 순서를 강제합니다.

### Virtual Book

| 데이터 그룹 | 필드 |
|---|---|
| 식별·규칙 | bookId, provider, lifecycle, mandateVersion, scoringVersion |
| 자산·의무 | cash/assets, positions, collateral, liabilities, funding, realizedPnL, valuation, accruedFees, rounding |
| 권리 | totalShares, investorShares/claims, providerShares, lockedProviderShares |
| 실행 | reservedCapital, pendingOrders, allocationCommitment, executionCursor |
| 위험 | gross/net exposure, concentration, margin(해당 상품만), 누적 turnover/cost counters |
| 평가 | stakeEpoch, stakeSnapshot, pendingRewards/penalties |
| 입출금 | pendingDeposits, pendingRedemptions, withdrawalClaims |
| 입력 | acceptedProviderSequence, intentCommitment, expiry |

잠긴 provider 지분은 provider 지분의 부분집합입니다. 예약 자금이나 잠긴 지분을 추가 자산처럼 더하지 않습니다. NAV와 즉시 환매 가능한 현금을 구분합니다.

### Proof public statement

목표 공통 필드: `domain, chainId, vaultId, transitionType, globalSequence, batchId, previousRoot, newRoot, inputBatchCommitment, executionCommitment, allocationCommitment, executionReceiptCommitment, consumedEventRange, marketDataCommitment, valuationTime, configRoot, verifierVersion, registeredProviderRoot, disclosedMetricsCommitment`.

전이별 필수 필드·0값·순서 규칙을 고정합니다. 설정 변경 중에도 이미 승인한 거래를 정산할 수 있어야 합니다. 해시만으로 가격·체결 출처의 진위를 보장하지 않습니다.

## 3. 승인·실행·정산

**Authorization R0 → R1:** 입력 인증·순서·만료·도메인, 기존 포지션과 예약을 포함한 위험 검사, 자금 예약과 실행 계획·체결 배분 사전 확정. 예상 체결 결과를 실제 손익으로 확정하지 않습니다.

**Execution:** 현재 root·sequence·설정·증명·calldata 일치, 허용 Adapter·자산·recipient·가격 조건 확인. 동기식 거래는 승인·R1 채택·거래·receipt 기록을 원자적으로 수행합니다. 실패 시 모두 rollback, 성공 시 정산 대기입니다.

**Settlement R1 → R2:** 실제 인증 기록에 따라 사전 약정대로 체결·비용·손익을 배분하고 예약을 해제합니다. 누락·중복 없이 연속된 순서로 처리합니다. 이전 정산 전에는 다음 일반 batch를 승인하지 않습니다. 이미 발생한 손실은 위험 한도 위반이나 주문 만료를 이유로 정산을 막지 않습니다.

**회계 보존:** 자산별 `Book 자산 합 + protocol-owned + 미배정 자산 = 실제 Vault + 승인된 외부 보관 자산`을 확인합니다. 부채·담보·포지션도 정의한 방식으로 대조합니다. 예기치 않은 입금은 성과가 아니라 미배정 자산입니다. 투자자·운용자·준비금 등 정의된 소유자 지분 합은 총지분과 일치합니다. Book 간 귀속을 바꾸면서 전체 합계만 맞추는 변경은 금지합니다.

## 4. 자기자본·staking·보수

기본안은 자기 Book에 투자한 운용자 지분의 유지와 그 지분의 성과 연동 정산입니다. 별도 프로토콜 토큰·alpha 합성·First-loss는 도입하지 않습니다.

Book 상태: `PENDING → ACTIVE → RESTRICTED / UNWINDING → SETTLING → CLOSED`. 전이 조건에 포지션·예약·미정산 비용·청구권을 포함합니다. ACTIVE부터 SETTLING까지 운용자 지분의 출금·양도·Book 이동을 막습니다. 평가기간 종료만으로 원금이 풀리지 않습니다.

Stake epoch: `OPEN → COMMITTED → EVALUATING → SCORED → SETTLED`. MVP는 epoch를 겹치지 않습니다. 같은 지분을 여러 Book·미정산 epoch의 독립 담보로 중복 인정하지 않습니다.

일반 운용 손익·비용 → 평가용 성과 → 점수 → 보수·staking 순서를 고정합니다. 차감은 남은 epoch 배정 지분 이하이고 보상은 실제 확보한 재원 이내입니다. 지분 소각도 다른 소유자의 권리를 바꾸므로 귀속을 명시해야 합니다.

**미확정:** 최소 자기자본·수용 외부자본, 평가기간·점수·벤치마크·입출금 처리, 차감 상한·수혜자, 보상 재원·부족 시 처리, 성과보수·손실 이월·투자 시점별 equalization, 보수 유예·재투자. PDF의 20%는 예시이며 확정 정책이 아닙니다.

## 5. 위험·공개 지표

| 목적 | 내부 계산·강제 | 공개 시 고려 |
|---|---|---|
| 노출 | 자산별·총·순노출, 집중도, 상품별 레버리지·담보 | 포지션 대신 한도·사용 구간·지연 표시 검토 |
| 유동성 | 현금, 예약 자금, 환매 청구·실제 환매 가능액 | NAV와 환매 가능액 구분 |
| 비용 | rolling turnover, 누적 수수료·실행비용, 빈도 | 기간·분모·비용 포함 범위 |
| 손실 대응 | 고점 대비 하락, 제한/정리 조건 | 수익률을 기능 검증 통과 기준으로 쓰지 않음 |
| 운용자 책임 | 자기자본, 잠금, 활성 stake, 최대 차감액 | stake/외부자본과 자기자본/전체지분 비율 구분 |
| 데이터 | 가격 age/deviation, pending, 정산 지연, custody 대조 | 같은 기준 시점, 지연·결측·미정산 표시 |

Sharpe·변동성은 표본과 계산 기준을 정한 뒤 추가합니다. 공개 지표 proof는 공개로 생기는 전략 추론을 제거하지 않습니다.

## 6. 개발 순서·완료 조건

| 순서 | 작업 | 완료 조건 |
|---|---|---|
| 1 | 두 Book 최소 ZK 승인·정산 + 외부 DEX 포크 | 실제 proof·Solidity 검증, 다른 Book 불변, 거짓 체결/전가/누락/중복/재사용 거부, gas·proving 시간 |
| 2 | 실제 TEE 수신·attestation·proving | 예상 이미지·측정값 확인, 암호화 입력, witness 미전송, 메모리·지연·비용 기록 |
| 3 | 입출금·투자자 청구권·가격평가 | 인증 이벤트·지분 발행/환매 연결, 투자 시점별 평가, 유동성·반올림·미배정 입금 |
| 4 | 자기자본 잠금·lifecycle·운용자 부재 | 유지 의무 우회 방지, 약정 정리, 미정산 종료 거부 |
| 5 | 위험·staking·보수 정책 적용 | 미정 항목 합의 후 경제 시나리오와 회계·proof 검증 |
| 6 | 복구·비상 청구·화면 연결 | 암호화 복제 장부·대체 TEE·연속 replay·최종 청구권, 도메인별 실제 증거 조회 |

첫 회로 통과로 3–6을 완료했다고 간주하지 않습니다. 범위를 줄이는 결정이 아니라 구현 순서입니다. 실제 TEE provisioning은 첫 실험 예산 $2와 과금 종료 조건 안에서 진행합니다.

## 7. 2026-09-20 구현 인계

첫 ZK 회로·연구용 Vault는 32개 검사와 별도 proof/체결 기록 재검증을 통과했습니다. 실제 Phala TDX에서는 암호화한 합성 witness를 받아 같은 회로의 proof를 생성했습니다. 두 실험은 독립적이며, TEE 장부와 DEX 체결을 연결한 전체 흐름은 다음 인수 항목입니다. [구현 상태](team-status.md), [ZK 재현](zk-transition-runbook.md), [TEE 실험](tee-hardware-probe.md)에서 코드 위치·증거·제약을 확인합니다.

입력 도메인은 현재 연구용 구체 주문과 팀 명세의 target intent 변환을 연결하고, TEE 도메인은 장부 영속성·승인된 측정값·키 복구를 맡습니다. 계약 도메인은 입출금 이벤트와 투자자 청구권을 추가합니다. 경제조건 담당은 미정 수치를 먼저 결정합니다. 첫 통과 결과로 이 후속 작업을 생략하지 않습니다.
