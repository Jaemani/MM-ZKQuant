# Alpha Provider Fund — 수용시험

> 후속 v2 구현과 최신 상태는 [Pilot 개발명세](pilot/development-spec.md), [실행 안내](pilot/runbook.md), [재현 결과](evidence/pilot-readiness.md)를 따른다. 아래 PAPER v1 규칙과 과거 검증 기록은 비교용으로 보존한다.

작성: 2026-09-18 · 요구사항 v0.1 · 시험 환경: LOCAL, BROWSER, LOCAL_EVM

**범위 정정:** 아래 T01–T27은 에이전트가 축소한 로컬 프로토콜 프로토타입의 동작 시험이다. 전부 통과해도 원본에서 합의한 MVP가 충족되는 것은 아니다. 사용자가 명시적으로 미룬 것은 TEE뿐이며, PAPER 가격·거래·자본·credit으로 대체한 것은 승인된 제품 범위 제외가 아니다.

실제 미래 시장 관측·결과 이전 anchor·aggregate venue 체결·vault·provider 지급은 원본 제품 흐름의 미완료 조건이다. 작업 계획의 F ticket 전체를 사용자 승인 보류로 해석하지 않는다. 제품 gate와 A–E 역할별 RCV 후속 작업은 [MVP 준비도 판정](mvp-readiness.md)을 따른다. `rtk npm run prove:mvp`로 근거를 재현하고, `rtk npm run prove:mvp -- --strict`는 제품 조건 미충족 시 종료 코드 `2`를 반환한다.

이 문서는 해야 할 시험과 합격 조건을 정의한다. 결과표가 아니므로 아래 항목이 적혀 있다는 이유로 PASS로 간주하지 않는다. 실행 보고서에는 실제 command·환경·시간·결과·증거 경로를 별도로 기록한다.

LOCAL은 Node.js/SQLite의 로컬 구현, BROWSER는 localhost 화면의 실제 조작, LOCAL_EVM은 Solidity를 컴파일하고 EthereumJS VM에서 서명된 transaction으로 실행한 결과다. MONAD_TESTNET·LIVE_EXECUTION은 현재 미검증 제품 환경이며, TEE는 명시적으로 보류됐다. 어떤 환경도 LOCAL 결과로 대신할 수 없다.

## 1. 프로토콜·접근·기록

| ID | 요구사항/담당 | 준비·행동 | 합격 조건 |
|---|---|---|---|
| T01 | R01 · A+B | 서로 다른 HUMAN/QUANT/AI key를 등록하고 같은 key를 다시 등록 | 공통 contract로 등록, duplicate key 거부, stable ID/history 보존 |
| T02 | R01 · B | epoch 전후 provider 등록, 이름/유형과 평가 경로 비교 | 신규 provider는 이미 열린 roster에 삽입되지 않음, 유형 때문에 평가 정책이 달라지지 않음 |
| T03 | R02 · A+C | valid vector와 length·asset order·float·out-of-range·NaN/Infinity·wrong key·altered policy/epoch·nonce variant 제출 | 유효 서명만 수용, 잘못된 형식·내용 거부, 기존 승인 상태 불변 |
| T04 | R03 · A+B+E | canary vector/nonce로 제출, GCM ciphertext/tag/wrappedKey 변조, 다른 receipt token 사용, DB/public 응답/로그 검사 | 변조·타인 조회 거부, 원문 vector·nonce·사용자 private key가 submission DB/public 로그에 없음, 운영자 key 복호화 가능성 명시 |
| T05 | R04 · B+C | epoch를 열고 이후 provider/history/현재 policy를 변경한 뒤 이전 epoch 조회 | roster/policyHash/weights 고정, weights 합≤10000·provider cap 준수, 미래 history가 과거 weight를 바꾸지 않음 |
| T06 | R05 · A+B | 고정 clock에서 cutoff−1ms·cutoff·cutoff+1ms 신규 제출 | 직전만 수용, 정각/이후 거부. 클라이언트의 timestamp로 우회 불가 |
| T07 | R05 · A+B | 같은 payload를 재암호화/재시도, 이후 다른 vector 제출, 마감 뒤 기존 payload 재조회 | 최초 한 번만 기록, 동일 payload 원receipt, 다른 내용409, 늦은 retry가 새 제출로 세어지지 않음 |
| T08 | R06 · B+C | roster 일부만 제출, 전원 미제출, EXPIRED, 신규등록 전 period 비교 | 필수 provider마다 한 leaf; 결석 포함 required, 결석 weight 재분배 없음, 신규등록 전 period는 분모 제외 |
| T09 | R07 · A+D | 1/홀수/짝수 leaf tree, 정상 proof, bit/side/order/root/epoch mutation | 정상 포함 증명 성공, 변조 거부, odd self-sibling 규칙 일치, empty roster 차단 |
| T10 | R07 · A+B | accepted/final receipt export, 별도 saved public key로 CLI verify, wrong key/manifestHash/root 조합 | 서명·포함·manifest binding 독립 결과, wrong key/조합 거부, independentlyTimestamped=false 유지 |

T04는 모든 부채널의 부재나 악의적 운영자 접근 차단을 증명하는 시험이 아니다. public 지표만으로 개별 signal을 추론할 수 없는지에 대한 통계적 보장도 별도다.

## 2. 시간·수학·회계

| ID | 요구사항/담당 | 준비·행동 | 합격 조건 |
|---|---|---|---|
| T11 | R08 · B | seal/evaluate 반복·프로세스 재시작·잘못된 상태 요청·다른 outcome으로 재정산 | transition 검사, root/NAV/history/credit 중복 없음, 달라진 확정 outcome409, 실패 transaction의 부분 mutation 없음 |
| T12 | R09 · C | 상반된 alpha, 같은 방향 alpha, zero alpha, provider weight 합/cap 위반 | raw 합성·netting 값 정확, asset/gross cap, invalid weights 거부 |
| T13 | R09 · C | minProviders−1/동일/전원 결석, 10명 미만 cap10% weights | cohort 부족 SKIPPED/hold, 충분하면 READY, 잔여 weight 무노출. drifted holding 초과가 신규 cap 충족으로 표시되지 않음 |
| T14 | R10 · C+D | 알려진 NAV/기존 exposure/target/가격, 분할 기준 경계, 반대 방향 전환, 극단 손실 | delta·turnover·slice 수·fee/slippage 한 번 차감, drift/gap mark 정확, bankrupt/lossBeyondCapital 표시, 모든 실행 PAPER |
| T15 | R11 · B+C | forward에서 cutoff 전 봉인·end 전 결과, demo에서 가상 시간 진행, 늦은 close | forward 조기행동 거부, demo와 실제 workspace 분리, 늦은 close는 실제 startAt·원endAt 사용 |
| T16 | R11 · B+C | 0/음수/NaN/없는 가격·추가 자산·end 후 미봉인 epoch | invalid marks 거부, 누락을 return0으로 만들지 않음, 미봉인 EXPIRED 이유 유지, USER_ASSERTED 표시 |
| T17 | R12 · C | 방향이 모두 맞음/틀림/일부 neutral, 상수 vector/상수 returns/전부0/MISSED | hit denominator는 nonzero 쌍, IC가 정의되지 않으면 null, MISSED prediction null, 샘플 수 의미 구분 |
| T18 | R13 · C | 두 provider 같은 alpha, 한 provider만 missing, 이전 shadow 보유·가격 drift | 같은 표준화 성과, missing shadow 청산비용, NAV/peak/MDD/turnover 연속, Sharpe 미산출을0으로 표시하지 않음 |
| T19 | R14 · C | A 양의 BTC/B 음의 BTC 상쇄, BTC 상승, 비용0 fixture와 비용 유 fixture | A/B prediction·shadow·contribution 구분, LOO 다른 weights 재정규화 없음, risk/cost 양쪽 동일 |
| T20 | R14 · C | asset cap에 걸린 ensemble, cohort 정확히 min인 ensemble, 직전 actual position 있는 경우 | LOO에 cohort gate 재적용하지 않음, 이전 real book 공유, contribution합=PnL을 강제하지 않음 |
| T21 | R15 · C+B | 양의 contribution 없음/0 pool/여러 positive·negative, 과거 30개 EVALUATED/EXPIRED와 미래 미정산 history | credit nonnegative·총합≤pool·floor 잔여 보존, 만료된 미제출도 반영, 미래 outcome이 현재 weight에 영향 없음 |
| T22 | R16 · B+C+D | idle deposit/withdraw, active epoch flow, zero/초과출금, 같은 requestId retry·다른 payload | sharePrice 일관, active flow 차단, NAV chart의 flow type 구분·입금을 수익으로 계산하지 않음, 중복 shares/자본 증감0, request conflict409 |

T14의 short는 synthetic linear exposure다. 실제 borrowing, funding, margin, liquidation 검증으로 판정하지 않는다. T19/T20의 좋은 결과가 실제 돈을 나눌 공정성의 유일한 해답임을 증명하지 않는다.

## 3. Chain·사용자 흐름·전달

| ID | 요구사항/담당 | 준비·행동 | 합격 조건 |
|---|---|---|---|
| T23 | R17 · D | contract compile/deploy, zero publisher, outsider/zero digest/duplicate anchor, unknown epoch 조회, ETH 전송 | 잘못된 요청 revert, publisher immutable, 저장/event 동일, unknown zero, funds 전송 거부 |
| T24 | R17 · D+A | 서버의 실제 봉인 manifest export를 chain-demo --manifest로 입력해 local deploy/anchor/read | exported root/manifestHash와 mapping 일치, epochKey namespace 정확, local tx/environment/compiler/source 기록. Monad tx로 표기하지 않음 |
| T25 | R18 · E+전원 | clean install/build→화면→demo→provider key 생성/등록→개인 alpha 제출→seal→evaluate→receipt→모의 flow | 실제 브라우저 전체 흐름, 공개·개인 정보 분리, null/오류/대기 상태 이해 가능, trust/demo/PAPER 배지, 문서 링크 동작 |
| T26 | R19 · A+B+E | 잘못된 host/origin/method, 64KiB 초과·invalid JSON, 서버 재시작, static path 이동 시도 | localhost/same-origin guard, 명시적 오류, 원문 secret/stack 미노출, 키·accepted DB 보존, workspace 바깥 파일 공개 안 됨 |
| T27 | R20 · 전원 | R↔ticket↔T 대조, command/증거/한계 검토, 기존 문서 archive 비교 | 누락·미실행을 숨기지 않음, 기존 원문 보존, TEE/Monad testnet/실거래의 미구현 범위 명확 |

T24는 root 자체를 코드 안의 임의 상수로 바꿔 실행한 경우 전체 흐름 PASS가 아니다. fixture-only chain demo는 registry smoke evidence로 따로 표시한다. 테스트에 사용한 RPC가 로컬인지 Monad testnet인지 출력에 보존한다.

## 4. 실행과 증거 형식

기본 명령:

~~~bash
rtk npm test
rtk npm run build
rtk npm run chain:demo
rtk proxy node scripts/chain-demo.mjs --manifest /absolute/path/epoch-manifest.json --output /absolute/path/local-anchor.json
~~~

각 담당자는 필요한 부분 시험부터 실행하고 통합 단계에서 전체 suite와 브라우저를 확인한다. 명령이 환경에 없거나 실패하면 그 사실을 기록한다. build 성공은 브라우저 행동 검증을 대신하지 않는다.

~~~json
{
  "testId": "T24",
  "environment": "LOCAL_EVM",
  "status": "PASS | FAIL | NOT_RUN | BLOCKED",
  "command": "exact command",
  "artifact": "path to exported manifest / receipt / screenshot / report",
  "observed": "actual measured result",
  "limitations": "what this does not establish"
}
~~~

위 JSON은 보고서 양식이며 실행 결과가 아니다. T01–T27의 여러 case 중 일부만 통과했다면 해당 시험 전체를 PASS로 표시하지 않는다. 수정으로 영향을 받은 시험은 재실행하고 결과에서 사용한 code/policy/protocol version을 보존한다.
