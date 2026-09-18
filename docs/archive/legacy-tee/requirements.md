# 검증 가능한 전략 실행 환경 — 3주 프로토타입 요구사항

작성: 2026-09-17 · 상태: 제안된 구현 계약, 구현 미완료 · 대상: 5명 + 상시 실행 가능한 개발 에이전트

**목표: 비공개로 등록한 Python 전략을 실제 TEE에서 백테스트·실시간 모의 실행하고, 어떤 코드와 입력으로 어떤 결과를 냈는지 제3자가 확인할 수 있게 한다.** 선택 확장으로 비공개 NAV 기록의 최대낙폭 조건을 실제 ZK proof로 검증한다.

이 문서가 기능·보장 범위의 기준이다. [인수 시험](acceptance-tests.md)은 시험 절차의 기준, [실행 계획](three-week-execution-plan.md)은 담당·의존성·일정의 기준이다. 기존 [가능성 검토](../research/three-week-feasibility.md)의 견적을 구현 단위로 구체화했다. 요구사항의 숫자·제한은 실측 성능이 아니라 초기 목표다.

## 1. 무엇을 완료할 것인가

| 완료 수준 | 필수 범위 | 완료 시 주장할 수 있는 것 |
|---|---|---|
| CORE | R01–R17, R21–R24 | 승인한 TEE 실행기가 등록된 패키지·입력·상태를 사용했다고 인증한 백테스트 및 실시간 paper 기록 |
| CORE+ZK | CORE + R18–R20 | 인증된 비공개 NAV 기록에서 공개된 검증 프로그램이 최대낙폭 조건을 계산했다는 ZK 증명 |

**CORE+ZK를 일정의 목표로 삼되, ZK가 필요한 이유는 비공개 기록의 선택적 공개·독립 계산 검증이다.** 그 필요가 없으면 CORE가 제품적으로 충분할 수 있다. CORE만 성공하면 CORE+ZK 성공으로 보고하지 않는다. MDD 검사는 작은 실증용 검증 명제이며 제품 요구가 확정됐다는 뜻은 아니다.

포함 범위:

- 하나의 실제 TEE 서비스, 하나의 버전 고정 Python 런타임, CPU 작업, 운영자가 검토한 전략·변환 코드.
- 사용자 로컬 SDK, 암호화 패키지 등록, 플랫폼 TEE 실행, 공개 verifier CLI.
- Binance 가격·펀딩과 Alternative.me API, 파일 업로드, 사용자 서명 실시간 커스텀 스트림, TEE 내부 커스텀 변환 예제 1개.
- 기존 결정 함수 7종의 공통 인터페이스 수용 시험. 2종은 실제 API와 연결하고, 나머지는 fixture/파일 입력으로 확인한다.
- 제한된 현물 paper simulator와 같은 결정 함수를 사용하는 백테스트. funding carry는 결정 출력까지만 지원한다.
- 실제 시간 72시간 연속 paper 운영과 장애 주입.

제외 범위: 고객 자금·실주문, 임의 악성 코드의 안전한 공개 업로드, 모든 프레임워크 자동 변환, 과거 데이터의 가용성 복원, GPU·분산 학습, HFT·호가장 market making, 파생상품 체결·증거금, 상용 SLA·외부 보안 감사. 상시 에이전트 운영 자체를 이 문서 작성과 함께 시작하지 않는다.

## 2. 로컬과 플랫폼의 경계

```text
사용자 로컬                         플랫폼 일반 영역
  코드·설정·데이터 규칙 작성 ─────→ Registry / Scheduler / API
  개발용 테스트                      │ schedule / accepted state head
  attestation 직접 확인              │
  패키지 암호화 ──────────────────────┼─────┐
  커스텀 발행기 → 서명 이벤트 ────────┼─────┤
                                      ▼     ▼
                               실제 TEE 영역
외부 API ← TLS가 TEE에서 종료 → 수집·검증·변환
                               등록 패키지 실행
                               paper 체결·잔고·NAV
                               기록 commitment·서명
                                      │
                             암호화 저장 + 공개 receipt
                                      │
                선택: 비밀 입력을 보호하는 prover → ZK proof
                                      │
                        사용자/제3자 독립 verifier
```

| 시나리오 | 로컬에서 하는 일 | TEE에서 하는 일 | 남는 신뢰 |
|---|---|---|---|
| 과거 CSV/Parquet | 업로드·출처 메타데이터 제공 | hash·schema 검사, cutoff에 따른 입력 제공, 백테스트 | 업로드 파일의 진실·과거 발표 시각 |
| 일반 외부 API | 공급자·조회 규칙·필요한 자격증명 지정 | 인증된 HTTPS 수집, 원문·수신 순서 기록 | 공급자의 정확성·서비스 가용성 |
| 실시간 자체 score | 발행키로 score와 순번에 서명 | 발행자·순서·지연 검사 후 전략 실행 | score 생성자의 판단·생성 과정 |
| 자체 전처리/소형 모델 | 코드·모델·설정 등록 | 원입력에서 등록 변환을 실행하고 전략에 전달 | 원입력의 정확성, 승인한 런타임 |

플랫폼 호스트는 암호화된 바이트를 전달할 수 있다. **비밀 원문을 호스트에서 복호화하거나 HTTPS를 호스트에서 끝내면 그 호스트를 신뢰하는 별도 경로**가 되며 위 보장을 붙일 수 없다. 개인 PC에서의 일반 Python 실행은 개발용이며 TEE 인증 결과가 아니다.

## 3. 신뢰 가정과 공통 계약

프로토타입은 TEE 공급자·하드웨어, 승인한 실행기 코드, package 승인 절차, 플랫폼의 canonical registry/checkpoint를 신뢰한다. 사용자는 receipt와 proof를 별도로 검증할 수 있지만, 플랫폼이 모든 실행을 공개했다는 사실까지 독립적으로 보장하지 않는다. 독립 공개 로그/온체인 anchoring은 이번 필수 범위가 아니다.

TEE는 계산 무결성·격리의 기반이다. 공급자 데이터의 진실, 전략의 수익성, 항상 실행된다는 가용성, 외부 체결을 보증하지 않는다. 서명된 사용자 score는 발행자 인증이고, TEE 내부 변환은 등록 변환의 실행 인증이다.

다음 스키마를 2일차에 고정한다. 이름은 구현 시 유지하거나 일괄 변경한다.

| 객체 | 필수 의미·필드 |
|---|---|
| StrategyPackage | code/dependency/runtime/model/parameter commitments, data policies, schedule, universe, execution policy, resource limits |
| InputEnvelope | source/publisher ID, request·schema·unit, raw hash, event time, claimed publication time, observed ingress time, sequence/revision, 인증 방법 |
| InputSnapshot | cutoff, 선택한 envelope 목록과 root, 누락/지연 처리 결과, transform/model version |
| Decision | SET_TARGET / NO_CHANGE / DATA_BLOCKED, targets, reason, strategy next-state |
| AccountState | cash, positions, pending paper orders, fills, marks, NAV validity, previous state root |
| RunRecord | run/epoch/package/policy IDs, attempt, previous/new state roots, snapshot root, decision/fill/NAV digest, outcome, TEE key ID |
| ExecutionReceipt | signed RunRecord digest + attested key binding; 실행 성공 여부와 인증 유효성을 별도 표시 |
| ProofStatement | expected record commitment, package/account/period IDs, n·interval, threshold, result, verifier program ID |

hash 입력은 도메인 구분자·버전과 결정적 직렬화를 사용한다. 금액·수량·비중·시각은 스케일이 고정된 정수로 기록하며 NaN/Infinity/중복 JSON key를 거부한다. code/config처럼 추측 가능한 비밀의 commitment에는 256-bit 무작위 salt를 사용한다. 입력·실행·NAV commitment의 필드 순서와 인코딩은 공유 test vector로 고정한다.

## 4. 상세 요구사항

### 등록·실행 계약

**R01 — 변경 불가능한 전략 버전** · 담당 E+C · 시험 T01

- 기술: package manifest, 의존성 lock, artifact 암호화 저장, salted commitment, version registry. 런타임 image 측정값과 동적으로 적재하는 strategy hash를 구분한다.
- 동작: 코드·의존성·파라미터·모델·데이터 선택 규칙·스케줄·simulator 정책 중 하나가 바뀌면 새 버전이다. TEE가 복호화한 패키지의 commitment를 직접 재계산한다.
- 통과: 같은 패키지의 같은 commitment를 확인하고 모든 개별 변경을 검출한다. 등록되지 않은 패키지로 인증된 실행을 만들 수 없다.

**R02 — 공통 SDK와 언어 범위** · 담당 C · 시험 T02

- 기술: Python 하나, `decide(snapshot, strategy_state, parameters) -> decision, next_state`. I/O는 adapter, 잔고 변경은 executor에 둔다. 시간·seed·precision·허용 라이브러리 버전을 고정한다.
- 동작: 7개 기존 결정 함수를 wrapper/port로 수용한다. 외부 프레임워크 원본 전체를 그대로 실행했다는 보장은 하지 않는다. 새 artifact가 canonical strategy가 된다.
- 통과: 동일 snapshot/state의 반복·재시작 실행에서 의미상 같은 decision/state가 나온다. 원본과 달라진 동작은 migration report에 기록한다.

**R03 — 비공개 업로드와 키 전달** · 담당 A · 시험 T03

- 기술: attested encryption key, 사용자 측 attestation verifier, authenticated encryption, TEE 내부 복호화, 로그 redaction. 키는 approved runner에만 전달한다.
- 동작: 사용자가 attestation을 검증한 뒤 패키지·자격증명을 암호화한다. 재시작 시 키 복구/재발급 절차와 삭제 범위를 정한다.
- 통과: 잘못된 measurement/key에 사용자 SDK가 비밀을 보내지 않는다. 저장소·호스트 트래픽·로그에서 시험용 비밀 canary가 평문으로 나오지 않는다. 이 시험은 모든 side channel의 부재를 증명하지 않는다.

### 데이터와 커스텀 입력

**R04 — 입력 규칙과 선택의 재현성** · 담당 B · 시험 T04, T05

- 기술: 버전별 schema·단위·출처·query 생성 규칙·max age·cutoff·revision·gap 정책, raw archive와 snapshot builder.
- 동작: `event_at`, 공급자 주장 `published_at`, 시스템 관측 `observed_at`을 분리한다. 첫 버전은 cutoff까지 받은 유효 입력 중 정해진 revision/sequence 규칙으로 선택한다. 시간이 같을 때의 tie-break도 고정한다.
- 통과: stale/future/late/중복/순서 역전/수정본/잘못된 단위가 정한 결과로 귀결된다. 호출자가 여러 유효 값 중 임의로 골라 canonical snapshot을 바꾸지 못한다.

**R05 — 외부 API·파일·실시간 사용자 스트림** · 담당 B+A · 시험 T06, T07, T08

- 기술: Binance 가격·settled funding, Alternative.me, 파일 입력, `publisher_id + schema_version + seq + payload + signature` 스트림. 재연결·ACK·bounded buffer·크기 제한 포함.
- 동작: 일반 API는 TLS 인증서·hostname 검사를 TEE 안에서 한다. 서명 없는 일반 HTTPS API도 수용한다. 사용자 스트림은 등록 발행키·sequence로 검증하고 원문을 보존한다. 위변조·누락은 명시적으로 차단/기록한다.
- 통과: 실제 API 두 공급자와 실제 시간의 custom publisher 연결 성공. 임의 score도 발행 입력으로 받을 수 있지만 생성 검증 등급을 부여하지 않는다. 파일만 받아 두고 실시간 지원 완료로 세지 않는다.

**R06 — 등록한 커스텀 데이터 생성 로직** · 담당 B+C · 시험 T09

- 기술: `transform(accepted_raw_inputs, previous_transform_state) -> features, next_state`, 코드·모델·설정 commitment, 결정적 CPU 실행. 첫 예제는 rolling feature이며 학습 pipeline은 제외한다.
- 동작: 데이터 공급자가 발행한 값과 TEE 내부에서 만든 값을 구분한다. 등록 모델을 inference에 쓰면 가중치·전처리·라이브러리도 버전에 포함한다.
- 통과: 같은 원자료로 같은 feature를 생성하고 생성 경로를 receipt에 연결한다. 외부에서 보낸 동일 숫자는 `publisher_asserted`로 남는다. model 지원은 실제 예제를 추가 시험한 경우에만 표시한다.

**R07 — 과거 시점 데이터의 보장 등급** · 담당 B+C · 시험 T10

- 기술: `USER_ASSERTED_ARCHIVE`, `PROVIDER_ARCHIVE`, `OBSERVED_FORWARD` provenance와 별도의 시간 근거 필드.
- 동작: historical timestamp를 당시 가용성의 증거로 자동 승격하지 않는다. 현재 API에서 받은 수정된 과거 값도 archive로 처리한다. 전향적 수집도 소스의 경제적 진실을 인증하지 않는다.
- 통과: 같은 가격 기록이라도 당시 관측 증거 유무가 리포트에 다르게 표시된다. 미래 수정본을 이전 결정에 소급 사용하지 않는다. 신뢰 시간은 host clock 단독이 아니라 사전 등록 scheduler epoch와 관측 로그에 연결하며 이 authority 신뢰를 공개한다.

### 백테스트·모의 체결

**R08 — 미래를 볼 수 없는 공통 결정 실행** · 담당 C · 시험 T11, T12

- 기술: snapshot-only strategy interface, cutoff별 brokered data access, CPU/memory/time limit. executor가 가진 전체 archive를 strategy process에 넘기지 않는다.
- 동작: backtest와 forward paper는 같은 decision API를 쓰되 simulated time과 wall-clock을 구분한다. 개발자가 코드에 미래 정답을 미리 넣은 행위까지 검출한다고 주장하지 않는다.
- 통과: cutoff 이후 파일·질의·네트워크 접근이 차단된다. timeout/예외는 성공 결정으로 바뀌지 않고 재생 가능하게 기록된다.

**R09 — 명시적인 paper 회계** · 담당 C · 시험 T13, T14

- 기술: 현물 long-only, 고정 universe, cash/quantity/fee/slippage/rounding/mark/NAV, 정수 회계. 첫 체결 모델은 다음 적격 bar에서 전량 체결하는 단순 모델이며 impact/capacity는 미모델링으로 표시한다.
- 동작: accepted decision 뒤의 첫 적격 bar open으로 체결한다. bar 기반 실시간 paper도 해당 가격이 확인된 뒤 fill을 기록하며 이미 지난 open에 체결하지 않는다. fee/slippage는 불리한 방향으로 적용한다. 최소 수량·cash 부족은 명시적으로 거부/축소한다.
- 통과: 손계산 fixture의 잔고·fee·NAV와 일치한다. 데이터 장애 중 기존 보유분을 삭제하지 않는다. mark가 없으면 NAV unavailable이며 수익률 0으로 채우지 않는다.

**R10 — 결정과 체결의 구분** · 담당 C · 시험 T15

- 기술: decision→order intent→paper fill→account reconciliation 단계별 객체, idempotency key, unsupported instrument error.
- 동작: `SET_TARGET(0)`은 목표 청산, `NO_CHANGE`는 신규 주문 없음, `DATA_BLOCKED`는 데이터 차단이다. 같은 목표 비중도 가격 변화 후 rebalance가 생길 수 있다. next strategy state와 fill 후 account state를 각각 저장하고 다음 결정에 확정된 두 상태를 제공한다.
- 통과: 실패 주문을 체결로 표시하지 않고 pending 주문이 중복되지 않는다. carry의 perp target은 decision-only 실행에서만 허용하며 spot simulator에서는 전체 실행을 명시적으로 거부한다.

### TEE와 인증

**R11 — 실제 remote attestation** · 담당 A · 시험 T16, T17

- 기술: 실제 한 공급자의 SDK·trust roots·measurement allowlist·신선한 challenge/session binding·key lifecycle. 초기 후보는 AWS Nitro Enclaves이며 2일차에 접근성·리소스를 실측해 확정한다.
- 동작: 결과 서명키와 암호화키는 TEE 안에서 생성하고 attestation에 결합한다. 인증서 체인·서명·measurement·debug 여부·freshness를 검사한다. challenge/hash/signature를 만드는 homemade attestation은 사용하지 않는다.
- 통과: 실제 hardware attestation을 독립 verifier가 수용한다. 다른 image·허용 안 된 key·오래된 session·debug/dev 결과는 거부한다. 이전 receipt의 역사적 확인과 신규 실행에 대한 freshness 검사를 구분한다.

**R12 — 결과와 입력·상태의 연결** · 담당 A+C · 시험 T18

- 기술: trusted supervisor가 RunRecord를 만들고 canonical encoding으로 서명. 전략에게 임의 byte signing API를 제공하지 않는다.
- 동작: 패키지·snapshot·전후 상태·schedule·결정·paper fill·NAV·outcome 모두 digest에 포함한다. signature 유효와 전략 성공을 분리한다.
- 통과: 각 필드를 하나씩 바꾼 receipt와 다른 run에서 가져온 결과를 거부한다. `STRATEGY_ERROR`도 유효하게 인증될 수 있지만 성공으로 표시하지 않는다.

**R13 — 전략 코드와 신뢰 실행기의 분리** · 담당 A+C · 시험 T19

- 기술: 검토된 코드 allowlist, 별도 UID/process, 최소권한 IPC, 네트워크 차단, 파일 접근 제한, resource limits. 가능한 공급자 제약은 초기 spike로 확인한다.
- 동작: strategy process는 signing key, 다른 작업, raw archive 전체, arbitrary HTTP에 접근하지 못한다. 허용 데이터 요청은 broker가 정책에 따라 처리한다.
- 통과: key/file/network canary 접근과 무한 루프·과도한 메모리 입력을 차단한다. 격리 시험 실패 시 shared signing-key 구조로 우회하지 않는다. 적대적 multi-tenant 완전 격리 보장은 범위 밖이다.

### 실행 이력·장애·업그레이드

**R14 — 모든 예정 결정의 상태 기록** · 담당 E+C · 시험 T20

- 기술: 사전 등록 schedule, epoch/run ID, input cutoff, execution deadline, terminal outcome, 별도의 proof status.
- 동작: NO_CHANGE/HOLD도 실행 기록을 낸다. 실행 결과는 COMPLETE/INPUT_BLOCKED/STRATEGY_ERROR/TIMEOUT/MISSED/EXECUTION_FAILED로 구분한다. proof는 PENDING/VERIFIED/FAILED/UNAVAILABLE로 별도 관리한다. deadline 뒤 결과는 late attempt로만 보존한다.
- 통과: 서버 중단·결과 미제출·늦은 제출을 주입해도 예정 slot이 사라지지 않는다. 복구 시 사전 schedule에서 누락을 재구성한다. 강제 실행·항상 가용성을 보장한다고 표현하지 않는다.

**R15 — 상태 연속성과 crash 복구** · 담당 C+E · 시험 T21, T22

- 기술: 외부 canonical checkpoint, compare-and-swap state head, 암호화 상태, transactional outbox 또는 동등한 commit/reconcile 절차, unique idempotency key.
- 동작: 같은 이전 state에서 두 결과가 와도 하나만 canonical로 수용한다. proof 재시도는 전략·체결을 재실행하지 않는다. TEE disk rollback만으로 과거 head를 다시 승인하지 않는다.
- 통과: decision/fill/commit/response 경계별 crash 후 모의 체결·잔고 변경이 한 번만 반영된다. 복원된 오래된 TEE 상태와 fork를 거부한다. canonical store까지 악의적으로 되돌린 경우의 방지는 보장 밖이며 명시한다.

**R16 — 중단·업그레이드의 명시성** · 담당 E+C · 시험 T23

- 기술: 새 package version, activation epoch, freeze/cancel 사유, version별 history.
- 동작: 첫 버전의 upgrade는 기존 run 종료와 별도 새 run 시작으로 제한한다. 자본·상태의 무중단 migration은 하지 않는다. 이미 예정된 과거 epoch를 삭제할 수 없다.
- 통과: upgrade 전후 결과가 각각의 package에 연결되며 old state를 조용히 새 코드로 해석하지 않는다. 중단 이후 일정의 종료 사유를 확인할 수 있다.

### 비공개 기록과 선택 ZK

**R17 — 인증된 NAV 기록 commitment** · 담당 C+D · 시험 T24

- 기술: 계정·전략·기간·간격·관측 수·정수 NAV·validity·salt를 포함하는 기록 commitment. 입력 관측 수는 2–256, 입출금 없는 기간으로 한정한다.
- 동작: 평가 기간·관측 간격을 사전에 등록한다. 각 관측은 대응 실행/회계 기록과 연결한다. 필수 NAV가 없으면 완전한 기간이라고 인증하지 않는다. 실행 누락 중에도 가격이 유효하면 기존 보유분을 평가한다.
- 통과: 부분 기간·누락·순서 바꿈·다른 계정 기록을 정상 기간 root로 수용하지 않는다. TEE 인증된 record commitment를 verifier의 expected root로 가져온다. prover가 임의 root를 골라 신뢰되는 결과로 제출할 수 없다.

**R18 — 고정 검증 프로그램의 실제 ZK proof** · 담당 D · 시험 T25, T26 · ZK 확장

- 기술: 기존 zkVM의 실제 zero-knowledge proof mode, public program ID와 아래 정수 predicate. 개별 비-ZK proof mode를 privacy 완료로 세지 않는다.
- 공개 입력: expected commitment, package/account/period ID, n·interval, `limit_bps`, `result`. 비공개 witness: 전체 고정 기간 NAV·salt 및 root 재계산에 필요한 비공개 필드.
- 조건: `2 ≤ n ≤ 256`, `0 < NAV[0] ≤ 10^18`, `0 ≤ NAV[i] ≤ 10^18`, `0 ≤ limit_bps ≤ 10000`. u128 또는 동일 안전 범위의 산술을 쓴다.
- 계산: `peak[i] = max(NAV[0..i])`; 모든 i에 대해 `(peak[i] - NAV[i]) * 10000 ≤ limit_bps * peak[i]`이면 true, 아니면 false다. true와 false 모두 증명할 수 있어야 한다.
- 통과: 실제 proof가 발행·검증되며 altered witness/false public result는 거부한다. 이 명제는 관측된 NAV의 MDD 조건이고 미래 위험·관측 사이 손실·전략 원계산에 관한 proof가 아니다.

**R19 — 인증과 proof를 연결하는 독립 검증** · 담당 D+A · 시험 T27, T28 · ZK 확장

- 기술: attestation/receipt verifier + zkVM verifier + expected statement 비교. TEE 인증서 검증을 회로 안으로 옮기는 작업은 포함하지 않는다.
- 동작: registry에서 선택한 canonical account/period/root와 proof public inputs를 비교하고 허용한 program/version만 수용한다. 인증된 입력 기록이 맞는지는 TEE 경로에 의존한다.
- 통과: 정상 암호학적 proof라도 다른 기간/root/program이면 거부한다. dev/mock proof와 서명 JSON은 proof가 아니다. 인증 실패·proof 실패·risk predicate false를 서로 다른 상태로 반환한다.

**R20 — prover의 비밀성·실제 비용** · 담당 D+A · 시험 T29 · ZK 확장

- 기술: 실제 confidential proving 경계 또는 사용자가 통제하는 로컬 prover, witness 전송·메모리·로그 경로 명세, 작업 제한·측정.
- 동작: 독립 플랫폼 운영자에게 기록을 숨기려면 prover도 그 경계 안에 있어야 한다. 일반 외부 prover에 넘기면 해당 prover는 원문을 본다는 별도 등급으로 표시하며 confidential 완료로 세지 않는다.
- 통과: 선택한 경계에서 n=256 proof를 생성하고 CPU/RAM/시간/금액을 기록한다. 작은 fixture만 되고 목표 크기는 실패하면 완료가 아니다. 자세한 목표는 R23 및 T29를 따른다.

### 인터페이스와 운영 검증

**R21 — 최소 API·화면** · 담당 E · 시험 T30

- 기술: owner 인증, package 등록, backtest 요청, schedule 시작/중단, status/receipt/proof 조회 API와 단일 결과 화면. private artifact 접근 제어.
- 동작: BACKTEST/PAPER, synthetic/archive/forward, input provenance, execution outcome, attestation, proof, risk predicate를 독립 표시한다. proof가 true여도 수익성 인증으로 표현하지 않는다.
- 통과: SDK부터 등록→실행→결과 확인까지 가능하다. 다른 owner의 코드·credentials·private NAV를 읽거나 실행을 변경할 수 없다.

**R22 — 플랫폼 밖에서 재검증 가능한 증거** · 담당 E+D+A · 시험 T31

- 기술: export bundle과 verifier CLI, 공개 key/attestation/measurement/program manifest, expected statement, 기록·증명 digest, 재현 README.
- 동작: 비밀 데이터 없이 인증·공개 predicate를 검증할 수 있다. backtest 숫자의 독립 재계산은 필요한 데이터가 있을 때만 가능하다고 구분한다. canonical root·이력 완전성에 대한 registry 신뢰를 표시한다.
- 통과: 별도 환경에서 플랫폼의 '성공' API를 호출하지 않고 bundle을 검증한다. 개발자 전용 비밀키가 verifier에 필요하지 않다.

**R23 — 자원·성능·오용 제한** · 담당 전원, 통합 E · 시험 T32, T33

- 기술: 입력/출력 크기·rate·CPU·RAM·timeout 제한, backpressure, 비용·성능 telemetry, workload manifest.
- 초기 목표: UTF-8 custom event 최대 64 KiB, publisher당 지속 1 event/sec; 시험 backtest는 2 assets × 각 10,000개 OHLCV bar와 등록 rolling transform. 계정별 전략 평가 5분, 단일 결정 TEE 내부 p95 ≤ 10초, backtest ≤ 10분. API 대기와 proving은 따로 측정한다.
- ZK 목표: 고정 instance에서 n=256 proof ≤ 30분·메모리 예산 이내. 초기 runner ≤ 8 vCPU/32 GiB, prover ≤ 32 vCPU/128 GiB를 계획 상한으로 놓고 공급자 가능 여부와 실제 비용을 2일차에 확인한다. 큰 quant/ML 작업 지원 근거로 이 숫자를 일반화하지 않는다.
- 통과: 해당 workload와 환경을 기록하고 목표를 만족한다. 전체 cloud 비용·prover 비용의 실제 상한은 시작 전 팀이 manifest에 숫자로 고정한다. 예산 미정 상태에서 agent가 무제한 자원을 생성할 수 없다. 실측 후 목표 변경은 문서 버전과 변경 사유를 남긴다.

**R24 — 장애 시험과 실제 72시간 관측** · 담당 전원, 통합 E · 시험 T34, T35, T36

- 기술: 건강 상태·누락 slot·입력 지연·proof queue·자원·비용 관측, 장애 주입, restart/runbook, artifact retention 설정.
- 동작: 실제 TEE에서 실제 공개 feed 두 전략과 custom feed 전략 한 개를 paper 운용한다. custom 전략은 5분 주기 72시간=864 slot. ZK는 별도 1시간 NAV 관측으로 완전한 24시간 window당 25개 관측치, 세 window를 검증한다.
- 통과: 모든 예정 slot의 canonical outcome 확인, 중복 회계 반영 0건, 누락의 묵살 0건, 복구·export 성공. 비주입 구간의 custom 결정 성공률 ≥99%, 계획 장애는 사전 목록으로 분리하고 전체 분모도 공개한다. 실제 feed 장애는 분류해 보고하며 필요 이상 제외하지 않는다.
- 72시간 관측은 실제 경과 시간이다. replay나 agent 병렬 수로 대신하지 않는다. 코드/신뢰 경계를 materially 바꾸면 최종 버전으로 관측 창을 다시 잡는다.

## 5. 지금 있는 것과 아직 없는 것

기존 [전략 코드](../research/alpha-suite/strategies.py)는 결정 함수·입력 검사 예제다. source 문자열과 timestamp 검사만으로 출처가 인증되지 않는다. 기존 테스트 6개와 저장 결정 372건 재계산은 앞선 조사에서 확인한 baseline이며 이번 인수 시험 통과가 아니다.

이 문서 작성 시 R01–R24는 **NOT_IMPLEMENTED / NOT_RUN**이다. TEE·인증·회계·ZK·72시간 운영을 아직 수행했다고 주장하지 않는다. 기한 안에 CORE를 통과할 수 있는지와 CORE+ZK까지 통과할 수 있는지는 각각의 gate로 판정한다.

## 6. 기술 참고와 근거의 한계

- [AWS Nitro Enclaves 구조](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html): 일반 host와 enclave의 자원·통신 경계. Python ecosystem 사용 가능성과 임의 패키지의 안전성은 다른 문제다.
- [AWS attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html): enclave identity와 attestation 기반 접근 제어의 기반. 동적 전략·입력·결과 binding은 우리가 구현·시험해야 한다.
- [SP1 security model](https://docs.succinct.xyz/docs/sp1/security/security-model): proof mode별 보장 확인에 사용한다. 실제 채택 SDK 버전의 문서를 다시 확인하고 고정한다.
- [SP1 private proving](https://docs.succinct.xyz/docs/sp1/prover-network/private-proving): proving 과정의 confidentiality도 별도 경계라는 참고 사례. 해당 서비스 채택·성능을 확정한 것은 아니다.
- 저장소 [기술 근거](../research/technical-evidence.md), [데이터 출처 조사](../research/alpha-data-sources.md), [adapter 조사](../research/adapter-evidence.md).

출처는 구성요소의 존재를 뒷받침한다. 3주 납기·통합 성능·전체 시스템 보안은 **계획 및 미검증 가정**이며 문서 링크가 시험을 대신하지 않는다.
