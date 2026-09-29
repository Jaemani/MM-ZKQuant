# Perpl 테스트 담보 확보 경로 — 2026-09-29

## 결론

**Agora 공식 배포 문서에서 현재 Perpl 테스트넷 담보와 같은 AUSD의 Monad Testnet faucet을 확인했다.** 이전 조사는 Perpl 문서·SDK에 집중되어 발행사 Agora의 공급 계약을 놓쳤다. 따라서 9월 24일의 “공개 지급 경로 미확인” 상태를 이 문서로 갱신한다.

| 항목 | 공식 문서 값 |
|---|---|
| Network | Monad Testnet |
| AUSD | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| Faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` |

출처: [Agora Contract Deployments — Testnet Deployments](https://docs.agora.finance/developer/contract-deployments), [공식 문서가 연결한 faucet explorer](https://testnet.monadscan.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C).

**Faucet은 존재하지만 현재 잔액 부족으로 지급할 수 없다.** 주 작업의 읽기 전용 RPC 검증 결과(블록 `66489411`):

- Faucet 프록시 배포 코드: 1,200 bytes, 담보 토큰 주소가 위 AUSD와 일치.
- Faucet 잔액: `1` base unit = **0.000001 AUSD**.
- 1회 지급량 `faucetDripAmount`: **10,000 AUSD**.
- 소유 한도 `maxAmountToOwn`: 100,000 AUSD, 지급 간격 `maxDripFrequency`: 60초.
- 우리 지갑에 대한 `requestFunds(address)` 읽기 전용 시뮬레이션: **`InsufficientFunds()`** (`0x356680b7`).
- ABI 출처: [faucet 구현 계약](https://testnet.monadscan.com/address/0xba804DF5c476E8EaeF87BF8085F295300ccE2a49).

따라서 가장 빠른 다음 단계는 **공식 faucet 충전 또는 우리 지갑으로 200 테스트 AUSD 직접 지급 요청**이다. 수령 성공·공개 거래 성공으로 표시하지 않는다. 아래 멘토·운영자 경로를 이용할 수 있다. [Agora 공식 문서](https://docs.agora.finance/developer/contract-deployments)에는 `support@agora.finance`도 명시되어 있다. 2026-09-29 17:31 KST 공식 지원 포럼에 [지원 요청](2026-09-29-perpl-support-request.md)을 제출했고 Awaiting organizer 상태를 확인했다.

## 확인한 공식 경로

| 경로 | 확인된 사실 | 활용 |
|---|---|---|
| [Metropolis Mentors](https://hackathon.monad.xyz/mentors) | 질문을 작성하면 운영자 검토 후 멘토에게 전달하는 구조라고 페이지에 명시 | Perpl 멘토에게 테스트 담보와 계약 계정 연동 절차 문의 |
| [공식 Metropolis 소개](https://monad.xyz/developers/hackathons/metropolis) | `gvan`, `Perpl Head of Growth`를 멘토로 소개하고 [공식 연결 X 계정](https://x.com/_gvan)을 링크 | 포털에서 Perpl 멘토를 찾거나 공식 프로필 확인 |
| [Metropolis Support](https://hackathon.monad.xyz/support) | 운영자·멘토 도움이 필요할 때 분류된 지원 스레드를 만들도록 안내 | Perpl 테스트넷 지원 담당자 연결 요청 |
| [Monad 개발자 Discord](https://discord.gg/monaddev) | 위 공식 행사 소개 페이지의 Discord 링크 | 포털 답변이 어려울 때 운영자에게 공식 공급 경로 문의 |

포털의 동적 멘토 목록·FAQ·리소스 본문은 공개 HTML 조회만으로 전체 확인되지 않았다. 따라서 포털 내부에 지급 안내가 없다고 단정하지 않는다. 검색엔진의 `hackathon.monad.xyz` 결과에는 2025년 evm/accathon 내용도 섞여 있으므로 그 행사 지원 이메일을 이번 행사 공식 창구로 제시하지 않는다.

## 문서 재확인

[Perpl 공식 문서 저장소](https://github.com/PerplFoundation/perpl-docs/blob/3173c427edaa0de1bfc085f19f873a1656087f91/README.md)는 `docs.perpl.xyz`의 원본이라고 명시한다. 해당 리비전의 `docs/` 아래 Markdown 49개를 조회하여 faucet, Telegram/Discord, 연락처, 테스트 담보 관련 문구를 확인했다.

- [Networks](https://github.com/PerplFoundation/perpl-docs/blob/3173c427edaa0de1bfc085f19f873a1656087f91/docs/resources/for-developers/networks-and-configuration.md)는 테스트넷 계정 최초 개설 최소 금액을 100 AUSD로 설명하고 실행 시 context/getter 재조회를 요구한다.
- [Overview](https://github.com/PerplFoundation/perpl-docs/blob/3173c427edaa0de1bfc085f19f873a1656087f91/docs/resources/for-developers/overview.md)는 테스트넷 담보를 `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, decimals 6으로 명시한다.
- [SDK examples](https://github.com/PerplFoundation/perpl-docs/blob/3173c427edaa0de1bfc085f19f873a1656087f91/docs/resources/for-developers/sdk/examples.md)의 담보 지급 예시는 로컬 Anvil용이다. 공개 테스트넷 faucet으로 사용할 근거가 아니다.
- 조사한 49개 문서에서 외부 참가자용 공개 faucet/claim 절차는 발견하지 못했다. 이는 비공개 공급 경로나 UI 기능이 없다는 증명이 아니다.

## 충전 후 수령 방법

공식 faucet 계약의 `requestFunds(address _receiver)`에 테스트 지갑 `0xA761529aE65a0966125C47911DEDCC7F23951D57`를 수령인으로 넣어 Monad testnet(chain 10143)에서 호출한다. 토큰 계약의 `mint`를 직접 호출하는 방식이 아니다. 1회 지급량은 계약 설정에 따르며 요청 금액을 입력하는 함수가 아니다. 실행 전 `npm run probe:ausd:faucet`으로 `SIMULATION_PASS_NOT_CLAIMED`인지 확인한다. 실제 수령은 트랜잭션 영수증과 AUSD 잔액 증가로 별도 확인해야 한다.

[재현 스크립트](../../scripts/probe-ausd-faucet.mjs)는 비밀키를 읽거나 거래를 전송하지 않고, 고정 블록에서 잔액·설정·지급 호출을 조회해 [증거 JSON](../evidence/ausd-faucet-readiness.json)을 갱신한다. `InsufficientFunds`는 우리 지갑 MON 부족이 아니라 faucet의 지급 토큰 부족이다. 다른 체인의 동명 AUSD가 해당 Perpl 계약에서 사용 가능하다고 가정하지 않는다.

## 문의 초안 — 실제 제출본은 별도 지원 요청 기록 참조

> Hi Perpl team, we are building Confidential Alpha Protocol (MM-ZKQuant) for Monad Metropolis. We have verified our ZK authorization flow on Monad testnet and tested Perpl execution on a local fork. We now want to validate real public-testnet order execution and collateral recovery through two smart-contract accounts.
>
> We found Agora's officially listed Monad testnet faucet (`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`) for AUSD (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`). At block 66489411 it held only 0.000001 AUSD while the configured drip is 10,000 AUSD, and `requestFunds(ourWallet)` reverted with `InsufficientFunds()` in read-only simulation.
>
> Could the faucet be refilled, or could we receive 200 test AUSD directly to open two smart-contract accounts with 100 each? This is Monad testnet, chain ID 10143.
>
> Test wallet: `0xA761529aE65a0966125C47911DEDCC7F23951D57`
> Repo: https://github.com/Jaemani/MM-ZKQuant
> Please also confirm that this deployment supports direct smart-contract account integration. We are requesting test collateral only, not mainnet assets.

## 확보 후 통과 기준

수령 토큰의 체인·주소·잔액을 재확인하고 실행 직전 Perpl context와 계약 설정을 대조한다. 이후 각 계약 계정 최초 입금 → 증명 검증 및 주문 → 실제 체결/포지션 확인 → 포지션 종료 → 담보 회수까지 영수증과 상태로 검증한다. MON 잔액이나 승인 거래만으로 실제 체결 통과를 선언하지 않는다. 메인넷 AUSD 구매·브리지는 이번 테스트의 대안으로 안내하지 않는다.
