# Monad Metropolis

**2026-10-05 현재 사용자 플랫폼:** [MM-ZKQuant](https://mm-zkquant.vercel.app)에서 전략가 등록·자기자본 입금·암호화 목표 비중 제출·실제 Perpl 실행, 투자자의 대기 입금·다음 제출 시 지분 편입·정산 출금을 사용할 수 있습니다. 단일 공용 Vault를 사용하며 전략 주문은 서로 합산하지 않습니다. 전략별 장부와 실행 계정 귀속은 TEE에 보관합니다.

현재 제품의 기준은 [플랫폼 인수 문서](docs/e2e-platform-handoff.md)와 [전략가 API 안내](docs/testnet-platform-api.md)입니다. 아래 cohort/ZK 기록은 별도 선행 실험입니다. 현재 플랫폼의 모든 주문·장부 변경에 ZK proof 검증을 연결했다고 해석하면 안 됩니다.

로컬 실행: `.env.example`을 참고해 DB와 TEE 연결을 설정한 뒤 `npm ci`, `npm run dev`를 실행합니다. Vite는 5173, 공개 플랫폼 API는 8789 포트입니다. 배포는 Vercel `mm-zkquant`, Supabase `monad`, 기존 Phala CVM을 사용합니다.

**2026-10-04 최신 코어 MVP:** 투자자 2명 입금 → TEE 내부 정책 검사·ZK 생성·직접 제출 → 공개 Perpl 진입/종료 → 실제 회수액에 대한 장부 ZK → 지분 소각·투자자 지급을 통과했습니다. TEE 실제 재시작·키 교체·중복 요청 거절도 확인했습니다. **한 번의 운용 주기를 끝까지 정산하는 제한된 MVP**이며 전체 v1 Ledger·중도 가입·공유 slot을 완료한 것은 아닙니다.

[최신 구현 범위·1–4 검수 결과·공개 트랜잭션](docs/2026-10-04-core-cohort-mvp.md)을 먼저 읽으세요. 팀원은 키 없이 `npm run verify:cohort:testnet`으로 재검증할 수 있습니다.

## 팀원이 먼저 읽을 문서

0. [최신 코어 1–4 결과](docs/2026-10-04-core-cohort-mvp.md) — 장부·재개·TEE 제출·2인 정산, 430개 JS 검사와 공개 실행 증거. 이전 연결 실험은 [코어 기록](docs/core-mvp.md).
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
| 종료 정산 cohort MVP | 투자자 2명 지분·성과보수·출금, 종료 장부 proof, TEE 내부 키·정책·제출·재시작, 공개 실제 지급 | 운용 중 NAV·중도 가입·부분 출금·반복 HWM·공유 slot 회계 |
| 명세 기준 | 새 원문 2개 보관, 변경 우선순위·용어·작업 분배 | note/회계/실행의 명세 반례 해소 |
| Perpl 실행 코어 | 전용 계약 계정 A/B의 입금·IOC·미체결·25 lot 부분 체결·전량 회수, 다른 계정 불변 확인(로컬 포크); 공개 테스트넷 A/B 입금·실제 체결·종료·회수 통과 | 부분 축소 시 증거금 해제, 공유 slot 귀속, 출금 혼잡, private 제출 |
| 최소 ZK + 실제 TEE | 목표 승인 회로, 계약이 읽은 실제 포지션에 증명 결합, TDX 증명 8개를 같은 거래 경로에 연결, 30개 검사 통과 | 전체 Trade/Lease/Anchor/Ledger 회로, 일반 전략 엔진·운영 키 수명 관리. 별도 cohort에서 TEE relayer·키 세대 교체는 통과 |
| 공개 테스트넷 ZK | 정상 승인 1건, 변조·재사용 거절 각 1건, 실제 영수증·계약 상태 확인 | 합성 입력의 독립 probe만 통과. 후속 TEE 증명→공개 Perpl 연결 통과; TEE 내부 relayer는 미구현 |
| M1 인코딩·참조 계산 | Rust·TypeScript 302개 벡터: 215 정상 / 87 거절. 수량·레버리지·자본 인출 계산 | 전체 참조 모델, Circom·Solidity와 대조, 최종 schema |
| M2–M6 핵심 프로토콜 | 요구사항·차단 항목·검수 순서 정리 | 새 4개 회로, 운영 Gate/Adapter, TDX rapidsnark, 복구·회계·Forced Exit |
| 기존 연구 경로 | 현물 DEX 포크 ZK 승인·정산, 실제 TDX 합성 입력 증명 생성 | 새 Perpl 경로와 별개. 새로운 성능·보안·회계 기준의 합격 근거가 아님 |

핵심 반례: 100에서 0으로 줄이는 IOC 주문이 10만 체결되면 실제 포지션은 90입니다. 이를 note에 0으로 쓰면 다음 거래의 위험 검사가 틀립니다. 공유 계정 잔액이 일치하더라도 손익을 올바른 Product에 배분했다는 증명이 되지는 않습니다. [수정 제안](docs/spec-review-2026-09-23.md)을 해결한 버전으로 TradeCircuit을 고정해야 합니다.

추가로 [단일 트랜잭션 검사](docs/core-mvp.md#단일-트랜잭션-추가-검증) 32개를 통과했습니다. 성공 주문 6건에서 증명 검증→Perpl 실행의 내부 호출을 추적했고, Perpl에서 실패하면 nonce·포지션·담보가 함께 원복됨을 확인했습니다. [팀 검토 시나리오](docs/core-mvp-scenarios.md)에 보여줄 데이터와 합격 기준을 정리했습니다.

## 공개 테스트넷 진행 상태 — 2026-10-04

최신 실험은 **한 Product, 투자자 2명, 하나의 종료 정산 주기**입니다. 60/140 테스트 AUSD를 입금해 실제 +100 lot 거래 후 전량 종료했고, 회수액 199.911176을 장부 proof로 검증해 59.973352/139.937824를 지급했습니다. 지분·미지급 청구권·계약 잔액은 0입니다. 공개 tx 21건의 가스는 2.334507558 테스트 MON입니다.

```sh
npm ci
npm run verify:cohort:testnet
```

이 명령은 키 없이 과거 거래·계약 코드·proof·TEE 제출 주소·지급액을 재검증하며 새 거래를 보내지 않습니다. [결과와 한계](docs/2026-10-04-core-cohort-mvp.md).

이전 단계: [9/24 공개 ZK 승인·거절](docs/2026-09-24-core-validation-handoff.md) → [10/3 로컬 prover·공개 Perpl](docs/2026-10-03-public-perpl-validation.md) → [10/4 TEE prover·로컬 relayer](docs/2026-10-04-tee-public-validation.md). 최신 cohort에서는 relayer도 TEE 안으로 옮겼습니다.

## 코어 MVP 실행

```sh
npm ci
npm run prove:perpl
npm run build:perpl-zk
npm run prove:perpl:zk
```

실제 TEE 연결은 [별도 절차](docs/core-mvp.md#실제-tee-재현)를 따릅니다. 위 명령의 거래 트랜잭션은 로컬 Anvil에만 보냅니다. 현재 화면은 이 실험의 검증 수단이 아니며, JSON에 목표·실제 체결·증명·영수증·회수액을 남깁니다. 이번 범위는 **Product별 전용 계정**으로 귀속을 단순화했으므로 목표 구조의 공유 slot·귀속 프라이버시를 구현했다고 보지 않습니다.

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

`npm test`는 현재 플랫폼의 장부·주문·출금·손익·권한·연결에 관한 핵심 28개 테스트를 실행합니다. 컨트랙트를 변경할 때는 `npm run test:contracts`, 이전 연구 코드와 프로토콜 참조 검증까지 확인할 때는 `npm run test:all`을 사용합니다. 화면 변경은 `npm run build`와 변경한 흐름의 브라우저 확인을 우선합니다. 이전 증거와 재현 방법은 [이전 README](docs/archive/readme-before-perpl.md)에 보존했습니다.

## 외부 비용과 공개 범위

2026-10-04 cohort 실험 후 VM Stopped, prepaid·auto-topup OFF를 확인했습니다. 크레딧 관측은 $19.03 → $19.01이며 기존 $2 상한을 늘리지 않았습니다. 디스크 보관 비용은 남아 있습니다.

2026-09-23 기존 Phala VM을 재사용해 최소 목표 승인 회로를 실행했습니다. 실험 직전 관측 사용액 $0.24·크레딧 $19.76, prepaid·auto-topup OFF였으며 승인 상한 $2를 증액하지 않았습니다. 실험 후 VM 종료 상태와 비용은 [코어 MVP 기록](docs/core-mvp.md)을 참고하세요. 디스크 영구 삭제는 수행하지 않았으므로 잔여 보관 비용은 별도로 확인해야 합니다.

기본 제출 정책은 `PRIVATE_ONLY`입니다. 보장된 private endpoint가 확인되지 않았으면 대기/만료하며, mandate의 명시적 `ALLOW_PUBLIC` 선택 없이 일반 RPC로 바꾸지 않습니다. 비밀키·실제 전략·witness·인증 토큰은 커밋하지 않습니다.

통합 투자·운용 화면의 경로, API 변경, 배포 검증은 [UX 인계 문서](docs/ux-platform-handoff.md)를 참고하세요.
