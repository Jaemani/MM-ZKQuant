# 공개 Perpl 거래 검증 결과 · 2026-10-03

**공개 Monad 테스트넷에서 두 Product의 입금 → ZK 승인 및 실제 Perpl 체결 → 전량 종료 → 담보 회수를 통과했다.** 운영진의 faucet 충전 이후 테스트 AUSD를 실제로 수령했고, 로컬 포크에서만 확인했던 거래 경로를 공개 체인에서도 검증했다.

이 실행은 **로컬 prover + 공개 Perpl**이다. 하드웨어 TEE를 재가동하지 않았다. 이전의 실제 TDX→로컬 Perpl 실험과 합쳐서 TEE→공개 Perpl을 한 번에 실행했다고 주장하지 않는다. 전체 Ledger 전이·지분·보수·공유 slot·Forced Exit는 이번 범위에 없다.

## 실제 결과

| 계정 | 최초 담보 | 실제 최초 체결 | 최종 포지션 | 투자자 지갑 회수액 |
|---|---:|---:|---:|---:|
| Product A / Perpl account 795 | 100 테스트 AUSD | +100 lot | 0 | 99.931646 테스트 AUSD |
| Product B / Perpl account 796 | 100 테스트 AUSD | -100 lot | 0 | 99.881643 테스트 AUSD |

- A 계약: `0x8a41fA65C2224DA9d9159b7F661574037e970a50`
- B 계약: `0xD332AF7485ab380219e0a2AA93369A0fcBE52e71`
- 체인: Monad testnet `10143`, BTC market `16`.
- Faucet 수령: 10,000 테스트 AUSD. 계약이 정한 1회 지급량이며 이 중 거래 실험에는 합계 200만 사용했다.
- 최종 테스트 지갑 잔액: **9,999.813289 AUSD**. 두 계정 회수액 합계는 199.813289, 입금 대비 차이는 0.186711이다. 이는 수수료·매매 손익을 포함한 이번 왕복 실행 결과이며 전략 수익성 평가가 아니다.
- 지급 1건 + 거래 검증 13건 = 공개 트랜잭션 14건. 모든 영수증 status 1.
- 가스: 지급 0.01731756 + 거래 검증 1.619336394 = **1.636653954 테스트 MON**. 현금·메인넷 자산 사용, Phala 재가동 없음.

## 무엇을 근거로 통과했는가

실행 runner의 성공 메시지와 별개로, 비밀키를 읽지 않는 별도 검증기가 공개 RPC에서 다시 확인했다.

1. 영수증·로그·전송자·chain ID·배포 calldata·배포 바이트코드를 저장소 소스와 대조했다.
2. 공개된 증명과 실제 `execute` calldata를 비교하고 Groth16을 다시 검증했다. 증명의 현재 포지션은 거래 직전 블록의 실제 Perpl 상태와 일치했다.
3. **진입/종료 4건 모두 실제 `debug_traceTransaction`에서 verifier가 true를 반환한 뒤 같은 트랜잭션의 Perpl `execOrder`가 실행되는 것을 확인했다.** 별개의 승인 트랜잭션을 체결로 계산하지 않았다.
4. 진입 시 A +100 / B -100 lot의 실제 포지션 변화가 있었고, 종료 후 모두 0이었다. 단순 주문 제출·미체결을 통과로 처리하지 않았다.
5. 입금은 지갑→전용 계약→Perpl, 회수는 Perpl→전용 계약→투자자 지갑의 ERC-20 Transfer 이벤트로 각각 대조했다.
6. 두 계정의 Perpl 자유/잠금 잔액, 전용 계약 토큰 잔액, 남은 주문이 모두 0이었다. 지갑→전용 계약 및 전용 계약→Perpl allowance도 0이었다.
7. 시작 지갑 잔액 − 입금 합계 + 회수 합계 = 종료 지갑 잔액을 과거 블록 조회로 확인했다.

사용한 RPC는 같은 공식 공급자다. 별도 검증기는 실행 runner와 다른 로직으로 검증하지만 독립 합의 노드나 외부 감사를 의미하지 않는다. Groth16 setup도 실험용 단독 setup이다.

## 바로 확인할 트랜잭션

| 단계 | 탐색기 |
|---|---|
| Faucet 수령 | [10,000 AUSD 수령](https://testnet.monadscan.com/tx/0xac5b15e675b44ac9504736e3a83462ed0e52da1abf09f4632ee7354d2afcbbb9) |
| A 진입: ZK 검증 + Perpl 체결 | [open-A](https://testnet.monadscan.com/tx/0x9189c560e2702042cb3ae41cdba8d2c6281a91b6795142638bef35175491c823) |
| A 종료 | [close-A](https://testnet.monadscan.com/tx/0xac9fef08f7ab51961f82be7d2855836a012e0a13d2aefea68b025097c5533d54) |
| A 담보 회수 | [recover-A](https://testnet.monadscan.com/tx/0x8c9118642dde36d707da1b34cfc654df63fa7af9c0ec4ace8f6b76e13baaf1fe) |
| B 진입: ZK 검증 + Perpl 체결 | [open-B](https://testnet.monadscan.com/tx/0x26b605b77f016d0fddec26015ddd4b9242b8b6e051e055283c328d7089b84187) |
| B 종료 | [close-B](https://testnet.monadscan.com/tx/0x4ab8b4e401e07eed4d169c90367595decdb5f69fba7f529537a30b8aff82448c) |
| B 담보 회수 | [recover-B](https://testnet.monadscan.com/tx/0x086516d86aa9bd2931f622fed558b2bcdc5f2ad646b18fc0bcc1a2022b868c7d) |

전체 배포·승인·입금을 포함한 13개 거래 영수증은 [실행 증거](evidence/perpl-testnet-mvp.json), 호출 추적과 별도 판정은 [감사 증거](evidence/perpl-testnet-audit.json), 지급 영수증은 [faucet 수령 증거](evidence/ausd-claim-testnet.json)에 있다.

## 팀원이 재검증하는 방법

```sh
npm ci
npm run verify:perpl:testnet
```

Node 22.23 이상 기준. 기존 공개 결과를 읽어서 검사하며 지갑 키·TEE·`.data`·proving key 없이 실행된다. 새 주문이나 트랜잭션을 전송하지 않는다. 해당 RPC에서 과거 상태와 callTracer 조회가 가능해야 한다.

`npm test`: 기존 422개 JS 검사 통과. 최신 포크의 공개 runner 리허설 및 완료 세션 재실행도 통과했다. 공개 세션을 다시 실행했을 때 추가 트랜잭션은 0건이었다. 임의 시점 crash나 키 분실 복구까지 검증한 것은 아니다.

새 공개 실행 절차는 [Perpl 실행 안내](perpl-public-testnet.md)를 따른다. 진행 중 `.data/perpl-testnet/session.json`이나 회로 산출물을 삭제·교체하지 않는다. 이번 runner는 실제 공개 가스 추정에 맞춰 세션 상한을 0.5에서 **5 테스트 MON**으로 조정했으며 실제 사용량은 그 이하다. Faucet claim은 별도로 0.1 테스트 MON 이하로 제한한다.

## 남은 작업

공개 DEX 거래 가능성의 차단 조건은 해소됐다. 다음 연결 실험은 실제 TEE에서 만든 증명을 이 공개 거래 경로에 연결하는 것이다. TEE 전략 처리·내부 제출·키 갱신·장애 복구, Ledger와 투자자별 회계, 공유 slot 및 강제 출구는 각각 별도 검증이 필요하다. 이번 결과로 전체 프로토콜이나 운영 보안을 완료 처리하지 않는다.
