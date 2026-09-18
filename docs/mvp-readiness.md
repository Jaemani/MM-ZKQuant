# 최초 프로토타입 감사 기록: NOT_READY

**후속 구현:** TEE 제외 Pilot의 계약·가격·보상 구현 및 최신 외부 gate 판정은 [새 실행 결과](evidence/pilot-readiness.md)와 [개발명세](pilot/development-spec.md)를 따른다. 아래는 최초 프로토타입 감사와 당시 반례를 보존한 기록이다.

검토일: 2026-09-18. 현재 결과물은 **동작하는 프로토콜 프로토타입이며, 합의한 펀드 제품의 충분한 MVP는 아니다.** 이전의 “MVP 완료” 선언을 정정한다.

사용자가 유예한 것은 TEE다. 원본 25절에는 commitment root, investor capital, vault shares, aggregate execution, actual fills, NAV, fees, provider rewards와 반복 운용이 포함되어 있다. 실제 가격·체결·자금·지급을 모의로 대체한 것은 구현 과정에서 축소한 범위이며, 사용자가 승인한 제외 항목이 아니다. 이 문서의 목적은 늘어난 시험 개수로 완료를 주장하는 것이 아니라, 실제로 검증할 수 있는 주장과 반례를 구분하는 것이다.

## 직접 재현하는 방법

프로젝트 루트에서 Node.js 22.13 이상으로 실행한다. 설치가 안 되어 있으면 먼저 `rtk npm ci`를 실행한다.

```bash
rtk npm run prove:legacy
rtk npm run prove:legacy -- --strict
```

첫 명령은 약 20–30초 동안 별도의 임시 서버와 장부를 만들고 실제 제출 마감·평가 종료를 기다린다. 서버의 engine/service/crypto 코드를 import하지 않는 HTTP client가 서명·암호화·제출·영수증 검증을 수행한다. 결과를 미리 손계산한 값과 비교하고, 서버를 실제로 재시작해 중복 정산도 확인한다. 추가로 경제적 반례와 저장 데이터 변조 실험을 실행한다. 기존 `.data`와 사용자의 계정·자금은 사용하지 않는다. 외부 거래를 전송하지 않는다.

기본 종료 코드 **0은 실험을 기대한 대로 재현했다는 뜻**이다. 제품이 완성됐다는 뜻이 아니다. `--strict`는 미충족 제품 조건 때문에 **2**를 반환한다. 실행 오류나 예상과 다른 결과는 **1**이다. 두 명령 모두 제품 판정을 `NOT_READY`로 출력한다. 판정 조건 G1–G6은 원본과 코드를 대조한 검토 결과로 명시되어 있으며 테스트 개수로 자동 승인되지 않는다.

- [가장 최근 실행 결과](evidence/mvp-readiness.md)
- [실행 시각·소스 SHA-256·원자료 지문](evidence/mvp-readiness.json)
- [별도 HTTP client와 검증기](../scripts/evidence/http-challenge.mjs)
- [전체 실행기](../scripts/prove-mvp.mjs)

소스와 원자료 지문은 어떤 파일로 실행했는지 비교하기 위한 것이다. 독립 기관의 감사·외부 시각 인증은 아니다. 수정 전 결함 기록은 보존하고 현재 명령은 수정 후 차단을 재현한다.

## 무엇이 실제로 동작하는가

모의 초기 자본은 $100,000. 네 provider의 고정 weight는 각각 10%다. Bull은 BTC +1, Bear는 BTC −0.9, Neutral은 0을 제출하고 Missing은 제출하지 않는다. 최소 제출 3명은 충족된다. BTC 가격은 $100에서 $110으로 변했다고 **실험자가 입력**한다. 다른 자산 가격은 변하지 않는다.

합성 BTC 노출은 `10% × 1 + 10% × (−0.9) = 1%`다. 따라서 모의 주문은 $1,000이며, 수수료 10bps와 slippage 5bps는 총 $1.50다. 순손익은 `$1,000 × 10% − $1.50 = $98.50`다.

| 검증 값 | 사전에 계산한 값 | 실제 HTTP 관측 |
|---|---:|---:|
| 합성 BTC 목표 | 100 bps | 100 bps |
| 모의 주문 금액 | $1,000 | $1,000 |
| 비용 | $1.50 | $1.50 |
| 최종 NAV | $100,098.50 | $100,098.50 |
| Bull standalone NAV | $102,462.50 | $102,462.50 |
| Bear standalone NAV | $97,462.50 | $97,462.50 |
| Bull 고정 weight LOO | +101.20 bps | +101.20 bps |
| Bear 고정 weight LOO | −88.65 bps | −88.65 bps |

Standalone은 자산 cap 25%로 독립 평가한다. LOO는 같은 초기 장부에서 그 provider만 제거하고 다른 weight를 그대로 둔 반사실 비교다. 이 숫자들은 서로 다른 질문에 대한 답이다. **LOO 합계는 fund 손익의 가산 분해가 아니다.**

다른 키의 사칭은 401, 제출 교체·마감 후 제출·조기 봉인·조기 평가·확정 결과 덮어쓰기는 409로 거부한다. 개인 receipt를 원래 payload와 대조하는 별도 검증기는 원 제출을 통과시키고 바꾼 vector와 바꾼 receipt를 거부한다. 실제 프로세스 재시작 후 NAV/root가 유지되고 재평가 요청은 이력과 credit을 중복 반영하지 않는다. [HTTP 원자료의 H01–H23](evidence/http-challenge.json)에서 요청 시각·상태·expected/actual을 확인할 수 있다.

이 실험은 로컬 프로토콜과 선언한 선형 회계가 해당 입력에서 일관되게 작동함을 보여준다. 실제 시장 가격, 체결 가능성, 수익성, 운영자에게도 비밀인 alpha를 입증하지 않는다.

## “커밋한 판단을 평가한다”는 주장에 발견한 결함

수정 전에는 제출 시점에만 provider 서명과 payload hash를 확인하고, 평가할 때 저장된 암호문을 다시 복호화해 바로 사용했다. DB 쓰기 권한을 가진 공격자는 **공개 암호화 키만으로** 반대 vector를 암호화해 넣을 수 있었다. provider/server의 서명 private key는 필요하지 않았다.

공격 입력은 세 provider 모두 BTC +1, 각 weight 10%, 자산 cap 25%, BTC +10%다. 정당한 평가 NAV는 $102,462.50이다. 봉인 후 저장된 암호문을 BTC −1로 교체하면 **root와 영수증은 그대로 유효하고 화면의 aggregate 목표는 +25%인데**, 평가 NAV는 $97,462.50이 됐다.

현재는 평가·봉인에 사용하는 원문을 frozen roster의 키로 다시 검증하고, payload hash·frozen leaf·전체 root·manifest·정책·weights의 연결을 확인한다. 같은 공격은 409로 거부하며 NAV·이력·credit·shadow 변경을 롤백한다. provider 자신이 서명한 교체 값도 기존 커밋과 다르면 거부한다.

- [수정 전 실행 증거](evidence/security-challenges-before.json)
- [수정 후 실행 증거](evidence/security-challenges.json)
- [정확한 소스 수정 patch](evidence/commit-binding-fix.patch)
- [회귀 시험](../tests/commitment-binding.test.js)

이것은 저장된 원문과 커밋 사이의 누락된 검사를 고친 것이다. 운영자가 코드·키·DB 전체를 바꾸는 것을 막는 증명은 아니다. 별도 보관한 과거 root가 없는 경우 DB 복구로 갈라진 두 이력의 receipt가 각각 통과하는 반례는 여전히 존재한다. 서버가 서명한 허위 시각, 미공개 roster/weights 주장, 사용자가 입력한 양수 가격의 진실도 receipt 검증만으로 확인할 수 없다.

## 보상 설계의 반례는 남아 있다

[정확한 입력·출력·손계산](evidence/quant-challenges.json)과 [실행 코드](../scripts/evidence/quant-challenges.mjs)를 함께 제공한다. 다음은 산술 오류가 아니라 현재 정책에서 실제로 발생하는 결과다.

| 반례 | 실제 결과 | 제품 주장에 미치는 영향 |
|---|---|---|
| 한 운영자가 동일 신호를 복제 | 계정 1개→2개로 credit 5,000→6,666 | 키당 cap은 운영자당 cap이 아니며 새 정보 없이 몫을 늘릴 수 있음 |
| 동일한 BTC 신호 4개와 25% cap | fund 수익 $2,462.50인데 모든 개별 LOO=0, 보상 미배정 | LOO가 이익의 유일하고 가산적인 귀속이라는 해석이 깨짐 |
| 한 운영자가 +BTC와 −BTC를 동시 제출 | 공동 기여 $0, 10,000 credits 전부 획득. fund 손실 $1,015 | 음의 기여를 무시한 계정별 양의 보상은 공모에 취약 |
| 방향 표본 1개 적중 | IC=1, hit rate=100%; 동일 이력 1개/30개의 weight 동일 | 표시된 점수만으로 지속적인 예측력이나 최적 배분을 주장할 수 없음 |

상반 신호 반례는 해당 두 계정을 제거해도 honest 1명 + neutral 2명 = 총 3명으로 최소 인원 조건을 만족한다. 따라서 인원 미달이라는 다른 규칙에 기대어 만든 반례가 아니다. 공모자가 실제 현금을 받은 것은 아니며 현재 credit 규칙의 결과다. 이 규칙을 그대로 실제 지급에 연결할 근거는 없다. 반례를 통과시킬 목적으로 보상 공식을 임의로 변경하지 않았다.

## 합의한 제품의 최소 인수 기준

아래는 수익성을 증명하는 기준이 아니라, 제품의 핵심 반복 흐름이 실제로 존재하는지 확인하는 최소 기준이다. 테스트 자산으로 검증할 수 있으며 실제 고객 자금이 필요하다는 뜻이 아니다.

| Gate | 필수 증거 | 현재 판정 |
|---|---|---|
| G1 · 실제 제공자 | 독립 참여자 3명 이상, 개별 서명 제출, 누락·지연·대체 거부 기록 | 생성한 fixture key만 검증. 실참여 증거 없음 |
| G2 · 사전 기록 | frozen policy/roster/weights, 제출 root, 평가 시작보다 앞선 외부 확정 tx·receipt | LOCAL_ONLY와 local EVM만 있음 |
| G3 · 관측 | source/instrument/관측시각/원자료와 가격 선택 규칙, stale·누락·정정 처리 | SYNTHETIC/USER_ASSERTED만 있음 |
| G4 · 자금과 실행 | 테스트 자산 예치→share 발행→합성 주문→실제 venue fill→잔고/NAV→환매 | 모의 선형 노출·로컬 shares만 있음 |
| G5 · 반복과 지급 | 같은 epoch 증거에 연결된 contribution→다음 weight→테스트 자산 지급, 연속 2개 epoch, 중복 지급·복구 시험 | 미지급 credit과 모의 반복만 있음 |
| G6 · 보상 악용 통제 | 운영자/계정 관계 정책, 복제·상반 신호 공격의 보상 효과, 사전 고정된 제한 | 위 반례 재현. 정책 수정·검증 필요 |

TEE는 사용자가 유예한 별도 항목이다. TEE가 없어서 위 제품 판정을 보류하는 것은 아니다. TEE가 생겨도 가격 출처·체결·경제적 보상 설계는 따로 검증해야 한다.

G1–G6을 충족하면 제한된 기능 MVP라고 부를 근거가 생긴다. **장기 수익성과 운용 역량은 이후의 forward 표본·비교 baseline·비용·불확실성 평가가 필요하다.** 단일 성공 epoch나 이틀 수익만으로 이를 추가 주장하지 않는다.

## 완료를 위한 작업 배분

기존 [A–E 담당 구분](three-week-execution-plan.md)을 유지한다. 아래 작업은 미완료 상태이며 새로 완료했다고 주장하지 않는다.

| Ticket | 담당 / 검토 | 작업 및 의존성 | 종료 증거 |
|---|---|---|---|
| RCV-01 | A+B / D | 사전 policy·roster·weight 고정, 외부 root 확정 확인, 늦은 anchor 시 거래 중단. 기존 F-A03/F-D01 연결 | 원 자료 opening→manifest→chain tx→평가시작 순서를 별도 verifier로 판정, fork/late 실패 |
| RCV-02 | B+C / A | 하나의 가격 adapter, instrument와 time boundary 고정, 원 응답·digest·stale/누락 규칙. 기존 F-B01 | 제3자가 원자료로 모든 marks/returns 재계산 |
| RCV-03 | C+A / B | 현재 복제/상반 신호 반례를 보존하고 운영자 단위 등록·집계·제한과 지급 정책 설계 | 두 공격의 이익 변화 및 잔여 우회 가능성 보고. 공식 변경 시 version 고정 |
| RCV-04 | D+B / C | 테스트 자산 vault·shares, venue 주문/체결, 중복 요청·partial fill·잔고 대사. RCV-01/02 의존 | 실제 tx/fill ID로 예치부터 환매까지 자산과 share 보존. 현물 venue이면 short 처리 규칙 별도 확정 |
| RCV-05 | D+C / A | 확정된 contribution→지급 ledger→테스트 자산 보상, 중복 지급 방지. RCV-03/04 의존 | payout tx와 수취 잔고 일치, retry/restart 시 이중 지급 0 |
| RCV-06 | E+전원 / 사용자 | 실제 제공자 3명 온보딩 후 연속 2 epoch 전체 증거 묶음. RCV-01–05 의존 | 한 epoch ID로 제출·사전 tx·시장 관측·fill·NAV/shares·평가·다음 weight·payout을 재계산 |

사용자의 최종 검토 대상은 대시보드 모양이 아니라 **한 epoch의 검증 가능한 증거 묶음**이어야 한다. 현재 보고서는 그중 내부 프로토콜 증거를 제공하고, 외부 근거와 경제적 타당성이 빠져 있음을 명시한다.
