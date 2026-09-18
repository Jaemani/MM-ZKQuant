# v0.2 구현 범위 — 독립 전략, 공동 보관

기준은 [사용자 제공 Concept Specification v0.2](confidential-alpha-v0.2.md)다. 투자자는 Strategy Sleeve를 선택한다. Vault 전체 공동 지분을 발행하거나 provider alpha를 합성하는 기존 Pilot은 새 모델의 구현으로 인정하지 않는다.

## 이번에 구현한 경로

`src/sleeves/ledger.js`는 전략별 현금·롱 포지션·숏 차입/담보·투자자 units·실현 손익·거래 비용·제공자 미지급 보수를 관리한다. 주문은 하나의 전략에만 귀속된다. 다른 전략의 현금으로 주문하거나 다른 전략의 보유 자산을 매도할 수 없다. 신규 입금은 선택한 전략의 현재 투자자 귀속 지분가치로 units를 발행하고, 환매는 그 전략의 권리만 줄인다. 같은 제공자가 여러 전략을 운용해도 합치지 않는다.

`src/sleeves/review.js`는 **독립된 모의 보관 장부와 통제 가격**을 사용하는 로컬 검토 실행기다. 한 Vault identity를 사용하되 주문별 strategyId는 비공개 장부에만 남기며, 공개 체결 형태에는 opaque orderId만 전달한다. 이 어댑터는 DEX나 블록체인 실행을 증명하지 않는다. 기존 `.data/testnet-pilot`과 자금을 변경하지 않고 `.data/sleeve-review/state.json`에 검토 데이터를 저장한다.

첫 화면은 `Strategies`다. 검토 투자자 A/B를 선택해 원하는 전략에 배정하고, 동일 가격 변화에 대한 전략별 결과를 확인하고, 한 전략만 환매할 수 있다. 표시되는 세 전략은 명시적인 회계 검토 예제이며 등록된 실제 제공자나 검증된 forward 이력이 아니다. 투자자 선택은 로컬 역할 전환이며 인증·지갑 서명이 아니다.

## 대사와 보수

- 실제 보관을 흉내 낸 어댑터의 현금·자산 수량·차입 lot·escrow와 전략별 장부의 합을 대조한다. 불일치하면 작업을 저장하지 않는다.
- `VaultEquity = Σ StrategyEquity + ProtocolAccruals`. 개별 포지션 평가 후 합산과 수량 합산 후 평가 사이의 정수 반올림 차이는 작은 상한을 검사하고 protocol valuation rounding으로 명시한다.
- 각 전략에서 `StrategyEquity = Σ InvestorClaim + ProviderAccrual`. 지분 나눗셈의 최소 단위 잔여는 largest-remainder 방식으로 명시적으로 배정한다.
- 검토 정책은 전략별 지분당 이전 고점을 넘는 이익의 10%를 해당 전략의 제공자 보수로 적립한다. Shapley와 공동 이익 배분을 사용하지 않는다. 입금 자체를 성과보수로 계산하지 않도록 높은 정밀도의 지분당 고점을 유지한다.
- 보수는 미지급 권리로 남아 투자자 몫과 분리된다. 장부에는 보수 지급 연산이 있지만 화면의 체인 지급 기능은 아직 연결하지 않았다.
- 자본 이동은 **선택한 전략의** 포지션이 정산된 때만 허용한다. 다른 전략이 현금을 갖고 있어도 자기 전략의 현금 부족을 대신 메우지 않는다.

## 검토 API

기존 localhost Host/Origin 제한을 적용한다. 실제 투자자에게 공개하는 API가 아니다.

| API | 동작 |
|---|---|
| GET /api/sleeves/review?investor=review-a | 전략 목록·선택한 검토 투자자 지분·공동 장부 대사 |
| POST /api/sleeves/review/allocate | investor, strategyId, amount, requestId로 검토 자본 배정 |
| POST /api/sleeves/review/redeem | 선택한 전략의 검토 투자자 지분 전액 환매 |
| POST /api/sleeves/review/cycle | ±20% 이내 통제 가격으로 독립 롱/숏 회계 재현 |

공개 조회에는 원문 alpha·전략별 포지션·주문과 전략의 연결을 포함하지 않는다. 검토 파일은 로컬 운영자가 읽을 수 있다. TEE 또는 실제 사용자 접근 통제가 구현됐다는 뜻이 아니다.

## 남은 필수 연결

1. 제공자 등록과 서명 제출을 **strategyId에 귀속**시키고 독립 target을 생성하는 실행 경로. 기존 공동 합성 함수는 재사용하지 않는다.
2. 투자자의 지갑 인증·서명된 allocation/withdrawal 권한과 비공개 claim 관리. 검토 역할 선택을 실사용 인증으로 쓰지 않는다.
3. 새 Omnibus Vault와 DEX 어댑터. 실제 receipt에서 주문별 체결·비용·담보·차입을 확인한 뒤 새 장부를 갱신해야 한다. 현재 배포된 PilotFund 공동 지분을 새 전략 지분으로 해석하지 않는다.
4. 체인 전송과 장부 변경 사이 실패·재시작 복구, 외부 최종성, 독립적인 실제 자산 대사. 현재 모의 작업의 원자적 저장만으로 외부 transaction의 원자성을 주장하지 않는다.
5. 급변·부채 초과 시 강제 청산과 부족분 처리. 공동 보관은 파산 격리를 보장하지 않으며 다른 전략에 손실을 전가하지 않는 실패 정책이 필요하다.
6. 실제 전략별 forward track record, 전략 선택·예치·운용·정산·환매의 외부 통합 검증.
7. TEE 격리와 attestation은 기존 사용자 요청대로 제외되어 있다. 공유 주소만으로 주문 시각·수량의 추론 공격까지 차단됐다고 주장하지 않는다.

새 회계 검토가 통과해도 위 연결이 완료된 MVP로 판정하지 않는다. 이전 공동 펀드의 테스트·체인 예치 증거는 새 전략 상품의 운용 증거가 아니다.
