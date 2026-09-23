# 개발 v0.1 검토: 회로·계약 확정 전에 풀어야 할 문제

기준일 2026-09-23. 원문은 `docs/specs/`에 보존했다. 아래는 구현 중 발견한 반례와 **제안**이다. 실제 새 TradeCircuit의 취약점을 재현했다는 뜻은 아니다. 아직 해당 회로가 없으며, 명세의 식과 조건을 실행 가능한 참조 계산으로 재현했다.

## S1. 주문량을 실제 체결량으로 기록하면 안 된다 — 거래·출금 차단

개발 §5 T14는 새 note 수량을 `position + signedQty`로 정한다. 기존 100, 목표 0이면 -100 주문을 만들지만, IOC가 -10만 체결되면 실제 수량은 90이다. 명세대로 note에 0을 쓰고 다른 시장에 20을 추가하면, 자본 100·한도 1배에서 note 계산은 20으로 통과하지만 실제 위험은 110이다. `fallbackDoneMask`를 같은 시점에 완료로 표시하면 미체결 잔량을 줄일 재시도도 막힌다.

재현: `tests/protocol-v1/model.test.mjs`의 S1. 정상·0체결·부분체결·전량체결은 모두 venue 읽기값으로 구분해야 한다.

제안: 사전 note에 체결 완료를 주장하지 않는다. 실행 후 Gate가 인증한 실제 결과를 후속 전이에 결합하거나, pending 상태/보수적 최대 노출로 후속 거래를 제한한다. 정산 전에는 실제 축소 수량으로만 fallback 완료를 판정한다. 청산·ADL로 거래 사이 상태가 바뀐 경우도 동일 규칙으로 다룬다. 참조 함수 `reconcileSlot`은 인증된 관측값이 없거나 오래되면 거절하는 **후보 동작**일 뿐, 증명이나 Gate 인증을 구현하지 않았다.

## S2. 현재 유효한 운용 키·약정 버전의 인증 경로가 빠져 있다 — 서명 차단

T3은 note의 managerKeyEpoch와 intent의 epoch가 같다고 요구하지만 §4.2 noteHdr에는 epoch가 없다. epoch를 추가하는 것만으로도 충분하지 않다. root 이력에 남은 미소비 note가 폐기된 키·약정으로 새 거래를 할 수 없도록 현재 registry와 연결해야 한다. Product를 공개 signal로 넣으면 귀속 프라이버시와 충돌한다.

제안: note에 epoch를 결합하고 현재 registry root에 대한 비공개 membership을 증명하는 방법 등으로 폐기 효력을 정의한다. key rotation 시 기존 note migration과 긴급 exit 권한을 함께 명세화한다. 회로·registry 공동 작업이다.

## S3. 같은 intentSeq의 서로 다른 intent를 섞을 수 있다 — 일회성 목표 차단

T4는 같은 seq일 때 사용하지 않은 target bit만 검사한다. Manager가 같은 seq로 A=[시장1 100, 시장2 200], B=[시장1 999, 시장2 -200] 두 개를 서명하면, A의 bit0과 B의 bit1을 섞는 것을 현재 note가 막지 못한다. SDK에서 seq를 올리게 안내하는 것만으로 회로의 주장을 보장할 수 없다.

재현: `tests/protocol-v1/encoding.test.mjs`의 S3. 두 intent commitment는 다르지만 seq/unused-bit 조건은 통과한다.

제안: 활성 `intentComm`을 note에 넣고 같은 seq에서는 commitment가 같아야 한다. SDK 분할은 서로 다른 seq를 쓰며, 이전 intent의 미처리 시장을 새 intent가 무효화하는지 명확히 정한다.

## S4. chain·Gate 배포와 서명/증명의 연결이 명시되지 않았다

intent hash에는 chainId가 있으나 36개 Trade public signal과 T3에는 해당 값이 실제 실행 chain/Gate와 같다는 조건이 없다. executionHash에도 배포 식별자가 없다. nullifier만으로 서로 다른 배포의 재사용을 차단한다고 주장하면 안 된다.

제안: chainId와 Gate 주소/배포 salt를 회로 상수 또는 인증된 domain으로 묶는다. 다른 chain·다른 Gate에서 같은 서명·proof가 거절되는 테스트를 종료 조건으로 둔다.

## S5. 공유 잔액 합계는 Product 귀속을 증명하지 못한다 — 회계 차단

§7.3의 `Σ slotCredit = free balance`는 합계 보존식이다. 이전 A=20/B=30에서 외부 사건 후 free=80이면 A=50/B=30과 A=20/B=60이 모두 통과한다. 서로 다른 시장의 청산·funding·증거금 해제가 Gate 호출 전에 일어나면 전체 잔액 변화가 이번 호출 market의 몫이라는 전제가 성립하지 않는다.

재현: `tests/protocol-v1/model.test.mjs`의 S5. 단순히 sync를 더 자주 호출해도 각 사건의 귀속 증거를 만들지는 못한다.

제안 후보: 검증 가능한 시장별 현금 흐름 API를 확보하거나, 계정 단위 lease/단일 활성 market로 공유 귀속 문제를 없앤다. venue 상태만으로 회계가 유일하게 결정되는지 먼저 포크에서 확인한다. 프라이버시·계정 비용 변화 때문에 현재 설계를 조용히 바꾸지 않는다.

## S6. fallback 비용 귀속에 필요한 withdrawalRef가 snapshot 해시에 없다

§6.3은 `withdrawalRef`가 있는 스냅샷으로 출금 투자자에게 비용을 귀속시키지만 §4.4의 snap 필드에는 이 값이 없다. executionHash에 있는 값을 회계 입력에 인증된 방식으로 전달해야 한다.

제안: Gate 누산기 항목에 실행 결과·withdrawalRef를 결합하거나 execution과 snapshot의 연결을 증명한다. indexer가 붙인 임의 메타데이터로 비용 귀속을 증명하지 않는다.

## S7. 인코딩 명세의 빈칸

- §2는 모든 해시에 domain을 요구하지만 slotLeaf, slot group, noteSecret에는 §4 식상 domain이 없다. 현재 두 언어는 **§4 식 그대로** 재현했다. 새로운 domain을 채택하면 wire version과 전체 벡터를 변경한다.
- NAV/ESCAPE/SIGNALS domain 이름은 있으나 전체 payload layout·암호문 직렬화·빈 값 처리까지 정의되지 않았다. 상수만 구현했다.
- mask 범위, market 정렬, raw venue funding index의 단위, totalShares/unitNav 폭·scale, NAV/성과보수/출금의 구체적인 rounding 정책이 필요하다. 현재 해시 라이브러리는 해당 의미 제약을 검증하는 회로가 아니다.
- signed amount의 범위는 `abs(x) < 2^128`이므로 Rust i128로 표현할 수 없다. BigInt로 구현했고 최대 양수/음수 경계 벡터를 추가했다.

## S8. 입출금 자본과 note의 전이 연결

Ledger가 입금 지분 발행·출금 확정을 하더라도 note의 availableCapital을 언제, 어떤 증명으로 변경하는지 네 회로의 전이 정의에 충분히 연결되지 않았다. 예전 anchor를 이용한 이중 인출/이중 거래 여력을 막는 version과 소비 규칙이 필요하다.

제안: 자본 변경 queue의 소비 cursor와 note 업데이트를 Anchor/Ledger 중 어느 회로가 보장할지 먼저 정하고, 입금 직후 거래·출금 중 거래·중복 anchor 테스트를 만든다.

## S9. Perpl 증거금 해제는 한 번의 execute로 끝나지 않는다

공식 문서/ABI는 요청과 완료가 분리된 DCP 및 120초 대기 조건을 설명한다. §8.2의 증거금 조정과 IOC를 한 원자적 호출로 처리하는 가정은 음수 marginDelta에 그대로 적용할 수 없다. [M0 조사](research/2026-09-23-perpl-monad-m0.md)에 근거를 기록했다.

제안: release request → pending → completion/cancel/decline 상태와 귀속을 정의한다. DRAINING/RELEASE 재시도, venue 전역 출금 한도, 동시 withdrawal, allowance 소진을 회계 보존식과 함께 검증한다.

## 확정 순서

1. Venue/회계 담당이 B1·B2와 S5·S9를 함께 검증하고 slot lease 가능 여부를 결정한다.
2. 회로/계약 담당이 S1–S4·S6·S8을 반영한 note·signal·accumulator v0.2안을 작성한다.
3. 인코딩 담당이 S7을 확정하고 Rust/TypeScript/Circom/Solidity를 동일 벡터로 고정한다.
4. 그 버전으로 실제 TradeCircuit과 TDX rapidsnark p50 ≤300ms를 측정한다. 이전 4,917ms 실험은 회로·prover가 달라 이 기준의 결과가 아니다.

Forced Exit는 committee 5-of-9 가용성, venue 정상 동작, 유동성·출금 한도에 의존한다. 단순 timeout 구현만으로 무조건 지급을 보장한다고 표현하지 않는다.
