# 5명·3주·24/7 에이전트 실행 계획

작성: 2026-09-17 · 상태: 실행 전 계획. 에이전트·cloud 자원·예약 작업을 이 문서 작성 과정에서 가동하지 않았다.

[요구사항](requirements.md)은 범위, [인수 시험](acceptance-tests.md)은 완료 판정의 기준이다. 이 문서는 의존성·담당·일정만 관리한다. 모든 W01–W14 작업의 현재 상태는 NOT_STARTED다.

## 1. 가능 여부를 판단하는 전제

**5명이 관련 경험을 갖고 실제 TEE 접근 권한을 첫날 확보한다면, 3주 목표를 CORE+ZK로 잡을 수 있다. 약속 가능한 결과는 제한된 backtest/paper 프로토타입이며 실제 자금 운용 시스템이 아니다.** 팀 경험·hardware·proof 성능은 아직 확인되지 않아 납기 확정이 아니다.

- 사람: 15영업일×5명=75인일. 여기서 D1–D15는 영업일이다.
- 에이전트: 최대21일×24시간=504시간의 작업 가능 시간. 여러 에이전트가 이를 병렬 사용해도 504시간을 사람 인일로 환산하지 않는다. provider rate limit·비용·review 대기가 있다.
- 24/7으로 늘릴 수 있는 것: 코드 작성·fixture·반복 재생·결함 조사·proving benchmark·사전 허용한 환경의 관측.
- 늘릴 수 없는 것: 누락된 과거 시점 데이터, TEE/GPU 기능, 공급자 계정 승인, 실제72시간 경과, 신규 보안 설계의 검토 신뢰도.
- 불확실성이 큰 순서: 실제 TEE에서 Python·키 격리·네트워크 연결 → confidential proving의 실제 비용 → 전체 상태 연속성 → 문서/UI.

시작 조건을 `project-manifest`로 기록한다: TEE provider/region/quota, Python 및 zkVM 후보, 접근 가능한 실제 API, 계정 권한, 비용 상한, 팀 담당자. 비밀키는 manifest에 넣지 않는다. 2일차까지 architecture/SDK 버전/예산을 고정한다. 이것은 조사해야 할 항목이며 현재 값이 있다고 가정하지 않는다.

## 2. 작업량 예산

기존 검토의 55인일을 유지하되 아래 요구사항에 대응시킨다. 이는 AI를 사용한다는 전제를 포함한 **계획 예산**이고 작업 시간 측정치가 아니다. 24/7 사용을 이유로 같은 절감 효과를 다시 적용하지 않는다.

| 영역 | 요구사항 | 계획 인일 |
|---|---|---:|
| package·SDK | R01–R02 | 6 |
| 데이터·커스텀 변환 | R04–R07 | 8 |
| runtime·paper 회계·기록 | R08–R10, R17 | 7 |
| TEE·기밀성·격리 | R03, R11–R13 | 8 |
| 일정·복구·버전 | R14–R16 | 5 |
| 선택 ZK·prover | R18–R20 | 7 |
| API·화면·export | R21–R22 | 6 |
| 성능·통합·장애·관측 | R23–R24 | 8 |
| **계획 합계** | | **55** |
| **미배정 여유** | 통합·학습·리뷰·재작업 | **20** |

CORE는48인일, CORE+ZK는55인일을 계획한다. W 작업은 위 예산의 구현 순서이며 추가 인일이 아니다. D5에 실제 처리량과 남은 결함으로 추정을 갱신한다. 하루 에이전트 token 수·commit 수는 진척 지표로 사용하지 않는다.

## 3. 5명과 에이전트의 작업 소유권

경로는 앞으로 만들 구현 구조의 제안이다. 현재는 research와 요구사항 문서가 출발점이다.

| 담당 | 소유할 구현 | 에이전트에 맡길 독립 작업 | 교차 검토 |
|---|---|---|---|
| A: TEE/보안 | `tee/`, `security/` | build/attestation 예제, key 전달, hostile fixture, 실제 허용 환경 배포·로그 분석 | D가 key·receipt 검증 경로 검토 |
| B: 데이터 | `adapters/`, `transforms/` | 두 공급자 adapter, signed publisher, replay·시간·revision fixtures | C가 cutoff와 미래 참조 검토 |
| C: runtime/회계 | `runtime/`, `simulator/`, `ledger/` | SDK port, paper accounting, idempotency, crash matrix | B가 입력 재생, A가 supervisor 경계 검토 |
| D: ZK/검증 | `proof/`, `verifier/` | 고정 predicate·proof mode, 정수 reference, proof mutation, confidential benchmark | A가 prover 비밀 경계, C가 NAV 의미 검토 |
| E: 통합/API | `registry/`, `api/`, `ui/`, `ops/` | registry·scheduler·API·간단 화면, end-to-end harness, release 증거 | C가 head/epoch, D가 결과 표시 검토 |

`contracts/`의 공통 schema/hash vector는 E가 통합 소유하고 A–D가 초기 검토한다. 병렬 작업자가 이를 각자 바꾸지 않는다. 계약 변경은 새 버전과 영향받는 테스트·작업 목록을 붙인다. 모든 QA를 E에게 몰지 않으며 각 담당자가 자신의 정상·실패 경로 증거를 낸다.

## 4. 의존성이 있는 작업 목록

각 작업은 요구사항과 연결된 인수 시험을 통과해야 종료된다. 초기 spike 완료와 최종 요구사항 완료는 구분한다. mock으로 병렬 개발을 시작할 수 있지만 실제 의존성을 충족한 것으로 처리하지 않는다.

| 작업 | 담당 | 선행 작업 | 작업과 종료 조건 |
|---|---|---|---|
| W01 | 전원, 통합 E | 없음 | trust boundary, schema/hash vectors, proof statement, workload/budget manifest 고정. R01–R24의 해석 충돌 해소 |
| W02 | A | W01 | 실제 TEE hello-run, Python 실행, 키 생성·attestation·TLS forwarding·격리 가능성 확인. T16 초기 증거 확보 |
| W03 | D | W01 | 작은 실제 ZK proof와 true/false fixture, prover 위치·privacy path 확인. T25 일부와 실제 비용 확보 |
| W04 | E+C | W01 | package/SDK/registry 구현, 기존7개 함수의 adapter. R01–R02, T01–T02 로컬 확인; H 부분은 W08 뒤 완료 |
| W05 | B | W01 | 외부 API·file·signed custom·transform·시간 정책. R04–R07, T04–T10 로컬/실제 공급자 확인; H 부분은 W08 뒤 완료 |
| W06 | C | W04 | snapshot runtime·현물 회계·결정/체결 구분·NAV 기록. R08–R10/R17, T11–T15/T24 로컬 확인 |
| W07 | E+C | W04 | epoch 상태·state head·복구·version 종료. R14–R16, T20–T23 로컬 확인 |
| W08 | A+B+C | W02, W04, W05, W06 | 비밀 전달·TEE input→strategy→paper→receipt 연결과 격리. R03/R11–R13 및 W04–W06의 H 시험 완료 |
| W09 | D+A | W03, W06, W08 | canonical root→실제 ZK→결합 verifier, confidential n=256 benchmark. R18–R20, T25–T29 완료 |
| W10 | E+D+A | W07, W08 | API/화면/export와 별도 verifier. R21–R22의 CORE 경로 완료; ZK 표시/검증은 W09 후 추가 완료 |
| W11 | 전원 | W07, W08, W10 | CORE end-to-end·성능·crash·rate 시험. T21–T22 재통합, T30–T35 CORE 완료 |
| W12 | D+E | W09, W11 | CORE+ZK 최종 통합·지표 의미 검토. T27–T35의 ZK 확장 완료 |
| W13 | 전원 | W11; ZK 포함 시 W12 | release candidate 동결 후72시간 실시간 관측. T36 및 필요한 장애 주입 증거 완료 |
| W14 | 전원, 전달 E | W13 | 새 환경 verifier, 모든 증거/제외 범위 검토. 인수 matrix와 CORE/CORE+ZK 판정 공개 |

W02와 W03을 초반 병렬로 하는 이유는 hardware와 proving 한계가 뒤늦게 발견되는 것을 막기 위해서다. 작은 proof는 최종 n=256 성능·privacy 완료가 아니다. W09가 늦으면 W11까지 CORE 작업은 계속 진행할 수 있다.

## 5. 3주 일정과 중간 판정

| 시점 | 확인할 결과 | 실패했을 때 조치 |
|---|---|---|
| D1–D2 | W01 확정, W02/W03 실험, 계정·비용·quota 준비 | 외부 접근 문제부터 해소. 미확정 SDK·키 경계 위에 전체 구현을 쌓지 않음 |
| D3 gate | 실제 TEE attestation·키 결합·Python 경로, 격리 설계 가능 | 해결 가능 시간 재산정. 일반 container를 TEE로 대체해 완료 처리하지 않음 |
| D5 gate | 실제 작은 ZK proof, 비밀 witness 처리 경계, data·paper 로컬 연결 | privacy/비용 실패 시 CORE로 명시적 범위 변경 또는 CORE+ZK 납기 미확정. 필요 없는 ZK wrapper를 급히 붙이지 않음 |
| D6–D9 | W08, W07, W09, W10. 실제 API/custom→TEE→ledger→receipt | 인터페이스 mismatch·state 처리 우선 해결. 새 framework/모델 추가 금지 |
| D10 gate | W11/W12의 기본 end-to-end; 실제 n=256 비용 측정 | UI를 CLI로 축소하거나 optional ZK 제외 제안. 코드/입력 binding·실패 기록·비밀 경계를 제거해 납기를 맞추지 않음 |
| D11 | 최종 후보 동결, 잔여 fault 시험, W13 시작 | critical 결함이면 고치고 관측 시작을 연기. 일정 실패 가능성 공개 |
| D11–D14 | 실제72시간 및 세 NAV window 관측, 증거 검토 | NAV 결측·핵심 변경 시 필요한 기간 추가 확보. replay로 대체하지 않음 |
| D15 | W14, 재현 demo, actual cost/limits, 인수 판정 | BLOCKED/FAIL을 포함해 제출. 성공 문구를 바꾸어 문제를 숨기지 않음 |

주말/야간에는 승인된 범위의 코드·시험·벤치마크·관측을 계속할 수 있다. D10 통합이 늦어지면 72시간이 최종 경로의 병목이 된다. 여유20인일이 달력상72시간을 줄여주지 않는다.

## 6. 24/7 에이전트 큐 규칙

이 계획의 '승인된 범위'는 작업 범위·자원 한도를 의미한다. 매번 사람에게 재확인을 받는 흐름을 추가하지 않는다. 현재 요청은 계획 작성이므로 실제 큐·자동화 생성은 아직 수행하지 않는다.

각 ticket은 다음 정보를 갖는다.

```text
id / owner / requirements / test_ids
depends_on / allowed_paths / frozen_contract_version
expected_change / acceptance_cases / required_environment
resource_budget / max_attempts / timeout
deliverable_paths / evidence_paths / known_limits
```

1. 선행 작업과 frozen contract가 있는 READY ticket을 하나 가져온다. source control을 준비하고 독립 branch/worktree 또는 동등한 격리 공간을 사용한다. 현재 repo에 Git이 없다면 먼저 초기화/원격 정책을 팀 작업으로 정한다.
2. 정상 case와 위험한 실패 case를 함께 구현한다. 필요한 로컬 시험부터 실행하고, 해당 ticket이 허용한 실제 환경 시험을 수행한다. 다른 사람이 쓰는 shared schema·secret·배포환경을 임의 변경하지 않는다.
3. 결과에 exact command·artifact·NOT_RUN 사유를 붙인다. 테스트 mock은 mock으로 표시한다. worker의 '완료' 선언만으로 merge하지 않고 지정 교차 reviewer가 증거와 변경을 확인한다.
4. transient 오류는 최대3회와 ticket timeout 안에서만 재시도한다. 같은 infra 오류가 계속되면 BLOCKED로 남기고 독립 READY 작업으로 이동한다. 실제 원인이 바뀌지 않았는데 끝없이 polling하지 않는다.
5. changed/failed/affected checks부터 재실행한다. 이미 통과한 비싼 prove/72h 시험은 관련 변경·신규 실패가 있을 때 다시 수행한다. 최종 후보 변경 시 필요한 관측 재시작 원칙은 유지한다.
6. budget·rate·scope limit에 도달하면 해당 queue를 멈추고 결과와 blocker를 남긴다. agent가 quota를 늘리거나 새 유료 서비스를 무제한 활성화하지 않는다.

매 영업일 시작에 담당자는 밤사이 accepted changes, 실패 증거, integration head, cloud 비용, critical path를 확인한다. 사람이 집중할 검토는 trust boundary, 회계 의미, 사용자에게 표시하는 보장, 실제 테스트의 타당성이다. 일상적인 코드 수정·시험·문서 보완은 ticket 범위에서 계속 진행한다.

## 7. 일정 축소의 우선순위

1. 상세 UI를 CLI/단일 결과 페이지로 축소한다. R21의 변경 범위와 테스트를 함께 갱신한다.
2. 필요성이 검증되지 않은 ZK 확장을 제외하고 CORE 완료를 목표로 바꾼다. 사용자가 ZK 포함 완료를 필수로 정하면 CORE+ZK는 미완료로 보고한다.
3. 추가 provider·ML 모델·전략 raw pipeline·원클릭 adapter를 뒤로 미룬다. 원래 필수인 두 실제 공급자·custom 실시간 경로까지 줄이면 요구사항 변경으로 기록한다.
4. 실제 TEE, package/input/result binding, key 보호, canonical state, 누락 기록, 독립 verification을 제거하면 이 프로토타입의 목표가 사라진다. 이 중 하나가 해결되지 않으면 일정 실패 또는 설계 재검토로 판정한다.

## 8. 최종 전달물

- CORE 또는 CORE+ZK의 정확한 버전과 인수 matrix. 각 R에 연결된 T 결과와 proof/receipt artifact.
- 로컬 개발과 실제 TEE 배포를 구분한 실행 README, resource/budget manifest, key lifecycle·복구 runbook.
- API/file/custom 세 경로 demo, 제한된 backtest 결과, 실제72시간 paper 이력, 독립 verifier bundle.
- 실측한 latency/RAM/cost, 시험하지 않은 workload·잔여 신뢰·기능 범위.

**판정 단위는 동작하는 pipeline과 반례 시험이다. 코드량이나 밤새 일한 agent 수가 아니다.** 요구사항을 이 범위로 유지하면 3주 동안 무엇을 만들어야 하고 무엇이 실패했는지 명확하게 판단할 수 있다.
