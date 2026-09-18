# Alpha Provider Fund — 프로토타입 구현 요구사항

> 후속 v2 구현과 최신 상태는 [Pilot 개발명세](pilot/development-spec.md), [실행 안내](pilot/runbook.md), [재현 결과](evidence/pilot-readiness.md)를 따른다. 아래 PAPER v1 규칙과 과거 검증 기록은 비교용으로 보존한다.

작성: 2026-09-18 · 버전: 0.1 · 제품 방향: alpha provider fund · 이 문서의 범위: 현재 프로토타입 구현 계약

원본에서 합의한 제품은 퀀트 모델·인간 트레이더·AI agent가 전략 코드 없이 alpha vector를 제출하고, 사전 제출 고정·집계·실제 거래·미래 시장 결과 관측·기여도 평가·가중치 조정·보상·반복을 수행하는 fund다. Monad는 commitment뿐 아니라 실제 자본·지분·체결·NAV·지급의 원장이어야 한다.

**현재 구현은 원본의 충분한 MVP가 아닌 로컬 프로토콜 프로토타입이다.** 사용자가 명시적으로 미룬 것은 TEE뿐이다. 합성·사용자 입력 가격, PAPER 거래·자본, reward credit으로 범위를 축소한 것은 에이전트의 구현 선택이며 사용자가 승인한 제외가 아니다. 이 문서는 그 구현의 계약을 보존하며 원본 제품 요구사항을 대체하지 않는다.

이전 “비공개 Python 전략을 TEE에서 실행” 문서는 [원문 보관 디렉터리](archive/legacy-tee/)에 보존한다. [개발명세](development-spec.md)는 현재 데이터·API·수식 계약, [작업 계획](three-week-execution-plan.md)은 작업 배분 기록, [수용시험](acceptance-tests.md)은 로컬 동작 검증 기준이다. 원본 대비 제품 완료 판정은 [MVP 준비도 판정](mvp-readiness.md)을 따르며 로컬 시험 통과만으로 대체하지 않는다.

## 1. 현재 프로토타입과 남은 기능

| 구분 | 현재 프로토타입 범위 | 현재 미구현·미검증 기능 |
|---|---|---|
| 입력 | provider 등록, 브라우저에서 alpha 입력·서명·암호화, 공통 vector | SDK 배포, 외부 quant 시스템의 안정적인 연동 |
| 제출 기록 | 고정 roster, cutoff, 미제출 기록, receipt, Merkle root | 독립 timestamp·공개 enrollment 기록·감사자 |
| 비공개 처리 | 서버에 대한 암호화 전송 envelope, 암호문 저장, 공개/개인 응답 분리 | TEE 격리·attestation·운영자 접근 차단 |
| 합성 | 사전 고정 weights, provider cap, netting, 단순 risk cap | 성과·상관관계·capacity 기반 weight 정책 |
| 거래 | aggregate target, rebalance delta, 비용을 포함한 PAPER book | DEX adapter, 실제 체결·잔고 대사·슬리피지 분석 |
| 평가 | prediction, standalone shadow, 한 epoch contribution, completeness | 검증된 feed, 장기 forward 이력, robust statistical scoring |
| fund | 모의 입금·shares·출금·NAV·보상 credit | 실제 investor vault, 자금 수탁, 실제 reward 지급 |
| chain | commitment registry 계약·로컬 EVM 배포/기록/조회 demo | Monad testnet 배포·finality 확인·운영 |
| 사용자 경험 | provider 제출, fund 현황, track record, epoch/receipt 검토 | 다중 사용자 배포, production 인증·모니터링 |

이 표는 현재 구현의 경계를 설명하며 오른쪽 열 전체가 MVP 이후로 승인됐다는 뜻이 아니다. 실제 시장 결과·거래·자본·지급과 시점 증거의 미충족 여부는 원본 기준으로 판정한다. 실제 구현·시험 통과 여부는 전달 시점의 결과와 대조하며 localhost PAPER/LOCAL_EVM 결과를 실거래·Monad testnet·TEE 결과로 표시하지 않는다.

## 2. 신뢰 경계와 표현

Provider의 코드·원데이터·판단 과정은 provider 장치에 남는다. 서버는 vector만 받지만, **TEE가 없는 이번 버전의 서버 운영자는 복호화된 vector를 읽을 수 있다.** 브라우저 envelope와 암호문 저장은 저장 파일·일반 공개 API의 노출을 줄이며 운영자에 대한 기밀성을 제공하지 않는다. 로컬 개발 HTTP는 원격 배포의 전송 보안이 아니다.

서버는 수신시각·시계·등록 roster·가격 입력·계산·DB를 관리하는 신뢰 주체다. provider 서명은 등록한 키가 그 내용을 승인했다는 의미이며, 제출자가 직접 만든 전략·사전 지식의 부재·성공적인 거래를 증명하지 않는다. 서명으로 잘못된 미래 시각을 넣더라도 서버가 인정하는 cutoff 판정을 바꿀 수 없어야 한다.

Merkle receipt는 특정 leaf가 특정 root에 포함됐는지 검증한다. 로컬 root 또는 hash chain만으로 운영자가 전체 과거 DB와 시계를 바꿀 수 없다는 주장을 하지 않는다. 독립적으로 보관한 과거 root나 외부 chain anchor가 있어야 그 기준 이후의 변경을 검출할 수 있다. 외부 root가 존재해도 결과 구간 시작 전에 확정됐는지, 사전 roster가 완전했는지, 계산이 정직했는지는 별도 문제다.

공개 aggregate target·trades로 fund의 행동을 관찰하거나 복제할 수 있다. provider concentration cap은 노출 집중을 줄이는 정책이며 암호학적인 익명성 보장이 아니다. 운영자가 선택한 public key 자체의 진실과 계정/키 소유권도 운영환경 인증에 의존한다.

화면·API에는 환경과 근거를 구분해 표시한다: DEMO 또는 FORWARD, SYNTHETIC 또는 USER_ASSERTED 가격, PAPER 회계, LOCAL_COMMITMENT 또는 LOCAL_EVM 기록, TRUSTED_SERVER 및 TEE_NOT_IMPLEMENTED. 존재하지 않는 attestation·ZK proof·Monad transaction hash를 만들어내지 않는다.

## 3. 현재 프로토타입 규칙

### R01 — Provider와 영구 이력 · A+B · T01/T02

Quant/Human/AI는 provider의 설명일 뿐 입력·평가 계약은 같다. provider ID와 검증 public key를 연결하고 등록·활성 기간을 보존한다. 과거 기록 삭제나 새 이름으로 실적을 합쳐 좋은 기간만 보여주는 기능을 제공하지 않는다. 실명 확인·중복 계정 탐지는 후속이며 ID가 사람 1명 또는 독립 전략 1개임을 보장하지 않는다.

### R02 — 하나의 alpha 계약 · A+C · T03

버전·provider·epoch·고정 universe·nonce와 서명을 갖는 vector를 받는다. 자산별 값은 -1부터 +1까지이며 같은 단위/순서/정밀도를 적용한다. 코드·모델 파일·개인 데이터셋은 제출하지 않는다. 누락/중복 자산, 추가 자산, 잘못된 크기·범위·유한성이 없는 숫자, 잘못된 키·서명을 거부한다.

### R03 — 암호화와 접근 범위 · A+B+E · T04

브라우저는 Ed25519로 원문을 서명하고 AES-GCM으로 내용을 암호화하며 AES 키는 서버 RSA-OAEP 키로 감싼다. SQLite submission에는 envelope 암호문과 필요한 commitment·메타데이터를 저장한다. public 응답·일반 로그는 개인 alpha·nonce·private key를 포함하지 않는다. 다른 provider의 개인 조회를 거부한다. 서버 키는 로컬 신뢰 경계 안에 있으므로 TEE에 준하는 보호라고 부르지 않는다.

### R04 — 사전 동결 · B+C · T05

epoch를 열 때 schedule, cutoff, 평가 구간, universe, roster, policy version, weights를 고정한다. 새 provider 등록과 다음 정책 변경은 이미 열린 epoch를 바꾸지 않는다. weight 합은 1 이하, 개별 provider cap 이하이며 남는 allocation은 무노출로 남긴다.

### R05 — 수신과 마감 · A+B · T06/T07

서버 수신시각이 cutoff보다 이른 요청만 받는다. provider의 claimed timestamp로 판정하지 않는다. provider·epoch당 canonical submission은 하나이며 동일 요청 재시도는 원결과로 귀결되고 서로 다른 두 번째 제출은 conflict로 남긴다. 정각·마감 뒤 제출과 잘못된 요청이 기존 승인 내용을 덮어쓰지 않는다.

### R06 — 결석을 포함한 완전성 · B+C · T08

봉인 시 사전 roster의 각 provider에 SUBMITTED 또는 MISSED 결과를 정확히 하나 부여한다. MISSED는 zero alpha로 합성하고 frozen weight를 유지한다. 결석자의 weight를 제출자에게 나누지 않는다. completeness의 분모는 활성 등록 기간의 필수 epoch이며 나쁜 기간·결석 epoch를 조용히 제거하지 않는다.

### R07 — Commitment와 receipt · A+B+D · T09/T10

canonical serialization과 domain separation, 256-bit nonce, SHA-256 leaf와 위치 기반 Merkle proof를 사용한다. epoch manifest가 제출 root와 사전 정책·roster·weights를 함께 가리키게 한다. nonce·개인 vector는 공개 root와 함께 공개하지 않는다. provider는 자기 receipt를 확인할 수 있고 제3자 verifier는 공개 proof의 포함 여부를 검사할 수 있다. 포함 증명과 시간증명을 분리한다.

### R08 — 상태 전이와 한 번만 반영되는 회계 · B · T11

제출 가능·봉인·실행·결과 대기·평가 완료 상태를 분리하고 순서를 검사한다. 봉인·평가·입출금 같은 mutation에 고유 ID와 transaction 경계를 적용한다. 재시도·재시작이 같은 NAV 변화·shares·reward를 다시 반영하지 않는다. 잘못된 상태의 요청은 명시적 오류를 반환한다.

### R09 — 합성·netting·risk · C · T12/T13

먼저 frozen weight로 vector를 더하고 자산별 상쇄 후 하나의 aggregate target을 만든다. provider cap, single asset cap, gross exposure cap은 명시적인 정책이다. 기본 최소 제출자 수 3명에 미달하면 SKIPPED로 기록하고 기존 drifted 보유분을 유지한다. 이때 신규 target의 cap을 기존 포지션에 다시 강제하지 않으므로 가격 변화 후 보유비중이 cap을 넘을 수 있다. policy에 없는 volatility targeting·liquidity/capacity 최적화를 구현했다고 표시하지 않는다. 필요한 rebalance는 현재 PAPER book과 final target의 차이로 만든다.

### R10 — PAPER 실행의 의미 · C+D · T14

서명 있는 방향성 노출과 이후 자산 수익률을 사용하는 synthetic linear PAPER book을 구현한다. 수수료·slippage 가정·turnover·목표 대비 delta와 NAV를 기록한다. short signal은 가능한 수학적 노출이며 실제 현물 대차나 파생상품 증거금·funding·청산을 모사한 것으로 주장하지 않는다. 실제 체결 목록처럼 보이는 경우에도 PAPER 표기를 유지한다.

### R11 — 결과 입력과 시간 · B+C · T15/T16

DEMO는 분리한 가상 시계·합성 가격으로 리뷰에 필요한 즉시 반복을 지원한다. FORWARD는 실제 서버 시간과 종료된 평가 구간만 허용한다. 현재 수동 가격 입력은 USER_ASSERTED이며 권위 있는 oracle·거래소 인증으로 표시하지 않는다. 시작/종료 가격은 양의 유한값이어야 하고 동일 universe·평가 구간에 연결한다. 누락 가격은 미평가이며 0% 수익으로 대체하지 않는다.

### R12 — Prediction quality · C · T17

신호와 다음 구간 return의 관계를 별도 표시한다. 방향 적중률의 유효 표본 수와 IC/correlation의 계산 가능 여부를 함께 낸다. 상수 vector·분산 0·표본 부족은 null/계산 불가로 표시하며 임의의 0이나 완벽한 예측으로 바꾸지 않는다.

### R13 — Standalone shadow · C · T18

각 provider의 vector를 같은 risk·비용 가정으로 독립 평가한다. 결석 epoch에서도 평가 book을 지우지 않으며 zero target에 따른 position 변경 비용을 반영한다. 누적 NAV·drawdown·turnover·표본 수를 제공하고 실제 운용 성과와 분리한다. 샘플 부족한 Sharpe를 수치로 꾸미지 않는다.

### R14 — Portfolio contribution · C · T19/T20

같은 epoch와 frozen weights에서 전체 portfolio와 provider 하나의 신호를 0으로 만든 portfolio를 비교한다. 다른 provider weights는 유지하고 risk·비용을 양쪽에 적용한다. 프로토타입의 한 epoch leave-one-out contribution은 다음 epoch에 대한 marginal 비교이며 장기 독립 counterfactual book이나 실제 PnL의 가산 귀속이 아니다. 여러 contribution의 합이 fund PnL과 같다는 제약을 걸지 않는다.

### R15 — Weight와 credit 정책 · C+B · T21

현재 epoch weight는 결과 이후 바꿀 수 없다. 프로토타입은 이전 30개 확정 epoch의 shadow return·양의 contribution·completeness·drawdown을 사용하는 명시적 heuristic으로 다음 epoch weight를 정한다. 통계적 최적 weight나 검증된 투자상품 정책으로 부르지 않는다. reward는 지급되지 않은 credit이며 positive contribution을 고정 pool 안에서 나눈다. 양의 기여가 없으면 배정 0이며 음수 지급·0 나누기·pool 초과를 허용하지 않는다. 실전 현금 지급 규칙으로 확정됐다고 표현하지 않는다.

### R16 — PAPER investor accounting · B+C+D · T22

모의 입금·share 발행·출금·share 소각을 NAV/share price에 연결한다. 외부 현금 흐름은 투자 수익률에서 분리하고 잔액 초과 출금·중복 반영을 막는다. 평가 구간 중 flow가 있는 경우의 기준을 고정하고 모호하면 mutation을 막는다. 이 기능은 로컬 ledger이며 실제 지갑 예치·온체인 ERC-4626 vault가 아니다.

### R17 — Chain commitment · D · T23/T24

EpochCommitmentRegistry는 immutable publisher만 epochKey/root/manifestHash를 한 번 기록하게 한다. 0 digest·중복 epoch·권한 없는 발행을 거부하고 event와 조회를 제공한다. 계약은 funds를 받지 않는다. 로컬 EthereumJS VM에서 실제 EVM bytecode를 배포하고 supplied manifest를 기록·재조회한다. 이 증거는 LOCAL_EVM이며 Monad 거래 증거가 아니다.

### R18 — 검토 가능한 화면과 도구 · E+A · T25

등록→alpha 입력→제출 receipt→봉인→aggregate target/PAPER 거래→결과 입력→세 평가→credit 흐름이 연결되어야 한다. 공개 fund 화면과 provider 개인 화면을 구분하고 demo reset은 실제 forward 기록을 지우지 않는다. 설치·실행·재현 명령, 신뢰 한계, proof의 검증 범위를 함께 제공한다.

### R19 — 운영 최소조건 · A+B+E · T26

서버는 기본 localhost에서만 동작하고 요청 크기·잘못된 JSON·허용 method/path를 검사한다. secret 파일과 runtime DB는 source control에서 제외하며 재시작 시 필요한 key/state를 복구한다. localhost 단일 운영자 버전의 인증을 production 다중 tenant 보안으로 확대 해석하지 않는다.

### R20 — 범위와 증거의 추적성 · 전원 · T27

각 요구사항에 담당 ticket·시험을 연결하고 실제 command·환경·결과를 기록한다. NOT_RUN/BLOCKED와 PASS를 구분한다. 사용자가 보류한 TEE 자체를 현재 제품의 blocker로 삼지 않는다. Monad·실거래·시장 관측·자본·지급의 미구현을 승인된 범위 제외로 간주하지 않고, 로컬 프로토콜 검증과 원본 제품 완료를 별도로 판정한다.

## 4. 프로토타입 검증과 제품 완료 판정

R01–R20의 로컬 동작 증거는 프로토타입의 구현 검증이다. 이를 모두 통과해도 원본에서 합의한 MVP가 완료되는 것은 아니다. 현재는 외부에서 확인할 수 있는 사전 commitment, 실제 미래 시장 관측, aggregate 체결, 투자자 자본·지분·NAV·환매, provider 지급을 연결한 제품 증거가 부족하다. 계약의 로컬 EVM 실행은 존재하지만 이 흐름을 대신하지 않는다.

판정 근거와 남은 gate는 [MVP 준비도 판정](mvp-readiness.md)에 기록한다. `rtk npm run prove:mvp`로 근거를 재현하고 `rtk npm run prove:mvp -- --strict`로 제품 완료를 검사한다. strict 실행은 제품 조건 미충족 시 종료 코드 `2`를 반환한다. 실제 자금 연결의 custody·venue·회계·중단/복구 설계는 필요한 구현 과제이며, 미구현 상태를 완료로 선언하는 근거가 아니다.
