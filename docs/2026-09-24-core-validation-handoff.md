# 팀 전달용: 코어 검증 현황 · 2026-09-24

**비공개 목표를 증명으로 승인하고 DEX 주문으로 연결할 수 있다는 코어 실험은 통과했다. 다만 실제 하드웨어 TEE→공개 Perpl 체결을 한 번에 실행한 상태는 아니다.** 현재 증거는 아래 세 환경으로 나뉜다. 공개 Perpl 검증에 필요한 테스트 AUSD가 없어서 그 부분을 완료 처리하지 않았다.

## 무엇을 어디서 확인했는가

| 항목 | 실제 수행 환경 | 판정 / 증거 |
|---|---|---|
| 실제 TEE가 목표 승인 증명을 생성하고 거래 계약에 전달 | Phala TDX + 로컬 Monad/Perpl 포크 | 통과. 증명 8개, 검사 30개. [TDX 연결 기록](evidence/perpl-tee-mvp.json) |
| 증명 검증과 Perpl 주문을 한 트랜잭션에서 실행 | 로컬 포크, 로컬 prover | 통과. 성공 주문 6건의 내부 호출 추적, venue 실패 시 상태 원복 포함 32개 검사. [원자성 기록](evidence/perpl-atomic-mvp.json) |
| 두 Product의 거래·미체결·부분 체결·전량 종료·담보 회수 | 로컬 Perpl 포크 | 통과. 실제 포크 계약 상태로 검사. 공개 체결 기록은 아님 |
| 공개 Monad에서 정상 ZK 승인·변조/재사용 거절 | 공개 테스트넷 10143, 합성 입력, 로컬 prover | **이번에 통과.** 배포 2건 + 승인/거절 3건. [영수증·calldata·증명](evidence/public-zk-testnet.json) |
| 공개 거래 runner와 중단 후 재실행 | 로컬 포크 | 리허설 통과. [기존 거래 runner 기록](evidence/perpl-testnet-rehearsal.json) |
| 공개 Perpl 입금→실제 체결→종료→회수 | 공개 테스트넷 | **차단.** 테스트 AUSD 0 / 필요 200. [최신 사전 검사](evidence/perpl-testnet-readiness.json) |
| 전체 Ledger 전이·투자자 지분·보수·공유 slot·Forced Exit | 새 v1 프로토콜 | 미구현/미검증. 이번 최소 목표 승인 회로가 대신 증명하지 않음 |

실제 TEE 실험과 원자성 실험은 기존 결과이고, 이번에 TEE를 다시 실행한 것은 아니다. 각 JSON의 시각·코드 해시·환경을 함께 확인한다. `npm test`는 이번 변경 후 기존 JS 검사 **422개 모두 통과**했다.

## 이번 공개 체인 검증

검사 계약 `PublicZkProbe`는 자금을 보관하거나 Perpl을 호출하지 않는다. 고정된 테스트 문맥에서 운용자가 서명한 목표가 증명과 일치하는지 검사하고, 성공한 요청 수만 기록한다. 실제 포지션을 읽지 않으므로 이 검사를 거래 상태 검증이나 Ledger 검증으로 해석하면 안 된다.

1. 목표 수량 100에 대해 생성한 증명을 준비했다. 제출할 수량만 99로 바꿔 보내면 `INVALID_PROOF`로 거절되고 승인 횟수는 0이었다.
2. 원래 목표 100과 올바른 증명을 제출하면 승인 이벤트가 발생하고 횟수가 1로 증가했다.
3. 같은 요청을 다시 제출하면 이미 소비한 순번이므로 `STALE`로 거절됐고 횟수는 1로 유지됐다.

| 트랜잭션 | 블록 | 결과 | 탐색기 |
|---|---:|---|---|
| Verifier 배포 | 65163733 | status 1 | [배포](https://testnet.monadexplorer.com/tx/0x3a94b991cee77fb48d1e02298c6758b6dba39b9f4e2b6a27be14b3ae8a199fe8) |
| Probe 배포 | 65163738 | status 1 | [배포](https://testnet.monadexplorer.com/tx/0xe6fb385763d28fccc58e33edb32d0b97acc5b5c7e60f60aabf1bdf41879e0cd1) |
| 목표 변조 | 65163754 | status 0, 의도한 거절 | [실패 영수증](https://testnet.monadexplorer.com/tx/0xad4a5f56d9440e2af6e5d58933c62ccd3ae8bd2e341a2a172035e62af09e0a19) |
| 정상 승인 | 65163882 | status 1, 승인 이벤트 1개 | [성공 영수증](https://testnet.monadexplorer.com/tx/0xfe875f76c1007a9c24b8397aa9eff6b5791b80ebe291da843b661ecdef4865bf) |
| 재사용 | 65163887 | status 0, 의도한 거절 | [실패 영수증](https://testnet.monadexplorer.com/tx/0x2b64aaf03e47bd0bb25ee5d50b865a4bae858b3be90b1526540e821bfa12f31e) |

- Verifier: `0xb73a8Ec7da8D67Ca860413e8a142129985015647`
- Probe: `0x5c7405Cc5Eb3378135BaAC320A60586274121289`
- 테스트 지갑: `0xA761529aE65a0966125C47911DEDCC7F23951D57`
- 총 가스: **0.518226096 테스트 MON**. 최신 Perpl 사전 검사 시 MON 잔액 `30.661008216`, AUSD 잔액 `0`.

실패 영수증만 보고 거절 이유를 추정하지 않았다. 같은 calldata와 gas limit을 직전 블록 상태에서 다시 호출해 각각 `INVALID_PROOF`, `STALE`인 것을 확인했다. 별도 검증기는 배포 소스/바이트코드·정확한 생성자/호출 데이터·유효/무효 증명·각 블록의 승인 횟수 0→1→1도 재검사한다. RPC는 `https://testnet-rpc.monad.xyz`를 사용하며, 다른 공급자와의 교차 검증이나 독립 노드 합의 검증을 주장하지 않는다.

## 팀원이 직접 재확인하는 방법

Node 22.23 이상, `npm ci` 기준. 공개 결과의 읽기 전용 재검사는 커밋한 검증기 소스와 JSON만 사용하므로 `.data`·proving key·로컬 빌드 산출물이 없어도 실행할 수 있다:

```sh
# 키 없이 공개 체인의 기존 결과를 재검사; 새 트랜잭션 없음
npm run verify:zk:testnet
```

새 증명을 만드는 로컬 리허설에는 회로 빌드 산출물이 필요하다. 새 clone에서는 먼저 `npm run build:perpl-zk`를 실행한다. 기존 공개 실행 세션이 있는 작업 폴더에서는 산출물을 덮어쓰지 말고 별도 clone을 사용한다.

```sh
# 로컬 포크에서 별도 세션으로 동일 승인·거절 검사; 공개 전송 없음
npm run test:zk:testnet-runner

# 실제 Perpl 공개 실행의 준비 상태 조회; AUSD 부족이면 exit 2
npm run preflight:perpl:testnet
```

`npm run preflight:zk:testnet`은 읽기·컴파일만 한다. 공개 검증 실행은 `npm run prove:zk:testnet`이며 기존 테스트 지갑 키가 필요하다. `.data/public-zk/session.json`의 기록이 있으면 기존 영수증을 대조하고 완료 단계는 다시 전송하지 않는다. 이번에는 완료한 동일 세션의 재실행도 확인했다. 임의 시점 crash 복구를 검증한 것은 아니다. 진행 중 세션을 삭제하거나 회로 산출물을 다시 만들지 않는다.

공개 probe 실행의 가스 예약 상한은 세션당 **1 테스트 MON**이다. 처음 0.5 상한에서 정상 승인 전 중단됐고, 1로 조정한 뒤 기존 배포와 거절 영수증을 재사용해 완료했다. 현금·메인넷 토큰 예산이 아니다. 로컬 리허설 첫 시도의 영수증 대기 timeout은 직접 receipt 조회 방식으로 수정했고, 완료 후 RPC 재조회에는 사용 가능한 공식 주소를 고정했다. 실패 시점을 숨기거나 재배포한 결과로 바꾸지 않았다.

## 남은 작업과 통과 기준

| 다음 작업 | 필요한 것 | 통과 기준 |
|---|---|---|
| 공개 Perpl 체결 검사 | 해당 테스트넷 AUSD 200개. 공개 faucet/claim 경로는 확인되지 않음 | 두 전용 계정에 각 100 입금 → proof와 주문을 같은 tx로 실행 → 실제 체결량 > 0 → 전량 종료 후 포지션 0 → 회수액 > 0 → 영수증 재조회 |
| 실제 TEE와 공개 체결 연결 | 위 담보 + 기존 예산 내 TEE 실행 준비 | 하드웨어에서 생성된 증명이 공개 Perpl 실행 tx에 사용됐음을 한 실행 기록으로 연결 |
| v1 전체 기능 | 회계·공유 slot·출금/복구 명세 확정과 별도 구현 | [팀 역할별 검수 기준](team-status.md)에 따라 별도 검증. 코어 실험 완료와 분리 |

팀에서 Perpl에 확인할 사항은 **현재 테스트넷의 담보 공급/allowlist 절차가 있는지**, **해당 지갑에 테스트 AUSD를 공급받을 수 있는지**다. 실제 공급 가능 여부는 아직 확인되지 않았다. [조사 근거](research/2026-09-24-perpl-ausd-sources.md)와 [담보 주소·실행 절차](perpl-public-testnet.md)를 함께 전달한다. 메인넷 AUSD를 구매하거나 브리지해서 대체하지 않는다. 토큰 확보 뒤에는 venue 최소 담보와 실제 가스 추정을 다시 확인하고 기존 거래 runner의 비용 상한도 재검토한다.

이번에는 Phala를 재가동하지 않았고 유료 인프라를 추가하지 않았다. Groth16 setup은 로컬 단독 실험용이므로 운영 보안 검증 완료를 뜻하지 않는다. 공개 데이터는 합성 목표와 공개 증명/트랜잭션뿐이며 지갑 키·서명 키는 커밋하지 않는다.
