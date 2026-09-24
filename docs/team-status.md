# 팀 진행 상태 · 2026-09-24

> **최신 추가 결과:** 공개 Monad 테스트넷에서 최소 목표 승인 ZK의 정상 승인·변조 거절·재사용 거절을 실제 트랜잭션으로 확인했다. [팀 전달용 판정표·트랜잭션·재현 명령](2026-09-24-core-validation-handoff.md). 이 검사는 합성 입력이며 Perpl 호출과 TEE 실행은 없다. Perpl 공개 거래는 테스트 AUSD 200개 부족으로 계속 차단돼 있다.

> **2026-09-23 코어 MVP 추가:** [실험 결과와 재현](core-mvp.md). 두 전용 Product 계정의 Perpl 포크 거래·실제 체결 동기화·회수, 최소 ZK 목표 승인, 실제 TDX 증명→로컬 거래 연결을 통과했다. 이는 아래 전체 v1 마일스톤의 완료 처리가 아니다. 실제 전략/TEE relayer, 공개 테스트넷 거래, Ledger·지분·보수·공유 slot·복구는 남아 있다.

기준은 [제품 v1.4 / 개발 v0.1](specs/README.md)이다. 앞선 현물 Vault·Virtual Book·의무 자기자본/staking 중심 문서는 [이전 팀 상태](archive/team-status-before-perpl.md)로 보존했다. 개발 §0에 따라 Manager 자기자본은 선택, v1 의무 staking/slashing은 제외한다.

**현재: M0 미종료, 독립적인 M1 기반 작업 일부 완료. M2 이후 구현 완료를 주장하지 않는다.** 인코딩 검사 통과와 운영 프로토콜 통과를 구분한다.

## 완료한 작업

- 두 원문을 그대로 버전 관리하고 README·도메인 용어·우선순위를 갱신했다.
- 공식 Perpl ABI·배포 버전과 실제 Monad RPC를 조사했다. 공개 Perpl 거래나 입출금은 아직 실행하지 않았다. 로컬 포크에서는 실행했다.
- Rust/TypeScript의 scalar/domain/§4 명시 해시 식과 intent/note 조합을 구현했다. 302개 고정 벡터(정상 215, 거절 87)가 일치한다.
- 두 언어에서 IOC delta, 축소·자본 인출·최소 비례 축소·단위 변환·레버리지 계산을 구현했다. TS에는 인증된 실제 결과 대기와 제출 정책의 후보 동작이 있다.
- IOC 위험 과소계상, 동일 seq의 서로 다른 intent 혼합, slotCredit 귀속 모호성에 대한 실행 가능한 반례를 작성했다.
- 최종 로컬 검사: JS 422개(기존 111 + 새 참조 경로 311), Rust 3개 통과. TypeScript strict 검사·Rust clippy·기존 화면 빌드 통과. 302개 벡터는 새 JS 검사에도 포함되어 있으므로 별도 테스트 수로 더하지 않는다.
- `npm run probe:perpl`로 반복 가능한 read-only probe를 추가했다. [실제 테스트넷 관측](evidence/perpl-readonly.json)에는 block·ABI·proxy/implementation 코드 해시와 BN254/PREVRANDAO 기본 검사를 기록했다. 실제 거래·회계·proof 가스 합격을 뜻하지 않는다.
- 2026-09-24 공개 ZK 검사: 배포 2건·정상 승인 1건·의도한 실패 2건, 총 `0.518226096` 테스트 MON. 별도 읽기 전용 검증기로 소스/배포 코드·정확한 calldata·증명 유효성·각 블록의 승인 횟수를 재검사한다. [증거](evidence/public-zk-testnet.json).

## 역할별 작업 분배

개인 이름을 임의 배정하지 않았다. 아래 역할별로 담당자를 지정하면 작업 티켓으로 사용할 수 있다.

| ID / 역할 | 입력 → 산출물 | 검수 기준 / 선행 조건 |
|---|---|---|
| V1 Venue·계약 | 공식 ABI/배포 버전 → contract-owned account wrapper와 Perpl fork fixtures | 등록·담보·IOC 정상/0/부분체결·close·청산·funding·DCP request/complete/decline/cancel 모두 실제 상태로 검증. chain/implementation/code hash 고정 |
| V2 회계·Venue | V1 실제 잔액 변화 → slot별 현금 흐름 귀속 모델 | 두 시장 외부 사건이 겹쳐도 Product 귀속이 유일하고 합계 보존. 불가능하면 계정 단위 lease 등 대안 확정. S5·S9/B1·B2 |
| P1 회로·프로토콜 | 원문 + 반례 → note/signal/accumulator 수정안 | S1 실제 체결, S2 epoch/폐기, S3 intent commitment, S4 배포 domain, S6 출금 ref, S8 자본 전이 모두 연결 |
| E1 인코딩·SDK | P1 최종 schema → Rust/TS/Circom/Solidity 인코딩 | 명시된 모든 해시·변환 및 경계 벡터 4종 일치. 현재 2종만 통과. mask·scale·rounding·암호문 직렬화 확정 |
| Z1 ZK·성능 | E1 → TradeCircuit / rapidsnark | T1–T15 정상·위반 witness, 제약 누락 검사. 실제 TDX p50 ≤300ms; 미달이면 M3 전 재설계 |
| C1 온체인 | V1/V2/P1/Z1 → Gate·NoteTree·Nullifier·Lease·Custody·누산기 | 실제 테스트넷 proof 주문, state mismatch/replay/reentrancy/부분체결, 모든 보존식·pause 중 출구 유지. 전체 gas 실측 |
| T1 Enclave·SDK | 승인 measurement + C1 → HPKE/intent/policy/witness/prover/submitter | plaintext가 host 로그에 없고, 키·epoch·정책 검증. SDK→체결 p50<1초. 확인된 private 경로 없으면 PRIVATE_ONLY 만료 |
| T2 복구 | T1 → encrypted journal·다른 cloud standby·committee recovery | active 강제 종료 후 exactly-once 재개, nonce/note 소비 중복 없음. 과거 sealed state rollback 거절 |
| L1 회계·출금 | V2/P1/C1 → Lease/Anchor/Ledger circuits·shares·HWM·WithdrawalQueue | 자본·지분·비용 보존, deposit forward pricing, series HWM, 부분체결 재시도, DRAINING·출금 한도 소진, 중복 claim 거절 |
| X1 Committee·탈출 | T2/L1 → DKG·DLEQ·EscapeManager·공개 prover | 잘못된 share 거절, 5/9 복원, 마지막 cutoff 뒤 신규 slot 포함, 모든 TEE 정지 후 축소·정산 리허설 |
| I1 공개 API·화면 | 확정된 이벤트/단계 → indexer·도메인별 흐름 | 지연·양자화·노출 정책 적용, 실제 입력/상태/증거 표시. 백엔드가 없는 성공 상태를 만들지 않음 |
| Q1 독립 검증 | 전체 → privacy red team·감사·setup·법률 검토 | M7/M8 종료 기준 충족. 메인넷 별도 결정 |

## 지금 팀이 확정해야 하는 설계

1. 계정 공유 상태에서 외부 손익 귀속이 가능한지 V1/V2로 확인하고 slot lease를 유지할지 결정한다.
2. IOC 실행 전/후 note를 어떻게 연결할지, key/mandate 폐기를 어떻게 비공개로 증명할지 결정한다.
3. 비동기 증거금 해제·venue 출금 제한을 고려한 대기 상태와 지급 정책을 정의한다.
4. 보장된 private submission 공급자를 확인한다. 없다고 기본값을 public으로 몰래 변경하지 않는다.

세부 반례·제안은 [명세 검토](spec-review-2026-09-23.md), 외부 근거는 [M0 보고서](research/2026-09-23-perpl-monad-m0.md)를 따른다. 이 목록은 사용자에게 다시 전체 기획을 맡기는 질문이 아니라 팀이 review할 구체적인 설계 변경 목록이다.

## 마일스톤 상태

| 단계 | 상태 | 종료에 남은 것 |
|---|---|---|
| M0 | 조사 진행, 미종료 | B1 공개 실행·귀속, B2 지급 지연, B3 private 경로. B4는 최소 회로의 공개 검증 tx까지 확인; 전체 회로 성능은 미검증 |
| M1 | 독립 기반 일부 구현 | 전체 참조 모델, 최종 schema, Circom/Solidity와 벡터 일치 |
| M2 | 미실행 | 새 TradeCircuit·TDX rapidsnark 성능 |
| M3–M6 | 미구현 | 새 운영 계약·TEE 파이프라인·회계·복구·Forced Exit |
| M7–M8 | 전체 검수 미진행 | 전체 프로토콜 공개 테스트넷·privacy red team·외부 감사·setup·법률 검토. 최소 ZK probe 통과로 완료 처리하지 않음 |

이전 현물 fork 32 checks/10 proofs/15 transactions와 TDX 4,917ms는 역사적 실험이다. 특히 4,917ms는 다른 회로·snarkjs의 합성 입력 측정이므로 새 TradeCircuit 300ms 목표의 pass/fail 측정치로 전용하지 않는다.

## 비용

이번 공개 ZK 검사에는 `0.518226096` 테스트 MON 가스를 사용했다. Perpl 주문·담보 이동·메인넷 거래·유료 인프라 생성은 없다. 이전 Phala VM은 재가동하지 않았고 디스크 삭제는 미확인이다. 현재 잔액을 과거 관측값으로 단정하지 않으며 승인된 $2 첫 실험 예산을 늘리지 않는다.
