# Perpl testnet AUSD 지급 경로 조사 — 2026-09-24

## 결론

공식 `api-docs` 및 `dex-sdk`의 아래 고정 리비전을 조사했지만 **외부 사용자가 테스트 AUSD를 받는 공개 faucet/claim/mint 절차는 확인하지 못했다.** 이는 그런 경로가 없다는 증명이 아니다. 지급 API를 추측해 호출하거나 mint 거래를 전송하지 않았다.

현재 테스트넷 담보 주소는 기존 검증에서 사용한 **`0xa9012a055bd4e0edff8ce09f960291c09d5322dc`**가 맞다. SDK의 로컬 테스트 mint 코드를 공개 테스트넷 지급 방법으로 안내하면 안 된다.

## 현재 배포 정보와 문서 불일치

공식 문서가 지정한 읽기 전용 [GET /api/v1/pub/context](https://github.com/PerplFoundation/api-docs/blob/e1ba1a78305f88113afd37ed95e4bb0df494f011/rest-endpoints.md#public-endpoints)를 [테스트넷 API](https://testnet.perpl.xyz/api/v1/pub/context)에서 조회했다. 조회 결과:

| 항목 | 값 |
|---|---|
| chain_id | 10143 |
| Exchange | `0x1964c32f0be608e7d29302aff5e61268e72080cc` |
| collateral_token_id | 1 |
| token id 1 | AUSD, `0xa9012a055bd4e0edff8ce09f960291c09d5322dc` |
| decimals | 6 |
| min_account_open_amount | 100000000 = 100 AUSD |
| min_deposit_amount | 10000000 = 10 AUSD |
| min_withdraw_amount | 10000 = 0.01 AUSD |
| response version / reported gas block | 252 / 65161958 |

반면 [api-docs README 네트워크 표](https://github.com/PerplFoundation/api-docs/blob/e1ba1a78305f88113afd37ed95e4bb0df494f011/README.md#networks)는 테스트넷 담보를 `0xdf5b718d8fcc173335185a2a1513ee8151e3c027` (USD)로 기재한다. **정적 표와 실제 context 응답이 다르므로 이 표만 보고 토큰을 바꾸면 안 된다.** 배포 직전에는 계약 getter와 context를 다시 대조해야 한다.

A/B 계정을 새로 여는 현재 실험의 200 AUSD는 각각의 최소 최초 입금 100 AUSD에서 나온 수량이다. MON은 가스용이며, 위 자료는 MON→테스트 AUSD 교환 경로를 제공하지 않는다.

## SDK에서 찾은 mint는 로컬 fixture

[dex-sdk testing/mod.rs](https://github.com/PerplFoundation/dex-sdk/blob/01b9910761755b0a0d9c710c1ede62ab937daa7d/crates/sdk/src/testing/mod.rs#L195)에서:

- 195–211행: 새 Anvil을 띄우고 그 Anvil RPC에 provider를 연결한다.
- 223–238행: Anvil 기본 계정을 owner로 선택하고 **새 TestToken(Test USD/USD)을 배포**한 다음 owner에게 mint한다.
- 335–341행: 같은 Anvil의 테스트 계정 잔액을 채우기 위해 같은 TestToken의 mint를 사용한다.

236행의 “faucet” 주석은 이 로컬 테스트 fixture를 설명한다. 배포된 테스트넷 AUSD의 mint 권한, 공개 faucet 주소 또는 무료 지급 허가를 의미하지 않는다.

## 조사 범위와 다음 단계

- [api-docs](https://github.com/PerplFoundation/api-docs/tree/e1ba1a78305f88113afd37ed95e4bb0df494f011): README, REST endpoints, integration/authentication, WebSocket 및 예제의 faucet/mint/AUSD/testnet 관련 내용.
- [dex-sdk](https://github.com/PerplFoundation/dex-sdk/tree/01b9910761755b0a0d9c710c1ede62ab937daa7d): README 및 Rust 소스의 테스트 토큰/배포/자금 공급 관련 내용.
- 두 저장소에서 Markdown/Rust/env-example 소스 총 79개를 내려받아 검색했다. 실행 코드/바이트코드 전체나 비공개 서비스까지 조사했다는 뜻은 아니다.
- 읽기 전용 공개 context 조회만 수행했다. 토큰 전송·approve·mint·메시지 발송은 수행하지 않았다.

공식 테스트넷 UI에서 공개 Claim/Faucet이 확인되면 그 정상 절차를 사용한다. 확인되지 않으면 Perpl 또는 해커톤 지원 채널에 **공식 지급 경로 및 계약 계정 연동용 200 테스트 AUSD 지급 가능 여부**를 문의해야 한다. 메인넷 AUSD 구매·브리지를 대안으로 안내하지 않는다.

## 병행 공식 문서·포털 확인

아래 항목은 같은 작업의 주 에이전트가 공식 브라우저 화면/검색으로 확인한 관찰이다.

- [Perpl 개발자 문서](https://docs.perpl.xyz/resources/for-developers)의 공식 검색에서는 현재 네트워크 담보가 `0xa901...` AUSD임을 확인했다. `testnet AUSD faucet claim mint obtain test collateral` 검색에서 공개 지급 절차는 확인되지 않았다. SDK Examples의 seeded collateral은 로컬 Anvil 예시였다.
- [Monad 개발자 포털](https://developers.monad.xyz/)은 [Monad faucet](https://faucet.monad.xyz/)을 연결하지만, 이 링크만으로 Perpl AUSD를 지급한다고 볼 수 없다.
- [Metropolis resources](https://hackathon.monad.xyz/resources)는 로그인 화면으로 이동하여 비공개 리소스의 AUSD 지급 안내 유무를 확인하지 못했다.
