# 5명 작업 분배와 후속 3주 계획

> 후속 v2 구현과 최신 상태는 [Pilot 개발명세](pilot/development-spec.md), [실행 안내](pilot/runbook.md), [재현 결과](evidence/pilot-readiness.md)를 따른다. 아래 PAPER v1 규칙과 과거 검증 기록은 비교용으로 보존한다.

작성: 2026-09-18 · 기준: Alpha Provider Fund 요구사항 v0.1

**범위 정정:** 아래의 기존 “MVP” ticket과 R/T gate는 에이전트가 축소한 로컬 프로토콜 프로토타입의 구현·검증 계획이다. 원본에서 합의한 alpha fund의 제품 인수 조건을 대체하지 않으며, 현재 구현은 충분한 MVP가 아니다. 사용자가 명시적으로 미룬 것은 TEE뿐이다.

F ticket의 가격 feed·사전 anchor·실제 venue 체결·vault·payout은 원본 제품 흐름을 완성하기 위한 미완료 작업이다. “후속”이라는 분류나 자금 구현의 추가 설계 필요성이 이 기능들을 사용자가 제외했다는 뜻은 아니다. 원본 대비 제품 gate와 구체적인 RCV 후속 ticket의 A–E 역할 배분은 [MVP 준비도 판정](mvp-readiness.md)을 따른다. `rtk npm run prove:mvp`로 근거를 재현하고, `rtk npm run prove:mvp -- --strict`는 제품 조건 미충족 시 종료 코드 `2`를 반환한다.

팀이 현재 프로토타입을 읽고 검토할 수 있게 책임·구현물·다음 작업을 나눈다. 이미 작성된 코드를 각 담당자가 인수하고 시험 증거와 함께 판정한다. 아래 기존 ticket 상세는 구현 이력으로 보존하며 PASS나 제품 완료 선언이 아니다. 기존 TEE 중심 3주 계획은 [원문 보관](archive/legacy-tee/three-week-execution-plan.md)에 남긴다.

## 1. 소유권

| 담당 | 주 책임과 소유 경로 | 반드시 교차 검토할 사람 |
|---|---|---|
| A · 프로토콜/보안 | src/shared/, server crypto, provider SDK, receipt verifier, 향후 TEE | D가 hash/서명, B가 수신·키 보존 확인 |
| B · 플랫폼/epoch | server service/store/http, clock·roster·transaction·flows | A가 private/public 응답, C가 시간·회계 확인 |
| C · 퀀트/평가 | src/core/, weight/risk·PAPER math·shadow·contribution·fixture | D가 체결 비용, B가 historical input 확인 |
| D · 실행/chain | contracts/, chain-demo, paper plan 검토, 후속 venue/anchor | A가 contract/commitment binding, C가 delta/비용 확인 |
| E · 제품/통합 | src/web/, 개발 실행·build, 사용자 흐름·문서·browser QA | B가 API, A가 키 UX와 보장 표현 확인 |

공유 계약은 A가 protocol bytes, B가 API와 persisted state, C가 수식을 각각 소유하고 공동 변경은 해당 3명이 동의한 version으로 묶는다. 서로 다른 worker가 같은 파일을 동시에 수정하지 않는다. 공통 schema를 먼저 읽고 분리 가능한 소유 경로에서 작업한다.

## 2. 이번 MVP 인수 ticket

| ID | 담당 | 요구사항/시험 | 선행 | 산출물·종료 조건 |
|---|---|---|---|---|
| A01 | A | R02/R07 · T03/T09 | 없음 | canonical JSON, Ed25519 key/sign/verify, shared golden payload. key·payload·epoch mutation 거부 |
| A02 | A | R03 · T04 | A01 | AES-GCM/RSA-OAEP envelope, 크기/encoding 검증. DB에 원문 vector·nonce·사용자 private key 없음 |
| A03 | A | R05/R07 · T07/T10 | A01,B02 | 서명된 accept/final receipt, 개인 조회 token, 독립 verifier. trusted key를 별도 받으며 wrong key/root/proof 거부 |
| A04 | A+E | R18/R19 · T25/T26 | A02,A03,B01 | 브라우저/로컬 SDK signing 경로와 public key 보존. 로그/에러 canary 검사, localhost 한계 표시 |
| B01 | B | R01/R03/R19 · T01/T04/T26 | A01 | SQLite/key 보존, provider 등록, public DTO, request limit·localhost guard |
| B02 | B | R04/R05/R06 · T05–T08 | B01,C01 | 고정 roster/policy/weights, cutoff, first valid submission, MISSED·완전성, 동일 retry 처리 |
| B03 | B | R08/R11 · T11/T15/T16 | B02,C02 | OPEN→AWAITING_OUTCOME→EVALUATED/EXPIRED, demo/forward 분리, mark 검증·atomic settlement |
| B04 | B | R16 · T22 | B03,C03 | 모의 share 발행·소각·active epoch lock, requestId 멱등·초과 출금 거부·flow 분리 |
| B05 | B+E | R18/R20 · T25/T27 | A03,B03,B04,D02 | 실제 HTTP API/manifest export, 공개 field 검토, 설치·실행·시험 증거 모음 |
| C01 | C | R04/R09/R15 · T05/T12/T13/T21 | 없음 | provider cap10%, 이전30 EVALUATED/EXPIRED heuristic, frozen weights, 최소3 cohort, no-reweight fixtures |
| C02 | C | R09/R10 · T12–T14 | C01 | netting/risk/delta/slicing, 거래 비용 한 번 차감, drifted holdings, gap mark, 파산 표시 |
| C03 | C | R12/R13 · T17/T18 | C02 | IC/hit/null, standalone shadow·MISSED 청산, NAV/MDD/turnover. Sharpe 미산출 명확화 |
| C04 | C | R14/R15 · T19–T21 | C02,C03 | fixed-weight 한 epoch LOO, counterfactual cohort 재적용 금지, credit pool·잔여 처리 |
| C05 | C+B | R08/R11/R16 · T11/T15/T22 | C04,B03,B04 | 과거 EVALUATED/EXPIRED만 weight에 제공·미제출 반영, gap mark/flow·정산 반례 검토 |
| D01 | D | R17 · T23 | A01 | immutable publisher registry, nonzero root/manifest, duplicate/unauthorized/funds 거부 |
| D02 | D | R07/R17 · T09/T24 | D01,B03 | manifest export→실제 local EVM deploy/anchor/read, source/compiler/환경 evidence |
| D03 | D+C | R10/R16 · T14/T22 | C02,B04 | PAPER order fee/slippage/delta·flow 의미 검토, 실제 현물/파생시장과의 차이 기록 |
| D04 | D+A | R17/R20 · T24/T27 | D02 | Monad testnet 설정 예제·배포/복구 runbook. 실제 testnet 배포 결과는 별도 미완료 상태 |
| E01 | E | R18 · T25 | B01,C01 | fund/provider/epoch 화면 정보구조, 환경·신뢰·표본수 표시, null 지표 UX |
| E02 | E+A | R02/R03/R18 · T03/T04/T25 | E01,A02,B02 | 브라우저 등록→alpha 서명·암호화 제출→개인 receipt 확인 |
| E03 | E | R10–R16/R18 · T14–T22/T25 | E01,B03,B04,C04 | 봉인·평가·PAPER shares·3 평가·credit 화면 연결, 합성/forward workspace 구분 |
| E04 | E+전원 | R18–R20 · T25–T27 | 모든 MVP ticket | clean build·대표 화면 실제 조작·정상/실패 흐름·문서 링크·검증 기록·사용자 리뷰 |

각 ticket은 코드가 존재하는 것과 지정 환경에서 시험을 통과한 것을 구분한다. D04는 준비물 작성이 이번 범위이며 testnet transaction이 생겼다는 뜻이 아니다. E04에서 남은 FAIL/NOT_RUN을 함께 공개한다.

## 3. 후속 backlog

| ID | 담당 | 선행 | 구체 작업 | 완료 증거 |
|---|---|---|---|---|
| F-A01 | A | A04 + TEE 공급자 결정 | vector decrypt+engine+receipt key를 동일 confidential boundary에 배치, attestation/key pinning | 일반 host가 canary vector를 읽지 못하고 잘못된 measurement에 client가 전송 거부 |
| F-A02 | A+B | B05 | 실제 사용자 auth·권한·key rotation/revocation·rate limiting·secret lifecycle | 다른 계정의 기록 접근 거부, 폐기 key의 미래 제출 차단, 과거 서명은 검증 가능 |
| F-A03 | A+D | F-D01 | roster 사전 anchoring, receipt 독립 보관, deadline 전 확정 검증 | omitted provider·late anchor·forked root 시나리오가 구분됨 |
| F-B01 | B+C | B03 | 가격 공급자 adapter·관측시각·source/raw digest·stale/revision 정책 | 실제 forward에서 source/시각/누락 provenance를 재검토 가능 |
| F-B02 | B+E | F-B01 | 실제 시간 72시간 관측·중단/복구·스케줄 자동화 | 예상 slot 대조, 누락/재시작 증거, synthetic replay와 별도 결과 |
| F-C01 | C | C05 + 충분한 forward 표본 | weight heuristic 검증, 비교 baseline, regime/상관관계·concentration 연구 | future leakage 없는 walk-forward 결과와 holdout/불확실성 보고 |
| F-C02 | C+B | F-C01 | 장기 LOO book 또는 다른 attribution 정책 비교·버전 관리 | 수수료/경로의존성·상쇄·caps 반례, 사전 고정한 평가 계약 |
| F-D01 | D+A | D04 + testnet RPC/계정 | Monad testnet registry 배포, real epoch anchor, chainId/address/source 보존 | 실제 tx·finality·readback·timeliness. LOCAL_EVM 증거로 대체 불가 |
| F-D02 | D+C | F-B01 | 하나의 허용 venue에서 aggregate target→주문·실제 fill·잔고 대사 | partial fill/reject/retry·idempotency·stale mark·비용 대사 |
| F-D03 | D+B | F-D02 + 별도 자금 운용 범위 결정 | investor vault shares, capital flows, custody, NAV·출금 대기, payout | 실제 자산 보전·share 회계·중단 시 복구 검토 및 별도 release 판정 |
| F-E01 | E+C | F-B02 | forward age·sample size·정책 version·오류 이력 UX, credential export | 전체 history를 보존하고 좋은 기간만 골라 인증하지 않음 |

TEE가 없어도 F-B01/F-D01/통계 검토는 병렬 진행할 수 있다. TEE 도입이 가격 진실·누락 공개·통계적 유효성·실제 체결을 자동 해결하지 않는다. 실제 vault와 payout은 commitment contract에 억지로 붙이지 않고 별도 자금 모듈로 설계한다.

## 4. 팀 리뷰 이후 3주 배치안

이 일정은 5명 전담 가정의 작업 순서이며 외부 계정·인프라가 확보됐다는 약속이 아니다. TEE 할당은 현재의 시작 조건이 아니다. 실제 72시간 관측은 달력 시간을 필요로 하며 가속 demo로 대체할 수 없다.

| 시점 | 주 목표 | 병렬 작업 | 판정 |
|---|---|---|---|
| D1–D2 | MVP 인수·수식/보장 리뷰 | A protocol, B state/flows, C math, D chain, E browser | R/T matrix와 반례 확인, 심각 결함 먼저 수정 |
| D3–D5 | 외부 근거 준비 | F-B01 feed, F-D01 testnet, F-A02 auth, F-C01 평가 baseline | actual price provenance와 실제 chain evidence 확보 여부 분리 |
| D6–D8 | forward 통합·장애 검증 | schedule/restart, delayed anchor, stale prices, counterfactual 검토 | 시점·누락·회계의 조용한 손실 0 |
| D9–D12 | 72시간 pilot 관측 | F-B02 관측, E credential UX, C 표본 분석 | 실제 경과·전 slot 상태·실패 이유·비용 확인 |
| D13–D15 | 사용자 리뷰·다음 투자 범위 | 숫자 의미·copy risk·reward fairness 검토, F-D02 준비 | pilot과 custody release를 따로 판정 |

TEE는 공급자/가용성 확인 뒤 F-A01의 별도 일정으로 잡는다. 3주 내 반드시 완료한다고 약속하지 않는다. 실주문·실제 투자자 자금은 위 pilot 일정에 자동 포함하지 않는다.

## 5. 작업 ticket과 인수 형식

~~~yaml
id: C04
owner: C
reviewer: B
requirements: [R14, R15]
tests: [T19, T20, T21]
depends_on: [C02, C03]
allowed_paths: [src/core/, tests/engine.test.js]
protocol_version: 1
policy_version: alpha-policy-v1
environment: LOCAL
deliverables:
  - code
  - deterministic fixtures
  - exact command and result
  - remaining limitations
status: NOT_STARTED | IN_PROGRESS | REVIEW | PASS | FAIL | BLOCKED
~~~

완료 선언에는 구현 SHA 또는 파일 version, exact command, 환경, 실제 결과와 미실행 사유가 필요하다. 에이전트가 “완료”라고 쓴 것만으로 PASS로 바꾸지 않는다. 수식/직렬화가 바뀌면 관련 baseline도 버전과 함께 검토한다. 이미 통과한 시험을 무조건 반복하지 않고 변경 영향·실패·미해결 우려가 있는 시험을 다시 실행한다.

현재 문서는 recurring automation이나 24/7 worker를 생성하지 않는다. 팀이 이 표를 작업 도구에 옮길 때도 유료 인프라·외부 공개·자금 운용 범위를 개별 ticket에 명시한다.
