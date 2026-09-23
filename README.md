# Monad Metropolis

**운용자(Manager)가 비공개로 보낸 목표 포지션을 TEE가 처리하고, ZK 검증을 거친 주문만 ExecutionGate가 Perpl에서 실행하는 프로토콜입니다.** 투자자의 자금과 손익은 Product별로 귀속합니다. 하나의 Manager가 하나의 Product를 운용하며, 여러 전략을 섞어 단일 수익률로 보여주는 구조가 아닙니다.

> **2026-09-23: 코어 MVP 연결 실험 통과.** 실제 Phala TDX에서 생성한 ZK 증명을 거래 계약이 검증하고, Monad 테스트넷을 복제한 로컬 Perpl에서 A/B 거래·미체결·부분 체결·전량 종료·담보 회수를 확인했습니다. **공개 테스트넷 거래나 전체 펀드 구현 완료는 아닙니다.** [검증 범위·재현 방법](docs/core-mvp.md)과 [실행 증거](docs/evidence/perpl-tee-mvp.json)를 먼저 확인하세요.

## 팀원이 먼저 읽을 문서

0. [빠른 코어 MVP 결과](docs/core-mvp.md) — 이번 구현 범위·30개 검사·제외 항목·재현 명령.
1. [제품·프로토콜 v1.4 원문](docs/specs/2026-09-23-product-v1.4.md) — 누구의 자금을 어떤 조건으로 운용하고, 무엇을 공개하며, 어떻게 빠져나오는가.
2. [개발 상세 v0.1 원문](docs/specs/2026-09-23-development-v0.1.md) — note·회로·계약·TEE·SDK의 인터페이스. **충돌 시 이 문서 §0이 우선합니다.**
3. [현재 작업 분배·검수 기준](docs/team-status.md) — 담당 영역별 산출물과 선행 조건.
4. [명세 반례와 수정 제안](docs/spec-review-2026-09-23.md) — 회로/계약을 확정하기 전에 해결해야 할 문제.
5. [Perpl·Monad M0 조사](docs/research/2026-09-23-perpl-monad-m0.md) — 공식 API·실제 읽기 호출·미검증 사항.
6. [새 코드 실행 안내](protocol/README.md) — 현재 구현 범위와 재현 명령.

## 자금과 데이터가 움직이는 순서

1. **등록·투자:** Manager가 약정·정책·키를 등록합니다. 투자자는 Product를 골라 Custody에 담보를 입금하고, 확정된 장부 가격으로 지분을 받습니다. Manager 자기자본은 선택이며 v1 의무 staking·slashing은 없습니다.
2. **비공개 목표 제출:** Manager SDK가 목표 수량을 서명·암호화해 TEE로 보냅니다. 평문 목표·비공개 장부·증명 witness·제출 키를 TEE 안에서 처리하는 설계입니다. 실제 체결 후의 포지션과 온체인 주문까지 비공개라는 뜻은 아닙니다.
3. **거래 준비·검증:** TEE가 약정과 실제 포지션을 확인하고 IOC 주문 차이를 계산합니다. Trade proof는 최소 안전 규칙을 보장하고, Gate가 직접 읽은 venue 상태와 대조합니다. Manager의 개별 운용 정책은 TEE가 집행합니다.
4. **실행·동기화:** Gate가 소유한 Perpl 계정의 `(account, market)` slot을 빌려 거래합니다. Gate가 호출 데이터를 조립하고 실제 실행 결과를 누산기에 기록합니다. Custody 밖으로 보낸 증거금은 Perpl에 있으므로 모든 자금이 항상 단일 Vault 안에 남아 있는 것은 아닙니다.
5. **평가·정산:** Ledger proof가 인증된 스냅샷과 입출금 큐를 반영해 Product별 자본·지분·보수·청구권을 갱신합니다. 공개 지표는 지연·양자화를 적용하고, 개별 slot과 Product의 연결은 정상 경로에서 숨기는 설계입니다.
6. **출금·장애 대응:** Manager의 축소 창 → TEE fallback → committee 5-of-9를 이용한 Forced Exit로 격상합니다. Forced Exit에서도 실제 체결 가능성과 Perpl 출금 한도의 제약은 남습니다.

위 순서는 목표 구조입니다. 구현 상태는 아래 표와 작업 분배표를 기준으로 판단합니다.

## 지금 구현된 것과 남은 것

| 영역 | 확인된 것 | 남은 검증 |
|---|---|---|
| 명세 기준 | 새 원문 2개 보관, 변경 우선순위·용어·작업 분배 | note/회계/실행의 명세 반례 해소 |
| Perpl 실행 코어 | 전용 계약 계정 A/B의 입금·IOC·미체결·25 lot 부분 체결·전량 회수, 다른 계정 불변 확인(로컬 포크) | 공개 테스트넷 거래, 부분 축소 시 증거금 해제, 공유 slot 귀속, 출금 혼잡, private 제출 |
| 최소 ZK + 실제 TEE | 목표 승인 회로, 계약이 읽은 실제 포지션에 증명 결합, TDX 증명 8개를 같은 거래 경로에 연결, 30개 검사 통과 | 전체 Trade/Lease/Anchor/Ledger 회로, 실제 전략 실행·TEE relayer·키 수명 관리 |
| M1 인코딩·참조 계산 | Rust·TypeScript 302개 벡터: 215 정상 / 87 거절. 수량·레버리지·자본 인출 계산 | 전체 참조 모델, Circom·Solidity와 대조, 최종 schema |
| M2–M6 핵심 프로토콜 | 요구사항·차단 항목·검수 순서 정리 | 새 4개 회로, 운영 Gate/Adapter, TDX rapidsnark, 복구·회계·Forced Exit |
| 기존 연구 경로 | 현물 DEX 포크 ZK 승인·정산, 실제 TDX 합성 입력 증명 생성 | 새 Perpl 경로와 별개. 새로운 성능·보안·회계 기준의 합격 근거가 아님 |

핵심 반례: 100에서 0으로 줄이는 IOC 주문이 10만 체결되면 실제 포지션은 90입니다. 이를 note에 0으로 쓰면 다음 거래의 위험 검사가 틀립니다. 공유 계정 잔액이 일치하더라도 손익을 올바른 Product에 배분했다는 증명이 되지는 않습니다. [수정 제안](docs/spec-review-2026-09-23.md)을 해결한 버전으로 TradeCircuit을 고정해야 합니다.

## 코어 MVP 실행

```sh
npm ci
npm run prove:perpl
npm run build:perpl-zk
npm run prove:perpl:zk
```

실제 TEE 연결은 [별도 절차](docs/core-mvp.md#실제-tee-재현)를 따릅니다. 거래 트랜잭션은 로컬 Anvil에만 보냅니다. 현재 화면은 이 실험의 검증 수단이 아니며, JSON에 목표·실제 체결·증명·영수증·회수액을 남깁니다. 이번 범위는 **Product별 전용 계정**으로 귀속을 단순화했으므로 목표 구조의 공유 slot·귀속 프라이버시를 구현했다고 보지 않습니다.

## 참조 모델 검증

Node 22.23 이상, Rust stable/Cargo. 현재 새 참조 경로는 키·TEE·테스트 토큰 없이 실행합니다.

```sh
npm ci
npm run typecheck:protocol
npm run test:protocol
npm run test:reference
npm run verify:protocol
```

`verify:protocol`은 고정 기대값을 TypeScript와 별도 Rust 구현으로 비교합니다. [벡터](protocol/vectors/draft-v0.1.json)는 draft v0.1 호환 기준이며, 테스트 통과가 회로 soundness나 실제 체결 성공을 뜻하지 않습니다.

[검사 결과와 코드 해시](docs/evidence/protocol-v0.1-conformance.json), [실제 Monad 테스트넷 조회 기록](docs/evidence/perpl-readonly.json)을 보관합니다. `npm run probe:perpl`로 Perpl 버전·출금 한도 조회와 BN254/PREVRANDAO 기본 호환을 재현할 수 있습니다. 서명·배포·자금 이동은 없습니다.

`npm test`는 기존 구현과 새 참조 모델의 JS 테스트를 함께 실행합니다. `npm run build`는 기존 화면의 빌드를 검사합니다. 기존 화면은 `npm run dev`로 열 수 있지만 새 명세를 구현한 제품 화면은 아닙니다. 이전 증거와 재현 방법은 [이전 README](docs/archive/readme-before-perpl.md)에 보존했습니다.

## 외부 비용과 공개 범위

2026-09-23 기존 Phala VM을 재사용해 최소 목표 승인 회로를 실행했습니다. 실험 직전 관측 사용액 $0.24·크레딧 $19.76, prepaid·auto-topup OFF였으며 승인 상한 $2를 증액하지 않았습니다. 실험 후 VM 종료 상태와 비용은 [코어 MVP 기록](docs/core-mvp.md)을 참고하세요. 디스크 영구 삭제는 수행하지 않았으므로 잔여 보관 비용은 별도로 확인해야 합니다.

기본 제출 정책은 `PRIVATE_ONLY`입니다. 보장된 private endpoint가 확인되지 않았으면 대기/만료하며, mandate의 명시적 `ALLOW_PUBLIC` 선택 없이 일반 RPC로 바꾸지 않습니다. 비밀키·실제 전략·witness·인증 토큰은 커밋하지 않습니다.
