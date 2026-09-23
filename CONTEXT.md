# Monad Metropolis

프로토콜은 Confidential Trade Intent Execution이다. 투자자가 선택한 Manager의 비공개 운용 의도를 검증 후 Perpl에서 실행하고, Product별 자금·손익·지분의 귀속을 유지한다.

**Manager**: 하나의 Product를 운용하고 목표 포지션을 서명하는 주체다. 자기자본 참여는 선택이며 v1에서 의무 staking이나 slashing은 없다.

**Product**: 한 Manager의 약정 아래 투자자 자금과 손익·지분·보수를 구분하는 단위다. _Avoid_: 여러 Product를 섞은 단일 전략, Alpha Provider의 다중 Sleeve.

**Mandate**: Product의 운용 조건·키·제출 정책 등 투자자와 합의한 규칙이다. **Policy**는 TEE가 실행하는 Manager별 운용 제한이다.

**Target Intent**: 특정 시점에 원하는 절대 목표 수량을 담은 일회성 서명 메시지다. 빠진 시장은 유지하고 목표 0은 청산을 뜻한다.

**Custody**: 아직 venue 증거금으로 보내지 않은 담보와 지급 재원을 보관하는 계약이다. Perpl로 보낸 증거금은 Custody 잔액과 구분한다.

**ExecutionGate**: 증명과 venue 상태를 검사하고 승인된 호출만 생성하는 계약이다. Perpl pool 계정의 소유자다.

**Slot**: pool 계정과 market의 쌍이다. **Lease**는 epoch로 구분된 slot 사용권이며, 정상 경로의 Product 귀속은 비공개다.

**slotCredit**: 계정의 공유 free balance 중 특정 slot에 귀속되는 공개 회계 값이다. Product 잔액이나 투자자 지분을 뜻하지 않는다.

**State Note**: Product 운용 상태를 숨긴 commitment의 opening이다. **Nullifier**는 같은 note를 두 번 소비하지 못하게 하는 식별값이다.

**Snapshot Accumulator**: Gate가 인증한 venue 상태 기록을 연결한 해시 체인이다. 현재 상태 관측과 과거 모든 사건의 재구성은 구분한다.

**Ledger**: Product별 자본·지분·보수·출금 청구권을 확정하는 장부다. **Anchor**는 note가 참조하는 확정 장부 상태다.

**Fallback**: Manager 출금 창 이후 TEE가 허용된 범위로 포지션을 줄이는 경로다. **Forced Exit**는 committee 복호화를 통해 TEE 없이도 축소·정산을 진행하는 경로다.

**Committee**: 복구·Forced Exit를 위한 threshold 복호화 키를 나눠 보유하는 독립 주체들의 집합이다. 5-of-9 가용성은 탈출 경로의 전제다.

**Pre-execution Confidentiality**: 제출 전 목표·장부 비밀과 귀속 추론 완화를 뜻한다. 이미 체결된 venue 포지션 전체의 비공개를 뜻하지 않는다.
