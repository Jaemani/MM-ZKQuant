# Testnet strategist API

공개 API base: `https://mm-zkquant.vercel.app/api`. 전략 목표 벡터는 이 API로 보내지 않는다. 클라이언트에서 암호화해 TEE로 직접 제출한다. 주문 epoch와 고정 lot target은 현재 플랫폼에서 사용하지 않는다.

## 등록

1. `POST /v1/auth/challenge`에 `{ "address": "0x..." }`를 보내고 응답 message를 지갑으로 서명한다.
2. `POST /v1/auth/verify`에 `{address,nonce,signature}`를 보내 sessionToken을 받는다.
3. sessionToken을 Bearer로 사용해 `POST /v1/strategists`에 `{displayName,bio}`를 등록한다.
4. `POST /v1/api-keys` 응답의 `apiKey`를 별도로 보관한다. DB에는 해시만 저장한다.
5. API 토큰으로 `POST /v1/strategies`를 호출한다.

```json
{
  "slug": "btc-momentum",
  "name": "BTC Momentum",
  "description": "전략 개요",
  "risk": "HIGH",
  "feeBps": 2000,
  "policy": {
    "maxLeverageBps": 20000,
    "stopLossBps": 1500,
    "maxDrawdownBps": 2000,
    "settlementPeriodSeconds": 86400,
    "settlementOffsetSeconds": 0,
    "withdrawalCutoffSeconds": 3600,
    "orderTtlSeconds": 120,
    "slippageBps": 50
  }
}
```

성과보수는 0–20%, 레버리지는 1–10배, 정산 주기는 1시간–30일이다. 실제 validation은 `src/platform/policy.js`가 정의한다. 새 전략은 공개 카탈로그에 등록되고 공용 Vault를 사용한다.

## 암호화된 목표 제출

`targets.json`:

```json
[{"market":16,"weightBps":5000},{"market":32,"weightBps":-2000}]
```

```sh
# MMQ_API_TOKEN은 셸 환경에 설정하고 공유 로그에 출력하지 않는다.
node scripts/submit-strategy.mjs STRATEGY_UUID targets.json
# 또는 로컬 .env의 MMQ_API_TOKEN 사용:
node --env-file=.env scripts/submit-strategy.mjs STRATEGY_UUID targets.json
```

market 16/32/48/64는 BTC/ETH/SOL/MON이다. `weightBps=5000`은 전략 순자산 대비 +50%, `-2000`은 -20% 목표 노출이다. 전체 벡터를 제출하며 생략된 시장은 목표 0으로 정리한다. 빈 배열은 모든 포지션 정리다.

클라이언트는 `GET /v1/config`에서 TEE endpoint와 공개키를 읽는다. ECDH/HKDF/AES-GCM 패킷을 `/platform/encrypted-strategy`로 전송한다. 암호화 내부 payload는 `{action:'TARGET',apiKey,strategyId,requestId,sequence,targets}`다. sequence는 직전 STATUS의 sequence+1, requestId는 중복 방지 UUID다. 같은 ID로 다른 내용을 제출할 수 없다.

`STATUS`는 본인 전략의 sequence, 실행 상태와 요청 결과를 암호화해 반환한다. `QUEUED`는 접수이며 체결 완료가 아니다. `EXECUTED`, `PARTIALLY_FILLED`, `EXPIRED`, `FAILED`를 확인한다. 목표 평문을 받던 `/v1/strategies/:id/targets`는 410을 반환한다.

운용 페이지의 **내 성과보수**는 소유자가 인증된 암호화 `STATUS.performanceFees`로만 조회한다. 공개 API·성과 지표에는 추가하지 않는다. `estimated`는 투자 건별 최고 평가액 초과 이익의 미정산 예상 보수이며 대기 자금은 제외한다. 정산 중이거나 최신 평가 확인에 실패하면 `null`이다. `outstanding`은 확정 후 미지급액, `paid`는 누적 확정 보수에서 미지급액을 뺀 실제 지급액이다. 기존 자기자본 보수 규칙도 그대로 적용한다. 금액은 AUSD 최소 단위(6자리 소수), 시각은 Unix 초다.

`payments`에는 최근 20건의 지급액·거래 해시·블록·상태만 포함한다. 신규 지급은 확인 시각도 기록하고, 과거 지급은 암호화 거래 저널에서 복원한다. 과거 상세 기록이 부족하면 `historyComplete=false`이며 누적액은 장부 기준으로 유지한다. `paymentState`는 자동 지급 대기, 거래 확인, 정산, 현금 부족, 플랫폼 확인 또는 실패를 구분한다. 투자자별 지분·포지션·주문 정보는 이 응답에 포함하지 않는다. 지급을 위한 별도 청구 버튼은 없으며 기존 정산 시점과 현금 확보 규칙을 유지한다.

핵심 회귀 검증: `node --test tests/platform-fees.test.js tests/platform-ledger.test.js tests/platform-execution.test.js`. 기존 로컬 테스트 전략가 계정으로 읽기 전용 웹 확인: `node scripts/platform-fees-browser.mjs` (`MMQ_E2E_STATE_PATH`, `MMQ_BROWSER_URL`, `MMQ_PLAYWRIGHT_MODULE`로 환경 지정). 화면 조회·새로고침·모바일 배치만 확인하며 주문·입금·장부 변경은 하지 않는다.

## 조회와 설정 변경

- `GET /v1/strategies`: 공개 메타데이터·설정·집계 성과·자기자본
- `GET /v1/strategies/:slug`: 공개 상세·성과·자기자본 이력
- `GET /v1/me/strategies`: 세션의 소유 전략
- `POST /v1/strategies/:id/policy`: API 토큰으로 `{policy,feeBps}` 변경 예고. 기존 출금 기회와 미결 정산 후 적용
- 암호화 action `RESUME`: 위험 종료로 HALTED 상태인 전략을 명시적으로 재개

투자자의 PREPARE/COMPLETE/PORTFOLIO/WITHDRAW/WITHDRAW_PENDING/CANCEL_WITHDRAWAL은 지갑 서명 후 `/platform/encrypted-investments`로 직접 암호화해 보낸다. 개인별 전략 선택, 지분, 출금 청구를 공개 플랫폼 API에 보내지 않는다.

## 통합 웹 UX 확장

웹 전략 등록·운용 조건 변경·소유권 확인은 지갑 로그인 세션도 지원한다. 외부 프로그램은 기존 API 토큰을 그대로 사용한다. 암호화 전략 요청에는 웹에서 `sessionToken`, 외부 프로그램에서 `apiKey`를 보낸다. 토큰을 공개 API에 전달하는 소유권 확인에는 전략 메타데이터만 포함되며 목표 평문은 전송하지 않는다.

- `GET /v1/me`: 본인 공개 프로필 `strategist` 포함.
- `GET /v1/api-keys`: 토큰 접두사·발급·사용·폐기 시각 조회. 평문/해시 미반환.
- `POST /v1/api-keys/:id/revoke`: 본인 토큰 폐기.
- 공개 상세 `?period=1d|7d|30d|all`: 샘플링된 실제 공개 이력, 시계열의 시작·끝 관측값 보존.
- 암호화 `PORTFOLIO`: 개인 누적 입금액 `deposited` 포함.

화면 구조와 검증 절차는 [통합 UX 인계 문서](ux-platform-handoff.md)를 참조한다.
