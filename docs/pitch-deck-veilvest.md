# Veilvest — 2-Minute Pitch Deck

## 공통 제작 지침

- 총 4장, 발표 시간 약 2분.
- 슬라이드에 표시되는 문구는 영어로 작성.
- 아래 내용은 슬라이드 요소이며, 발표 대본 전체를 넣지 않기.
- 짙은 네이비 배경과 청록색 포인트를 사용한 간결한 금융·기술 디자인.
- 슬라이드마다 핵심 메시지 하나와 시각 요소 하나를 중심으로 구성.
- 실제 제공하지 않은 성과 수치나 팀원 이름은 만들지 않기.

---

## Slide 1 — Who We Are

**발표 시간: 약 20초**

### 핵심 메시지

블록체인 인프라와 암호학에 관심을 가진 한양대학교 Hyblock 개발팀 5명이 만든 프로젝트.

### 표시할 문구

- 프로젝트명: **Veilvest**
- 태그라인: **Private strategies. Visible results.**
- 팀명: **HYBLOCK**
- 팀 소개: **Five builders from Hanyang University’s blockchain club**
- 관심 분야: **Blockchain Infrastructure · Cryptography**

### 시각 요소

- Veilvest 이름을 가장 크게 배치.
- 아래에 HYBLOCK과 Hanyang University를 배치.
- 5명을 나타내는 작은 아이콘 또는 점으로 팀 규모 표현.
- 전체적으로 여백을 넉넉하게 사용.

---

## Slide 2 — The Problem

**발표 시간: 약 30초**

### 핵심 메시지

전략가는 자신의 경쟁력을 보호해야 하지만, 투자자는 투자 판단에 필요한 정보를 확인해야 한다.

### 표시할 문구

- 제목: **Show the results. Protect the strategy.**

#### Strategists

- **Trading ideas are their competitive advantage.**
- **Detailed positions can make strategies easier to copy.**

#### Investors

- **Need evidence before committing capital.**
- **Performance · Risk limits · Fees · Strategist’s own capital**

### 시각 요소

- 왼쪽: Strategist + 잠금 아이콘.
- 오른쪽: Investor + 성과 차트 아이콘.
- 중앙 질문: **How can investors evaluate a strategy without exposing it?**
- 실제 수익률 수치 없이 개념적인 차트만 사용.

---

## Slide 3 — How Veilvest Works

**발표 시간: 약 40초**

### 핵심 메시지

암호화된 목표 포지션을 TEE에서 처리하고, 투자금은 하나의 Vault에 보관한다.

### 표시할 문구

- 제목: **Confidential execution. Public performance.**

### 아키텍처 시각 요소

다음 구성 요소와 연결을 간단한 다이어그램으로 표현:

1. **Strategist**
   - TEE로 연결되는 화살표:
     **Encrypted target positions**

2. **Trusted Execution Environment — TEE**
   - 내부 기능:
     - **Decrypt targets**
     - **Execute each strategy independently**
     - **Maintain private investment ledger**
   - 비공개 처리 영역임을 테두리와 잠금 아이콘으로 표현.

3. **Perpl**
   - TEE에서 연결되는 화살표:
     **Strategy orders**

4. **Investor**
   - Shared Vault로 연결되는 화살표:
     **Deposits / Withdrawals**

5. **Shared Smart-Contract Vault**
   - 하나의 Vault만 표현.
   - TEE가 Vault와 연동해 자금 운용 및 정산을 관리하는 연결 표시.

6. **Public Dashboard**
   - TEE에서 공개 지표가 전달되는 연결 표시.
   - **Performance · Risk limits · Fees · Strategist’s own capital**

### 하단 요약 문구

**Sensitive positions and investment allocations stay inside the TEE.**

### 다이어그램 정확성

- 전략별 주문은 독립적으로 실행되는 구조로 표현.
- 투자자별 전략 배분 장부는 TEE 내부에 배치.
- 성과와 투자 조건은 공개 대시보드에 배치.

---

## Slide 4 — Why We’re Building It

**발표 시간: 약 30초**

### 핵심 메시지

전략 보호는 좋은 퀀트의 참여 동기를 만들고, 투자자에게 더 많은 투자 기회를 제공한다.

### 표시할 문구

- 제목: **Give strong quants a reason to participate.**

### 성장 흐름

아래 3단계를 가로 방향으로 연결:

1. **Invest their own capital**
2. **Build a visible track record**
3. **Attract outside investors**

### 양쪽 가치 제안

#### For Strategists

**Grow capital while keeping their trading edge confidential.**

#### For Investors

**Discover strong performers and evaluate their commitment.**

### 시각 요소

- 위쪽에 3단계 성장 흐름.
- 아래쪽에 Strategists / Investors 두 개의 간결한 카드.
- 마지막 문구를 크게 배치:

**Private strategies. Visible results.**

- 하단: **Veilvest by HYBLOCK**
