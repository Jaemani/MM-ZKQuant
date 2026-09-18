# 5명 × 3주: 검증 가능한 전략 실행 환경의 범위와 작업량

작성일: 2026-09-17. 실제 요구사항을 작업 단위와 완료 조건으로 추정한 문서다. 기간과 인일은 측정값이나 납기 보장이 아니라 아래 전제에 따른 계획 예산이다. AI 사용으로 모든 작업이 일정 배수만큼 빨라진다고 가정하지 않는다.

후속 구현 명세: [요구사항 24개](../docs/requirements.md), [인수 시험 36개](../docs/acceptance-tests.md), [5명·24/7 에이전트 실행 계획](../docs/three-week-execution-plan.md). 구현·검증 범위는 후속 명세를 기준으로 한다.

## 판단

**5명이 전업으로 3주 일하면 실제 TEE와 실제 ZK proof가 포함된 제한된 검증 데모는 조건부로 가능하다. 임의 사용자 전략을 안전하게 받아 고객 자금을 상시 운용하는 범용 플랫폼까지는 이 기간의 합리적인 약속 범위가 아니다.**

여기서 가능한 결과는 실제 외부 데이터와 실시간 커스텀 입력을 받아 등록된 프로그램으로 백테스트·모의 운영하고, TEE 실행 인증과 한 종류의 ZK 검증 결과를 독립 확인하는 시스템이다. 실시간 모의 운영은 실제 돈을 운용한 live track record가 아니다.

## 실제 시작점

이 저장소에서 확인한 구현은 `research/alpha-suite/strategies.py`의 7개 Python 결정 함수, 입력 검사, 합성 예제, 두 전략의 저장 입력 재생이다. 2026-09-17 확인에서 코드 hash는 기존 결과와 일치한다. 앞선 검증에서는 테스트 6개와 저장된 결정 372건의 재계산이 일치했다. P&L backtest engine, TEE 배포, remote attestation, 실행 서명, 등록 API, ZK proof, 주문·체결 계층은 아직 없다. 따라서 7개 함수가 있다는 이유로 플랫폼 대부분이 완성됐다고 산정하지 않는다.

## 일정의 전제

- 3주는 15영업일, 총 75인일이다. 5명 모두 전업으로 참여한다.
- 팀에 Python/백테스트 경험, 서버/클라우드 경험, 기존 ZK 도구 사용 경험을 가진 사람이 있다. 모두가 TEE와 ZK를 처음 배우는 조건에서는 같은 완료 약속을 할 수 없다.
- 첫날부터 선택한 실제 TEE 서비스의 계정·권한·할당량·예산을 사용할 수 있다. 사용자 개인 PC마다 TEE를 지원시키지 않는다.
- 한 종류의 TEE와 기존 SDK, 한 Python runtime, 기존 백테스트 엔진 또는 매우 제한된 시뮬레이터를 사용한다. CPU에서 처리할 수 있는 workload를 선택하고 GPU와 분산 학습은 제외한다.
- AI 활용은 코드 초안·스키마·테스트·SDK 예제 연결에 이미 반영한 예산이다. 실제 attestation, proof, 장애 복구 및 잘못된 보장의 검토는 사람이 실측·확인한다.
- 팀이 검토한 코드만 실행한다. 임의의 적대적 Python 패키지를 여러 고객이 올리는 서비스의 보안 완성도를 주장하지 않는다.

## 추상화할 공통 인터페이스

전략별 시스템 7개가 아니라 다음 하나의 실행 계약을 만든다.

```text
StrategyPackage
  code + dependencies + parameters + data rules + runtime version

InputAdapter
  API / file / realtime custom events
  → source evidence + observation time + raw data reference

FeatureTransform
  versioned user code/model + accepted raw inputs → features

Run
  package + input snapshot + previous state → decision + next state

Execution
  decision + account state → simulated fills + reconciled state

RunRecord
  run ID + schedule + package/input/state IDs + outcome + result digest

Check
  accepted RunRecord commitment + private evidence → verification result
```

각 함수의 입력·출력·오류를 첫 이틀에 고정한다. 백테스트와 모의 운영은 같은 결정 함수를 쓰며, historical replay와 realtime scheduling이 입력 공급 방식만 달리한다. 같은 결정 함수를 쓴다고 simulator 체결과 실제 시장 체결이 같다는 뜻은 아니다.

## 3주 범위의 요구사항과 계획 예산

각 행의 인일은 담당자 한 명의 연속 소요 기간이 아니라 팀 작업량이다. 작업 간 의존성 때문에 단순 합만으로 완료가 보장되지는 않는다.

| ID | 추상화 요구사항 | 3주 범위 | 완료 판정 | 계획 인일 |
|---|---|---|---|---:|
| R1 | 등록한 프로그램만 실행 | 한 Python 패키지 형식, 설정/의존성 hash, run ID와 버전 등록 | 코드 또는 설정 변경 시 다른 버전으로 식별되고 결과에 연결 | 6 |
| R2 | 규칙에 맞는 데이터 수용 | 공개 API 2개, 파일 입력, 실시간 커스텀 이벤트 1개 규격; 공통 시간/누락/중복 정책 | 오래된 값·잘못된 출처·중복·누락이 명세대로 처리되고 원문 hash 기록 | 8 |
| R3 | 백테스트와 실시간 모의 실행 | 고정 universe 현물, 명시한 fee/fill 규칙, 기존 결정 함수 재사용 | 같은 snapshot 재생 결과 일치; 신호·주문·모의 fill·잔고가 구분 | 7 |
| R4 | 진짜 TEE 실행과 결과 인증 | 한 실제 TEE, 측정값 확인, 암호화 전달, TEE 안 서명키, 승인된 실행기 | 다른 측정값·키·변조 결과를 독립 verifier가 거부 | 8 |
| R5 | 실행 이력과 복구 | 단일 scheduler/accepted state head, 상태 영속화, nonce/idempotency, 실패·누락 기록 | 재시작·중복 요청 때 중복 모의 주문이 없고 실패가 성공으로 바뀌지 않음 | 5 |
| R6 | 비밀 기록에 대한 검증 | 고정된 검증기 하나의 실제 ZK proof, bounded NAV 기록과 MDD predicate 등 한 가지 관계 | 정해진 commitment에 연결된 정상 proof 검증; 변조 기록·다른 기간/검증기 거부 | 7 |
| R7 | 사용·확인 가능한 인터페이스 | 등록/실행 API, 간단한 결과 화면, 독립 verifier CLI | 전략 등록부터 결과 확인까지 재현 가능하며 paper/실데이터/합성 표시 명확 | 6 |
| R8 | 연결·장애 시험과 전달 | 누락·재시작·잘못된 signature/root·결과 변조·timeout, 72시간 모의 운영 | 실패도 기록되는 end-to-end 결과, 재현 절차·한계·계측 자료 확보 | 8 |
| | **계획 합계** | | | **55** |

TEE 인증 중심의 기본안은 R6를 제외한 48인일이며, ZK 검증 한 종류를 포함한 안은 55인일이다. 75인일 중 55인일을 계획 작업으로 사용하고 20인일은 학습·통합·성능 문제·재작업 여유로 둔다. 이 여유는 최초 TEE 사용 불가나 신규 회로 전체 설계를 모두 흡수하는 보장은 아니다. 숫자는 현재 팀의 과거 생산성으로 보정하지 않은 초안이므로, 첫 주 실제 결과로 재산정해야 한다.

## ZK의 정확한 역할

이 제안은 TEE 인증서를 ZK 안에서 다시 검사하는 데 시간을 쓰지 않는다. 플랫폼의 verifier가 remote attestation과 결과 서명을 직접 확인하고, 그 결과의 canonical commitment를 받아들인다. ZK verifier는 승인된 commitment를 public input으로 사용한다.

예를 들어 실행기에서 생성한 고정된 길이/시간 간격의 private NAV series에 대해, 고정 검증기 V가 최대낙폭 조건을 정확히 검사했다는 proof를 만든다. 첫 버전은 중간 입출금 없는 paper account, 정해진 NAV 평가 주기·정수 정밀도·결측 정책으로 한정한다. 비용 측정을 위한 최초 크기는 최대 256개 NAV 관측치로 제한한다. 이것은 장기 전체 기록·초단위 스트림까지 지원한다는 뜻이 아니며, 더 긴 이력은 별도 측정 후 확장한다. 기록 길이와 시작/종료 시점까지 commitment에 포함하고, witness 전체에서 root를 재계산한다. 임의의 유리한 subrange만 제출하는 것을 허용하지 않는다.

이 proof는 **TEE가 인증한 NAV series의 계산 조건**을 증명한다. TEE 밖 원자료의 진실, 실제 체결, 미래 손실 한도, 특정 sampling 시점 사이의 손실까지 증명하지 않는다. 원자료는 공개하지 않고 결과 또는 임계값 판정만 공개하므로 ZK의 privacy 역할은 있다. 고객이 이런 선택적 공개와 독립 계산 검증을 필요로 하는지는 별도의 제품 가정이다.

기존 zkVM 또는 검증된 도구를 사용하고, 실제 ZK를 지원하는 proof mode와 verifier를 선택한다. mock signature, proof 모양의 JSON, dev-mode receipt는 완료로 세지 않는다. TEE에 둔 private prover 또는 다른 명시적 confidential proving 경계가 필요하며, 외부 일반 prover에 기록을 넘기면 그 prover에게는 기록이 보인다고 공개해야 한다. 완전한 enclave-internal proving 성능이 안 나오면 비밀성 보장을 몰래 바꾸지 말고 범위를 재판단한다.

## 7종 전략에 대한 이번 범위

| 대상 | 포함할 것 | 포함하지 못한 것을 명확히 표시 |
|---|---|---|
| 기존 결정 함수 7종 | 같은 패키지 형식으로 등록하고 fixture 또는 기록된 inputs에서 실행 | 7종의 실데이터 전처리·수익성·실거래가 모두 검증된 것으로 표시하지 않음 |
| 펀딩 추세·공포 반등 | 실제 API 입력 수집과 전향적 paper decisions | 과거 발표 시각은 현재 archive만으로 입증하지 못함 |
| 실시간 커스텀 데이터 | 사용자가 데이터를 보내는 경로, 버전/시간/순서/서명 정책, TEE 내부 transform 예제 1개 | 일반 사용자 발행 데이터의 경제적 진실이나 외부 생성 과정을 보장하지 않음 |
| 순유출·언락·뉴스·스테이블 | 동일 인터페이스의 수용 가능성과 예제 입력 검증 | 과거 라벨/일정/뉴스 이력·완전한 raw-to-feature pipelines는 별도 작업 |
| 펀딩 캐리 | 두 target 계산 및 데이터 계약 검증 | 양다리 실거래·수량 중립·margin·partial fills·funding accounting은 별도 실행 프로젝트 |

커스텀 지원은 이름만 바꾼 고정 지표 목록이 아니라, 등록된 schema와 버전별 transform을 받는 방식이다. 다만 첫 버전은 운영자가 검토한 transform을 배포하며 공개된 임의 코드 업로드 서비스가 아니다.

## 5명 역할과 병렬 진행

| 담당 | 주책임 | 의존하는 공통 계약 |
|---|---|---|
| A | TEE, attestation, 암호화 전달, 실행 결과 서명 | Package hash, record schema, key lifecycle |
| B | 입력 adapter, raw-to-feature, 실시간 커스텀 입력 | Input schema, freshness/selection/errors |
| C | 결정 runtime, 백테스트/paper accounting, 상태 복구 | Run/Decision/Fill/State interface |
| D | 검증 프로그램, 실제 proof, 독립 verifier, 변조 시험 | Accepted record commitment, exact arithmetic, privacy boundary |
| E | Registry/API/UI, 배포, end-to-end 조정 | 전체 API, outcome types, artifact versions |

QA는 E에게만 맡기지 않는다. 각 담당자가 자신의 실패 조건을 검사하고 3주차에는 A–D도 통합·장애 시험을 수행한다. 사람이 다섯 명이어도 공통 schema와 신뢰 경계를 정하기 전에는 병렬 개발의 이득이 작다.

## 15영업일 순서와 일정 판정

- **1–2일:** 공통 스키마·허용 코드·입력 신뢰·검증 명제 확정. TEE 계정/권한 확인. 한 환경에서 결정 함수를 실행하고 결과 형식을 연결한다.
- **3–5일:** 실제 TEE attestation + 서명 검증을 통과한다. D는 작은 ledger fixture로 진짜 ZK proof를 만들고 생성 위치·비용·지연을 확인한다. 공개 API·실시간 커스텀 입력 경로를 각각 만든다.
- **6–10일:** 데이터→TEE 실행→paper fills/NAV→인증된 commitment→ZK proof→독립 검증까지 한 번 끝까지 연결한다. 백테스트와 realtime scheduler의 기록 형식을 통일한다.
- **11–15일:** 새로운 전략 기능은 동결한다. 재시작·중복·stale data·미제출·잘못된 버전·변조를 주입하고 72시간 연속 모의 운영을 관측한다. 마지막 결과는 paper로 표시하고 한계와 실제 측정값을 전달한다.

중간 판정:

1. **3일차 실제 TEE 접근/attestation이 안 되면** 같은 3주 완료를 확약하지 않는다. 일반 Docker 실행을 TEE 완료로 바꾸어 세지 않는다.
2. **5일차 실제 proof와 비밀성 경계가 안 잡히면** 검증할 metric/기록 길이를 줄이거나, 이번 결과를 TEE-only prototype으로 명시적으로 재정의한다. ZK가 필수 deliverable이면 미완료로 판단한다.
3. **10일차 end-to-end 연결이 없으면** UI·adapter 수·전략 수를 줄인다. 인증·원자료 연결·실패 기록을 제거하면서 검증 성공이라고 표시하지 않는다.

## 3주에 완료했다고 말할 수 있는 결과

- 7개 결정 함수가 공통 패키지에 들어가며, 최소 두 실제 외부 feed와 하나의 실시간 custom path를 처리한다.
- 승인된 실행기가 실제 TEE에서 실행하고, 결과 변조와 잘못된 key/measurement를 거부한다.
- 한 종류의 backtest/paper account 기록을 만들고 정상/실패/누락을 구별한다.
- 인증된 기록에 연결된 실제 ZK 검증 하나가 작동한다. 전체 전략 계산의 ZK proof라고 설명하지 않는다.
- 독립 verifier와 재현 가능한 demo, 72시간 paper 운영 기록이 있다. 이것은 상용 SLA나 장기간 신뢰성의 증거가 아니다.

고객 자금의 상시 운용, 임의 악성 코드에 대한 multi-tenant 보안, 모든 framework·모든 API·GPU 모델, 7종 전체 데이터 파이프라인과 과거 시점 데이터, cross-venue hedge execution, 외부 보안 감사까지는 이 견적에 포함하지 않는다.
