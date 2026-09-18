# TEE 제외 Pilot 개발명세 · v2

상태: 구현 및 로컬 검증. 외부 테스트넷·독립 참여자 인수는 [최신 판정](../evidence/pilot-readiness.md)을 따른다. 이 문서는 기존 PAPER v1의 후속 구현 계약이며, TEE 외 항목을 제품 범위에서 제외하는 문서가 아니다.

## 모듈과 담당 경계

| 담당 | 소유 경로 | 책임 | 완료 근거 |
|---|---|---|---|
| A 프로토콜 | scripts/pilot-provider.mjs, coordinator 서명/암호화 | 서명 등록, 운영자별 키 연결, envelope, receipt, offline 전달 | 사칭·교체·미승인·기한 거부, 원문 비공개 |
| B 플랫폼 | src/pilot/coordinator.js, api.js, market.js | frozen roster/weights, 파일 transaction, 시장 관측, 공개/비공개 DTO | 재시작·동시 쓰기 거부·원자료 대조 |
| C 평가 | src/pilot/policy.js, challenges.js | 운영자 단위 합성·Shapley·표본 보정·standalone·보상 배분 | 복제·상반 신호·cap 포화·소표본 시험 |
| D 계약/실행 | contracts/pilot/, src/pilot/chain.js, runner.js | 토큰·AMM·대차·vault·이익 수수료·지급, RPC journal | receipt·잔고·차입 상환·환매·한도 검증 |
| E 통합/검증 | src/web/Pilot.jsx, src/pilot/verify.js, scripts/prove-pilot.mjs | epoch 증거 조회·로그 재계산·배포 소스 대조·gate 판정 | 실제 로그와 계산 일치, 없는 외부 증거는 실패 |

## 신뢰와 운용 대상

- Provider의 개인 키와 원본 입력 데이터는 제공자 장치에 남는다. 등록·alpha는 Ed25519 서명, alpha는 기존 AES-GCM/RSA-OAEP envelope로 암호화한다. 운영자는 TEE 없이 복호화할 수 있다.
- Economic Actor는 독립 경제적 운영 주체다. 한 주체가 여러 provider 키를 가질 수 있다. 등록 요청은 승인 대기이며 CLI의 검토 승인과 확인 기록 hash가 있어야 roster에 들어간다.
- 동일 subject, 지급 주소, provider 키를 서로 다른 actor로 중복 등록하지 않는다. 숨겨진 실제 소유 관계까지 암호학적으로 탐지한다는 주장은 하지 않는다.
- 공개 테스트넷은 Monad 10143만 허용한다. tUSD/tBTC/tETH/tMON/tSOL은 issuer가 발행한 테스트 자산이며 실물이나 법정화폐 교환권이 아니다.
- 테스트 거래소는 constant-product AMM, 수수료 1bp다. 롱은 매수·매도, 숏은 대차 재고에서 차입·매도 후 cash collateral+매각대금을 보관하고 종료 때 exact-output 재매수·전액 상환한다. 레버리지 재사용이나 수익 재투자 대차는 없다.
- 각 자산 절대 목표 25%, 총 4개 자산의 절대 목표 합은 최대 100%. 실제 체결은 원자료 mark 대비 2% slippage 한도 안에서만 처리한다. gap으로 부채 상환 자금이 부족하면 revert한다. 자동 청산·대손 보험은 상용 운용 검토의 미구현 영역이며 현재 테스트 자산 pilot을 실자금 출시로 간주하지 않는다.

## 정책 고정과 합성

정책 ID는 `admitted-actor-collateral-v2`이며 policy 전체 canonical JSON의 SHA-256을 사용한다. `universe=[BTC,ETH,MON,SOL]`, 각 값은 −10000~10000의 정수 bps다.

1. roster의 actor와 provider 검증키를 동결한다. 최소 3, 최대 8명의 승인 운영자를 허용한다.
2. actor 안에서 동일 vector를 중복 제거하고 서로 다른 vector의 평균을 취한다. 계정을 복제해도 actor의 총 가중치·vector가 변하지 않는다. +v와 −v가 같은 actor에 속하면 상쇄된다.
3. actor 가중치는 이전 이력으로만 정하고 최대 1000bps다. 결과 확정 표본 수 n에 대한 `n/(n+5)` 보정으로 한 번의 성공과 여러 관측의 영향을 구분한다. 취소/복구에서도 제출 의무 이력은 남겨 completeness를 계산한다.
4. 각 actor vector에 frozen weight를 곱해 합산한 후 자산별 ±2500bps로 제한한다. 최소 3개 actor 제출이 없으면 새 실행을 만들지 않는다.
5. `int256[4]` ABI encoding의 keccak256으로 targetHash를 고정한다. 컨트랙트가 실행 입력과의 일치를 검사한다.

## 상태와 증거 연결

```text
enrollment PENDING → human admission APPROVED
epoch OPEN → SEALED → EXECUTED → SETTLED
              ↘ 기한 초과/미실행 → CANCELLED
EXECUTED → 지연된 원자료로 복구 → SETTLED(recovery=true, 인수 제외)
```

onchain phase는 open=1, committed=2, executed=3, closed=4, settled=5, cancelled=6이다. close와 pay는 별도 transaction이다. 둘 사이 실패는 동일 journal로 재개한다.

Open에서 policyHash/rosterHash/weightsHash/payoutsHash, cutoff/start/end를 체인에 기록한다. cutoff 이후 start 이전에 제출 root/manifestHash/targetHash를 기록한다. `finalized` head와 anchor block hash를 확인한 뒤 실행하며, start를 지난 anchor는 인수하지 않는다. execute는 anchor보다 이후 block, start 이상 end 미만, 시작 관측 시각 이상인 mark가 필요하다.

Manifest는 epoch ID, 위 frozen hash들, root, 시간 경계, 이전 manifestHash를 포함한다. 봉인 전에는 receipt가 서버 접수 서명이다. 봉인 후 leaf/proof/manifest와 chain transaction을 함께 내보낸다. 저장된 envelope를 사용할 때마다 provider 서명·payloadHash·roster·weights·policy·manifest·root·target을 재검사한다.

암호화 envelope 내부는 `{payload, signature, commitmentSignature}`다. `signature`는 alpha payload 서명이며, `commitmentSignature`는 `MM_PILOT_ALPHA_COMMITMENT_V2` domain과 epochId/actorId/publicKey/policyHash/payloadHash에 대한 제공자의 별도 서명이다. 공개 receipt에는 commitmentSignature와 acceptedAt/cutoffAt 및 서버 서명을 포함한다. 별도 검증기는 최소 3개 actor의 제출 서명, 마감, roster 전체 leaf/proof/root를 확인한다. 원문 공개 없이 제출자가 hash를 승인했음을 확인하며, 서버가 기록한 접수 시각의 정직성은 TEE 제외 신뢰 경계에 남는다.

## 가격 계약

Kraken `/0/public/OHLC`의 1분 봉, USD quote, 지정한 네 instrument를 사용한다. Kraken 응답의 마지막 진행 중인 봉을 제외하고 `openTime+60=요구 boundary`인 행만 선택한다. 다른 시각이나 다른 상품으로 대체하지 않는다.

관측은 `asset, source, instrument, intervalSeconds, candleOpenAt, observedAt, receivedAt, price, volume, tradeCount, zeroVolume, url, raw, rawSha256`를 보존한다. 미래·180초 초과·없는 봉·API 오류·다른 instrument는 실패다. 거래량 0인 거래소의 carry-forward 봉은 그대로 표시하며 실제 거래가 있었다고 꾸미지 않는다.

관측 전체의 hash를 계약의 marketHash와 연결한다. 원 HTTPS 응답을 저장·재계산하는 출처 증거이며, 거래소가 서명한 oracle attestation이나 독립 감사는 아니다. 운영자의 정직한 source 수집에 대한 신뢰는 여전히 필요하다.

## 세 평가와 실제 회계

Prediction: actor vector와 다음 자산 return의 cross-sectional Pearson IC, 방향 적중률, 유효 방향 표본 수. 분모가 0이면 null이다. 표본 하나의 100%를 통계적 유의성으로 부르지 않으며 Sharpe는 null이다.

Standalone: actor vector만 ±25% asset cap으로 운용한 signed linear reference book이다. epoch마다 왕복 1bp 비용을 반영하고 NAV·peak·MDD·표본을 누적한다. 이는 실제 별도 거래계정이나 AMM 유동성의 실현 성과가 아니다.

Contribution: 승인 actor를 단위로 모든 coalition을 계산하는 정확한 Shapley다. frozen weights를 유지하고 coalition에는 최소 인원 gate를 다시 적용하지 않는다. 비용은 signed exposure의 절대값에 부과한다. 공통 reference model에서 합계가 전체 reference return과 일치한다. 실제 fund PnL과 억지로 같게 만들지 않는다. 실제 pool 충격·대차 체결가와 모델의 차이는 둘을 나란히 보여 검토한다.

실현 NAV는 계약이 보유한 **회계에 반영된 현금 + 실제 롱 포지션 + 숏 escrow − 실제 숏 부채의 mark 가치**다. 종료 시 롱과 숏을 모두 청산한 현금으로 확정한다. 직접 송금받은 토큰을 alpha 이익·지분 발행으로 오인하지 않도록 accounted cash/position을 따로 유지한다. 승인되지 않은 직접 송금은 자동 회수·배분하지 않는 테스트 운용 정책이다.

예치 shares는 `assets × (totalShares+1)/(NAV+1)`의 내림이다. 환매 cash는 `shares × (NAV+1)/(totalShares+1)`의 내림이다. 정수 기본 단위 18 decimals를 사용한다. 공급량과 전체 소유 잔고의 합, 체결의 input/output transfer, short debt의 동일 수량 상환을 검사한다.

보상 재원은 지분당 high-water mark를 넘는 실현 이익의 10%다. 기존 손실 회복과 입출금을 이익으로 세지 않는다. 그 한도 안에서 양의 actor Shapley 비중으로 배분하고 내림 잔여는 fund에 남긴다. 고점을 넘는 이익이 없으면 0이다. 같은 epoch 재지급은 계약 phase로 차단하고 수취 주소 목록은 open 시 payoutsHash에 고정한다. 복구 epoch에는 지급하지 않는다.

## 로컬 API / SDK

| 경로 | 내용 |
|---|---|
| GET /api/pilot/status | 공개 정책, 서버 공개키, 승인 actor, 대기 요청, epoch·외부 검증 상태 |
| POST /api/pilot/enroll | `{payload, signature}`. 자동 승인 없음 |
| POST /api/pilot/submit | 암호화 envelope. actor/provider/policy/epoch/마감 검사 |
| GET /api/pilot/receipt?epoch=...&key=... | 접수 receipt와 봉인 후 포함 증거. vector/nonce/암호문 미포함 |
| POST /api/pilot/market | 고정된 공개 소스에서 새 관측 수집. body에 준 가격을 사용하지 않음 |
| GET /api/pilot/evidence | 외부 evidence가 있으면 그것, 없으면 명시적인 LOCAL_EVM 결과 |

서버의 기존 localhost Host/Origin/JSON 제한을 공유한다. 비브라우저 client는 `X-Local-Client: mm-alpha-sdk`를 보낸다. 서버를 인터넷에 공개하는 인증·권한 구성으로 확대 해석하지 않는다.

## 수용시험과 최종 판정

`tests/pilot-*`는 실제 EVM 두 epoch, 전액 차입 상환, 이익/손실 지급, 자산 보존, 직접 송금 격리, 재시작 서명 binding, 등록 승인 경계, 로그 변조, 실제 HTTP 경로를 확인한다. `challenges.js`는 기존 복제/상반/cap 반례가 새 승인 운영자 모형에서 어떻게 달라졌는지 값으로 기록한다.

`verify.js`는 실행기를 호출해 숫자를 다시 받지 않고 transfer·swap·short·deposit·redeem·reward 이벤트에서 회계를 재구성한다. 외부 검증에서는 RPC receipt로 로컬 로그를 교체하고 finalized block·배포 bytecode·현재 코드·최종 NAV/share supply까지 대조한다. 개별 비공개 alpha 계산 전체를 ZK나 TEE로 증명하는 기능은 없다.

`prove:mvp -- --strict`는 G1~G6의 외부 제품 조건이 모두 충족되어야 종료 0이다. TEE만 제외한다. 로컬 키·로컬 timestamp·직접 입력 가격·신뢰 표시가 바뀐 JSON만으로 외부 조건을 통과시키지 않는다. 이 판정은 테스트넷 기능 MVP의 인수이며 상용 수익성/보안 감사/실자금 출시 승인이 아니다.
