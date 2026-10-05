# Testnet strategist API

공개 사이트의 전략가 콘솔은 Phala TDX ingress를 사용한다. API key 원문은 발급 응답에서 한 번만 반환된다. TEE에는 SHA-256 hash만, strategy target은 TEE의 암호화된 `/state` 볼륨에만 보관한다.

## 지갑으로 key 발급

1. `POST /platform/auth/challenge`에 `{ "address": "0x..." }`를 보낸다.
2. 응답 `message`를 같은 지갑에서 `personal_sign`한다.
3. `POST /platform/strategists`에 `address`, `nonce`, `signature`, `name`, `bio`를 보낸다.

성공 응답의 `key.apiKey`는 `mmq_test_...` 형식이다. TEE는 5분 안에 사용된 challenge만 받아들이며, 서명 검증 뒤 challenge를 삭제한다.

## 전략과 epoch target

```http
POST /platform/strategies
Authorization: Bearer mmq_test_...
Content-Type: application/json

{"id":"btc-momentum","name":"BTC Momentum","description":"...","risk":"HIGH","feeBps":2000}
```

```http
POST /platform/strategies/btc-momentum/targets
Authorization: Bearer mmq_test_...
Content-Type: application/json

{"epoch":"epoch-001","targetLots":25,"deadline":1791170000}
```

`targetLots`는 -100부터 100까지이며, deadline은 제출 시점부터 한 시간 이내여야 한다. 응답 receipt는 target 원문을 드러내지 않는 TEE HMAC commitment다. 공개 목록은 `GET /platform/strategies`에서 조회한다.

## 현재 테스트넷 범위

전략가 등록, API key 발급, 전략 공개 메타데이터, 비공개 target 큐는 실제 production TDX에서 동작한다. 기존 공개 cohort contract는 두 명의 초기 투자자만 받고 운용 중 가입·부분 환매·rolling HWM을 지원하지 않는다. 따라서 새 전략은 `TESTNET_WAITING_FOR_VAULT` 상태이며, 다수 지갑의 입금과 분 단위 추정 NAV는 rolling vault 계약과 epoch mark adapter를 배포한 뒤 활성화한다.
