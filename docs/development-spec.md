> **이전 구조의 기록입니다.** 2026-09-23 이후 현재 기준은 [제품 v1.4 / 개발 v0.1](specs/README.md)과 [현재 팀 상태](team-status.md)입니다. 아래 완료 항목은 새 Perpl 프로토콜의 완료 증거가 아닙니다.

# Alpha Provider Fund — 개발명세 v0.1

> 후속 v2 구현과 최신 상태는 [Pilot 개발명세](pilot/development-spec.md), [실행 안내](pilot/runbook.md), [재현 결과](evidence/pilot-readiness.md)를 따른다. 아래 PAPER v1 규칙과 과거 검증 기록은 비교용으로 보존한다.

작성: 2026-09-18 · 대상: 로컬 프로토콜 프로토타입 · 수식 구현: paper-linear-v1 · 제출 계약: protocol v1

이 명세는 [현재 프로토타입 요구사항](requirements.md)의 구현 방법을 고정한다. 용어는 루트 CONTEXT.md, 제품 전환 이유는 [ADR-0001](adr/0001-alpha-provider-pivot.md)을 따른다. 아래 수식·API·PAPER 회계는 현재 구현 계약이며, 원본에서 합의한 MVP의 충분조건이 아니다.

사용자가 명시적으로 미룬 것은 TEE뿐이다. 합성·사용자 입력 가격, PAPER 거래·자본, credit 지급 미리보기는 에이전트가 구현 범위를 좁힌 결과이며 승인된 제품 제외가 아니다. 원본의 실제 미래 시장 결과에 따른 평가, aggregate 거래, Monad 자본·지분·NAV·보상 연결은 미충족 요구사항으로 남는다. 전략 코드 실행은 alpha 제출로의 제품 전환에서 제거됐으며 TEE 보류와 구분한다.

현재 판정은 [MVP 준비도 판정](mvp-readiness.md)에 기록한다. `rtk npm run prove:mvp`로 근거를 재현하며, `rtk npm run prove:mvp -- --strict`는 제품 조건 미충족 시 종료 코드 `2`를 반환한다. 이 구분은 아래 구현 수식이나 API를 변경하지 않는다.

## 1. 구성과 모듈 경계

~~~text
React/Vite provider 화면
  ├─ Ed25519 signing key: 사용자 브라우저
  ├─ AES-GCM payload + RSA-OAEP wrapped key
  └─ public/private 결과 조회
                  │ localhost API
Node.js 22+ application
  ├─ shared/protocol: canonical encoding
  ├─ server/crypto: envelope, signatures, receipts, Merkle tree
  ├─ server/service: provider, epoch, flows, public DTO
  ├─ server/store: SQLite transaction + persistent local keys
  └─ core/engine: weights, aggregate, PAPER, shadow, contribution
                  │ public epoch manifest export
EpochCommitmentRegistry (Solidity)
  └─ local EthereumJS VM deploy → anchor → receipt → storage verify
~~~

계산 엔진은 순수 입력과 출력만 다루고 HTTP·DB·clock·private key를 직접 읽지 않는다. service가 원문 복호화·사전 상태·시간·정책을 연결한다. 향후 TEE 경계는 server의 vector 복호화와 engine 계산을 함께 옮기는 단위다. RSA private key만 TEE로 옮기고 원문을 일반 host에 반환하는 형태는 운영자 기밀성을 충족하지 않는다.

Runtime은 Node.js 22.13 이상 ESM, node:sqlite, React, Vite다. 금융·비중 계산은 이 로컬 버전에서 JavaScript Number를 사용하되 입력 비중은 정수 bps, 금액과 drifted 비중은 소수점 8자리로 정규화한다. 실제 자금 버전은 별도 고정소수점 범위·반올림·overflow 계약과 자산별 decimals를 확정해야 한다.

## 2. 환경과 주요 객체

| 객체 | 핵심 필드와 불변조건 |
|---|---|
| Workspace | demo 또는 forward. 각 providers, epochs, book, 암호화 shadows, clock 독립 |
| Provider | UUID, name, HUMAN/QUANT/AI, Ed25519 SPKI publicKey, registeredAt, score history |
| SubmissionPayload | version=1, providerId, epochId, policyHash, universe, vectorBps, nonce |
| Envelope | wrappedKey: RSA-OAEP SHA-256, iv: 12 bytes, ciphertext: AES-256-GCM ciphertext+16-byte tag. 모두 canonical base64 |
| Epoch | UUID, sequence, state, createdAt/cutoffAt/startAt/endAt, roster, policy, weights, encrypted submissions, leaves/root/manifest |
| Policy | version, engineVersion, universe, provider/asset/gross cap, minProviders, fee/slippage, rewardPool, missing/valuation/contribution/hash conventions |
| Receipt | acceptedAt/cutoff, leaf/policyHash, server signature; 봉인 후 root/proof/manifest/manifestHash |
| PAPER Book | nav, peakNav, drifted weights, marks, shares, flows, performance history |
| Shadow Book | provider별 독립 nav/peak/weights/marks. 저장 시 전체 shadow 상태를 envelope 암호화 |
| Evaluation | price source, asset returns, fund return/nav/pnl, provider score history, contribution, credit preview |
| Chain Manifest | epochId, root, manifestHash, full manifest. raw signal·nonce·provider private key 없음 |

universe는 순서까지 BTC, ETH, MON, SOL로 고정한다. wire vectorBps는 이 순서의 길이 4 배열이며 engine 내부에서는 자산명→정수 객체로 바꾼다. 10000 bps=1이다. UI의 +0.8은 payload의 8000이다. -10000≤a≤10000인 정수만 허용한다.

~~~json
{
  "version": 1,
  "providerId": "provider-uuid",
  "epochId": "epoch-uuid",
  "policyHash": "0x…64 hex characters",
  "universe": ["BTC", "ETH", "MON", "SOL"],
  "vectorBps": [8000, -2000, 4000, 0],
  "nonce": "64 lowercase hex characters"
}
~~~

위 JSON은 필드 의미 설명이며 생략 기호를 포함한 값은 실제 유효 payload가 아니다. nonce는 cryptographic RNG의 32 bytes다. 알 수 없는 payload field도 protocol v1에서 거부한다. 개인 signing key를 API로 업로드하지 않는다. 내장 demo provider key는 demo fixture를 자동 서명하기 위한 별도 서버 측 시험키이며 사용자 키 보안의 실증으로 간주하지 않는다.

## 3. 시간·roster·상태

OPEN 생성 시 현재 provider public key roster를 ID 순서로 정렬하고 weight와 policy를 복사한다. 제출 창과 평가 창은 각각 기본 60초·3600초이며 허용 범위는 각각 10–86400초다. workspace당 OPEN 또는 AWAITING_OUTCOME epoch는 하나다. 이 제한으로 겹친 평가·shares 이동·시점 혼합을 줄인다.

~~~text
OPEN
  ├─ cutoff 도달 후 seal + 유효 begin mark → AWAITING_OUTCOME
  │       └─ endAt 도달 후 end mark + 정산 → EVALUATED
  └─ 봉인하지 못한 채 endAt 경과 → EXPIRED
~~~

봉인·aggregation·PAPER execution plan 기록은 하나의 transaction에서 AWAITING_OUTCOME으로 전환한다. 별도의 SEALED/EXECUTED persisted state는 v0.1에 두지 않는다. EXPIRED는 거래·성과 결과가 없는 실패 epoch이며 roster와 submission root를 보존한다.

제출은 payload signature·epoch roster·정책·universe를 검사한 뒤 서버 clock이 cutoff보다 이른 경우만 신규 수용한다. 이미 승인한 동일 payload는 마감 뒤 재시도해도 원영수증을 받을 수 있으며 새 판단을 추가한 것으로 세지 않는다. 다른 payload로 변경하면 409다.

DEMO에서는 seal과 evaluate가 virtualNow를 각각 cutoff/endAt까지 이동시킨다. FORWARD에서는 실제 clock을 변경하는 API가 없으며 종료 전에 정산을 거부한다. 늦게 봉인한 경우 startAt는 실제 봉인시각이고 endAt는 처음 고정한 시각을 유지한다. 원래 cutoff 시각에 거래한 것으로 소급하지 않는다. 실제 begin mark가 없거나 평가 구간이 이미 끝났으면 유효한 forward trade를 만들지 않는다.

완전성 required는 provider가 roster에 포함되고 cutoff가 지난 모든 epoch 수다. submitted는 그 중 승인된 submission 수이고 completeness=submitted/required다. required=0은 null이다. EXPIRED·미평가도 required에서 지워지지 않는다. prediction·shadow의 samples는 실제 평가된 epoch 수이며 completeness 분모와 다르다.

## 4. 암호화·서명·commitment

canonicalJson은 객체 key를 사전순 정렬하고 배열 순서를 보존한 공백 없는 JSON이다. null/boolean/string/유한 number/array/object만 허용한다. 브라우저와 서버가 동일한 구현을 사용한다. 서명 입력은 UTF-8 canonicalJson(payload), 서명은 Ed25519이며 공개키는 DER SPKI base64다.

{payload, signature}를 새 AES-256 key와 12-byte IV로 AES-GCM 암호화한다. ciphertext 끝 16 bytes는 authentication tag다. AES key는 RSA-2048 OAEP SHA-256으로 감싼다. 서버는 인증 tag·서명 모두 확인하며 유효하지 않은 envelope 내용을 에러 응답에 노출하지 않는다.

제출 leaf와 hash의 정확한 v1 인코딩:

~~~text
payloadHash = SHA256(UTF8(canonicalJson(payload)))
submittedLeaf = {
  domain: "MM_ALPHA_SUBMISSION_V1",
  epochId, providerId, status: "SUBMITTED", payloadHash
}
missedLeaf = {
  domain: "MM_ALPHA_SUBMISSION_V1",
  epochId, providerId, status: "MISSED", salt: random 32-byte hex
}
leafHash = SHA256(UTF8("00" + canonicalJson(leaf)))
parentHash = SHA256(byte(0x01) || raw32(leftHash) || raw32(rightHash))
~~~

leaf prefix의 "00"은 두 ASCII 문자이고 parent prefix는 한 byte 0x01이다. 둘을 동일한 byte prefix로 해석하지 않는다. tree leaf 순서는 frozen roster 순서이며 홀수 level의 마지막 hash는 자신을 오른쪽 sibling으로 복제한다. proof의 side는 left 또는 right이고 단일 leaf proof는 빈 배열이다. 빈 roster epoch는 만들지 않는다.

epoch manifest는 domain, epochId, workspace, policyHash, rosterHash, weightsHash, submissionRoot, cutoffAt, 실제 startAt, endAt, sealedAt, previousManifestHash, clock을 포함하고 canonical JSON SHA-256이 manifestHash다. 정책/가중치/roster의 hash를 바꾸지 않고 다른 내용으로 해석해서는 안 된다.

서버 receipt signature는 receiptToken·serverSignature를 제외한 body 전체에 적용한다. receiptToken은 개인 receipt 조회용 bearer capability이며 root 검증 입력이 아니다. verifier는 서버 서명·Merkle inclusion·manifest hash와 root 연결을 독립 출력하고 independentlyTimestamped=false를 반환한다. 신뢰할 서버 public key를 verifier가 별도로 지정해야 하며 receipt가 자체 제시한 아무 public key나 신뢰해서는 안 된다.

시점 고정의 한계: 이 프로토콜에서 cutoff는 서버 시계에 의존한다. 공개 chain root라도 그 finalization 시각과 outcome 시작시각을 별도로 비교하기 전에는 “결과 이전 제출을 독립 증명”한 것이 아니다. 외부 anchor가 늦었다면 late anchor로 표시해야 한다.

## 5. Weight와 aggregate 수식

모든 bps 수식의 B=10000. 기본 providerCapBps=1000, assetCapBps=2500, grossCapBps=10000, minProviders=3, feeBps=10, slippageBps=5, rewardPoolUnits=10000이다.

provider i의 최근 30개 확정된 EVALUATED 또는 EXPIRED history를 H_i라 한다. 기간 내 제출된 행에서 유효한 숫자만 사용해 평균 shadow net return n_i와 평균 contribution m_i를 구한다. n_i는 [-1000,1000], m_i는 [0,1000]에 clamp하고, submitted/전체 H_i로 completeness c_i를 구한다. EXPIRED에서도 제출 여부를 보존하며 미제출은 completeness를 낮추지만 성과를 0으로 조작하지 않는다. 최초 provider는 n=m=0, c=1이다. d_i는 제출된 행의 가장 낮은 drawdown 크기를 [0,10000]에 제한한 값이다.

~~~text
quality_i = max(0.05, (1 + n_i/500 + m_i/250) × c_i × (1 − d_i/B))
budget = min(B, rosterCount × providerCapBps)
weightBps_i = min(providerCapBps, floor(budget × quality_i / sum(quality)))
unallocatedBps = B − sum(weightBps_i)
~~~

이는 프로토타입 heuristic이다. cap 때문에 남은 budget을 다른 provider에게 재분배하지 않는다. epoch가 열린 뒤 결과로 해당 weights를 다시 계산하지 않는다. OPEN·AWAITING_OUTCOME의 아직 결정되지 않은 future outcome은 입력으로 쓰지 않는다.

~~~text
rawBps_j = sum_i(weightBps_i × alphaBps_i,j / B)
clipped_j = trunc(clamp(rawBps_j, −assetCapBps, assetCapBps))
gross = sum_j(abs(clipped_j))
targetBps_j = gross > grossCapBps
  ? trunc(clipped_j × grossCapBps / gross)
  : clipped_j
~~~

MISSED vector는 0이며 제출자끼리 weight를 재정규화하지 않는다. 제출자 수가 minProviders 미만이면 aggregate 상태는 SKIPPED, 이유는 MIN_COHORT 또는 ALL_MISSING이고 기존 drifted target을 유지한다. 이때 실제 book은 시장 변화에 계속 노출되고 shadow는 계속 평가된다. 기존 보유분의 가격 drift는 신규 target cap으로 다시 조정하지 않는다.

nettingRatio=1−sum(abs(rawBps))/sum_i(weight_i×sum(abs(alpha_i))/B)다. 분모가 0이면 0이다. 이것은 신호 상쇄율이며 실제 시장 충격 감소의 실측값이 아니다. SKIPPED cohort의 rawBps/nettingRatio는 공개 응답과 저장 DTO에서 null로 만들어 소수 제출자의 원래 신호 합이 드러나지 않게 한다.

## 6. PAPER 회계와 비용

직전 NAV를 V, 기존 drifted weights를 h_j, 새 target을 q_j라 한다.

~~~text
deltaNotional_j = V × (q_j − h_j) / B
turnoverNotional = sum(abs(deltaNotional_j))
fee = turnoverNotional × feeBps/B
slippage = turnoverNotional × slippageBps/B
cost = fee + slippage
r_j = endPrice_j / beginPrice_j − 1
grossReturn = sum_j(q_j/B × r_j)
uncappedNAV = V × (1 + grossReturn) − cost
nextNAV = max(0, uncappedNAV)
nextWeightBps_j = nextNAV > 0
  ? V × q_j × (1+r_j) / nextNAV
  : 0
~~~

주문은 기본 2500 USDC notional 이하로 분할하고 정수 sliceIndex를 부여한다. quantity와 fillPrice는 모의 표기이며 slippage는 위 cost에서 한 번 반영한다. 자산별 slice 수에 상한을 두어 비정상 입력이 무한 loop를 만들지 않는다.

netReturnBps=(nextNAV/V−1)×B, turnoverBps=turnoverNotional/V×B이며 V=0은 별도 파산 상태로 처리한다. peak=max(previousPeak,nextNAV), drawdownBps=(nextNAV/peak−1)×B다. maxDrawdownBps는 과거 최솟값을 유지하며 fund와 shadow 모두 epoch 사이 gap mark를 포함한다. 파산 때 bankrupt=true, lossBeyondCapital=max(0,−uncappedNAV)를 함께 기록한다. NAV를 0으로 자르는 것은 제한된 simulator 규칙이며 실제 파생상품 청산이나 손실 한도 보장이 아니다.

epoch 사이 기존 노출이 남아 있으면 이전 mark→새 begin mark의 gap도 markBook으로 평가하고 weights를 drift시킨다. 이 gap mark는 신규 거래가 아니므로 비용 0이다. gap의 가격도 현재 FORWARD에서는 USER_ASSERTED다.

입출금은 active epoch가 없을 때만 허용한다. sharePrice=nav/shares, deposit shares=amount/sharePrice, withdrawal amount=redeemedShares×sharePrice다. 모의 seed 자본 100000과 shares 100000에서 시작한다. 자금 흐름은 별도 flows에 기록하고 NAV chart history에는 DEPOSIT/WITHDRAW type과 return=0으로 표시한다. 실제 성과 통계에는 EPOCH/GAP_MARK 행만 사용해야 하며 입금액을 수익으로 세지 않는다. 이 sandbox는 기존 synthetic exposure를 비례 증감하는 flow model이며 실제 현금 유동성·시장 청산 가능성을 주장하지 않는다. 개인별 실제 투자자 소유권 register도 아직 아니다.

입출금 requestId는 영문·숫자·밑줄·하이픈 8–80자로 한 번 정해 재시도에 유지한다. 같은 requestId/내용은 원 flow를 반환하고 다른 내용은 409다. amount는 1억 이하, 반올림한 amount≥0.000001·shares≥0.00000001이어야 한다. shares 전량 인출 뒤 새 자본 유입과 파산 상태의 신규 share 발행은 구분한다.

## 7. 세 평가와 credit

### Prediction quality

각 epoch의 4자산 alpha와 return으로 Pearson IC를 계산한다. 둘 중 하나의 분산이 0이면 IC=null이다. hitRate는 alpha≠0이고 return≠0인 자산 중 방향이 일치한 비율이며 유효 자산이 없으면 null이다. MISSED는 둘 다 null이다. predictionAssetCount는 제출 시 4, 미제출 시 0이고 directionalAssetCount는 유효 방향 쌍 수다. 공개 track record는 각 epoch의 계산 가능한 지표 평균을 보여주며 모든 자산 쌍을 합친 pooled correlation은 아니다. icEpochs/hitRateEpochs는 각 평균의 유효 epoch 수이고 directionalSamples는 유효 방향 쌍의 누적 수다. 표본 수가 저장되지 않은 구버전 기록은 directionalSamples=null로 표시한다.

### Standalone shadow

q_i=Risk(alpha_i)로 provider별 같은 자산/gross cap을 적용한다. provider weight는 standalone에 곱하지 않는다. 각자의 previous shadow NAV와 drifted weights에서 비용·수익을 계산한다. MISSED는 q_i=0으로 청산하고 발생한 비용을 shadow 이력에 남긴다. shadow initialNAV=100000이다. Sharpe는 v0.1에서 미산출(null)이며 samples는 평가된 epoch 수다.

### 한 epoch leave-one-out contribution

~~~text
full = Simulate(previousRealBook, Risk(sum_i(w_i×alpha_i)), prices, policy)
without_i = Simulate(previousRealBook,
  Risk(sum_k(k≠i)(w_k×alpha_k)), prices, policy)
contributionBps_i = full.netReturnBps − without_i.netReturnBps
~~~

양쪽은 같은 직전 실제 PAPER book, 같은 weights, risk, 가격, fee/slippage를 사용한다. without_i 계산에서는 cohort gate를 다시 적용하지 않는다. 그래야 provider 하나를 제외했을 때 “minimum cohort 위반”으로 전체 거래가 취소되는 효과가 기여도에 섞이지 않는다. 전체가 SKIPPED이거나 provider가 MISSED이면 contribution은 0이다.

이 값은 한 구간의 정책 비교다. without_i book을 다음 epoch로 독립 유지하지 않으므로 장기 counterfactual 성과가 아니고, risk cap·비용의 비선형성 때문에 contribution의 합은 실제 PnL과 다를 수 있다. 음의 contribution도 원값을 보존한다.

~~~text
positive_i = max(0, contributionBps_i)
credits_i = sum(positive)>0
  ? floor(rewardPoolUnits × positive_i/sum(positive))
  : 0
unallocatedCredits = rewardPoolUnits − sum(credits_i)
~~~

credits는 현금·토큰 지급이 없는 모의 보상 단위다. floor 잔여는 미배정으로 남기고 누적 잔고를 ledger에 한 번만 반영한다.

## 8. API 계약

기본 API는 http://127.0.0.1:8790이다. GET의 workspace query와 POST의 workspace body/query는 demo/forward 중 하나이고 기본 demo다. 오류는 명시적인 HTTP status와 사람이 읽을 수 있는 메시지로 반환하고 원문 envelope·서명 키·stack trace를 노출하지 않는다. browser mutation은 허용한 localhost origin, 로컬 SDK mutation은 X-Local-Client: mm-alpha-sdk가 필요하다. 이것은 원격 사용자의 인증 대신이 아니다.

| HTTP endpoint | 요청 데이터 | 반환·조건 |
|---|---|---|
| GET /api/health | 없음 | ok, LOCAL_REVIEW_ONLY |
| GET /api/state | workspace query | public providers/epochs/book/policy/server public keys; raw vector 제외 |
| GET /api/verification-key | 없음 | Ed25519 server publicKey; 독립 저장 후 receipt verifier에 전달 |
| POST /api/providers | name, kind, publicKey | provider; 동일 public key 중복 409 |
| POST /api/epochs | durationSeconds, evaluationSeconds | OPEN epoch; active epoch 존재 409 |
| POST /api/submissions | wrappedKey, iv, ciphertext | signed receipt+개인 receiptToken; 동일 payload duplicate |
| GET /api/receipts/:epochId/:providerId | Authorization: Bearer receiptToken | 개인 receipt; 잘못된 token 403 |
| POST /api/epochs/:epochId/seal | forward라면 beginPrices | root/manifest/aggregate/PAPER plan; 마감 전 409 |
| POST /api/epochs/:epochId/evaluate | forward라면 endPrices | 완료 epoch와 공개 evaluation; 종료 전 409 |
| GET /api/epochs/:epochId/manifest | workspace query | epochId/root/manifestHash/manifest/anchor |
| POST /api/vault/deposit | amount, requestId | 모의 shares/flow/book; active epoch 중 409 |
| POST /api/vault/withdraw | shares, requestId | 모의 소각/flow/book; 초과 출금 거부 |
| POST /api/demo/run | workspace=demo | demo에서 등록·제출·봉인·평가 1회; forward 호출 거부 |

POST content type은 application/json이며 body 상한은 64 KiB다. 정당한 형식 오류는 400, 잘못된 provider 서명은 401, receipt/host/origin 권한 실패는 403, 알 수 없는 API는 404, 상태 충돌은 409, 크기 초과는 413, 잘못된 content type은 415다. 예기치 않은 오류는 transaction을 rollback하고 내부 상세 없는 500을 반환한다.

로컬 SDK scripts/provider-demo.mjs는 --workspace demo|forward, --vector '[7000,-2000,4000,0]', --key file을 지원하며 --fetch-receipt로 자기 receipt를 다시 가져온다. verifier scripts/verify-receipt.mjs에는 별도로 보존한 공개키 파일을 --public-key로 넘긴다. 브라우저 epoch 생성 UX는 검토 시간을 줄이기 위해 제출 60초·평가 60초를 명시적으로 보내며 service의 생략 기본값 60초·3600초와 구분한다.

가격 object는 정확히 BTC/ETH/MON/SOL을 포함하며 각 값은 0보다 크고 10^12보다 작은 유한값이어야 한다. 다음 결과를 담은 가격을 미리 제공해도 FORWARD 종료 조건을 통과할 수 없다. USER_ASSERTED는 사람이 선택한 잘못된 가격이나 과거 가격을 잡아낸다는 보장이 아니며 거래소 feed 검증은 후속 ticket이다.

private 제출 내용의 수정·전략 코드 업로드·임의 과거 정산 덮어쓰기 endpoint는 제공하지 않는다. 로컬 단일 운영자 제어면은 원격 다중 사용자 인증 체계와 같지 않다.

## 9. Chain 계약

EpochCommitmentRegistry의 constructor(initialPublisher)는 zero address를 거부한다. immutable publisher 외 호출을 거부하고 anchor(epochKey, root, manifestHash)는 세 값이 nonzero bytes32일 때 한 번만 저장한다. 동일 값의 재시도도 AlreadyAnchored다. offchain client는 기존 mapping을 읽고 같은 값이면 이미 완료된 것으로 reconcile해야 한다.

getCommitment(epochKey)는 root, manifestHash, anchoredAt, blockNumber를 반환한다. 미등록은 모두 0이다. EpochAnchored event가 같은 세 digest와 시각/블록을 기록한다. contract에는 payable 경로·출금·거래·vault·Merkle verification 함수가 없다. positional SHA-256 proof 검증은 offchain이다.

epochKey=SHA256(UTF8("mmzkquant:epoch:v1:" + epochId))다. 이 값은 Merkle leaf가 아니라 contract mapping용 식별자다. chain demo는 입력 manifest의 root와 manifestHash를 기록·읽기 비교하며 full manifest의 내용 검증은 receipt verifier의 책임이다.

스크립트 scripts/chain-demo.mjs는 외부 RPC 없이 @ethereumjs/vm에 chainId 31337의 서명된 transaction을 실행한다. --manifest file.json을 주면 해당 epoch를 기록하고, 생략하면 SYNTHETIC_FIXTURE라고 출력한다. full manifest가 있으면 hash/epochId/submissionRoot 연결도 사전검사한다. block 시각은 합성값이며 consensus/finality를 모사하는 기능은 없다. 결과에는 environment, chainId, contractAddress, transactionHash, root, manifestHash, verified, compilerVersion, sourceSha256과 한계를 포함한다. 상세 배포 절차와 명시적 --broadcast가 필요한 testnet 도구는 [contract runbook](../contracts/README.md)을 따른다.

## 10. 저장·재시작·변경

provider registration, submission accept, seal, evaluation, cash flow는 SQLite transaction으로 실행한다. submission 원문과 shadow target은 DB에 평문 저장하지 않는다. 로컬 암호화/서명 key는 app state와 별도로 유지하고 재시작 때 같은 key와 DB를 사용한다. runtime 파일 삭제 후 새 demo를 시작하는 것은 원래 history의 연속성이 아니다.

정책·hash·금액 정밀도·누락 처리·기여도 수식 중 하나가 바뀌면 policy/engine/protocol version과 필요한 test vector를 함께 바꾼다. 기존 epoch는 저장된 policy를 사용한다. 모든 workspace를 대상으로 한 무조건 reset이나 사용자 기록 자동 삭제를 migration 방법으로 사용하지 않는다.

검증 순서는 protocol mutation→engine 반례→service state/clock/accounting→contract EVM→browser 전체 흐름이다. 비용이 큰 장기 forward 관측과 실제 Monad 배포는 별도 evidence로 남기며 로컬 시험으로 대체하지 않는다.
