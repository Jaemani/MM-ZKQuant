# Confidential Alpha Protocol

## Concept Specification v0.2

---

# 1. 한 문장 정의

> **Investor가 자신이 원하는 Alpha Provider의 전략을 선택해 투자하고, 각 전략의 경제적 성과는 독립적으로 귀속되지만, 실제 자산과 거래는 하나의 공동 Omnibus Vault에서 처리되는 confidential asset-management protocol.**

핵심은:

```text
Investor chooses a Strategy
            ↓
Economic Exposure is Strategy-Specific

하지만

Actual Capital
Actual Assets
Actual Transactions
            ↓
One Shared Vault
```

이다.

---

# 2. 가장 중요한 구조적 원칙

이 프로토콜에서는 다음 두 개를 반드시 분리한다.

## Physical Asset Layer

실제 자산이 어디에 존재하는가?

```text
ONE OMNIBUS VAULT
```

모든 Investor의 실제 자산은 하나의 Vault에 존재한다.

---

## Economic Accounting Layer

누가 어떤 전략에 투자했고 누구의 성과를 가져가는가?

```text
PRIVATE STRATEGY LEDGER
```

에서 관리한다.

즉:

```text
Physical custody
=
shared

Economic exposure
=
strategy-specific
```

이다.

---

# 3. Investor는 Vault 전체에 투자하지 않는다

Investor는 특정 Alpha Provider를 선택한다.

예:

```text
Investor A
      ↓
Provider X Strategy
      ↓
$100,000 allocation
```

Investor B는 다른 Provider를 선택할 수 있다.

```text
Investor B
      ↓
Provider Y Strategy
      ↓
$200,000 allocation
```

실제 자금은 모두 같은 Vault로 들어간다.

```text
Investor A ─ $100k ─┐
                     │
Investor B ─ $200k ─┼──→ ONE VAULT
                     │
Investor C ─  $50k ──┘
```

하지만 economic accounting은 다음과 같이 분리된다.

```text
Provider X Strategy Sleeve
$150k

Provider Y Strategy Sleeve
$200k
```

---

# 4. Strategy Sleeve

각 Alpha Provider는 하나 이상의 독립적인 Strategy Sleeve를 가진다.

Strategy Sleeve는 실제 별도 wallet이나 vault가 아니다.

**Private Ledger 내부의 논리적 계정이다.**

예:

```text
Provider X / Strategy #1

Allocated Capital     $150,000

BTC Position          +$60,000
ETH Position          -$20,000

Cash                  $110,000

Strategy NAV          $153,200
```

실제 자산은 여전히 Omnibus Vault에 있다.

---

# 5. Investor Position

Investor는 Strategy Sleeve에 대한 경제적 claim을 가진다.

예:

```text
Provider X Strategy

Investor A     $100k
Investor C      $50k

Total          $150k
```

Provider X 전략이 +10% 수익을 내면:

```text
Investor A
$100k → $110k

Investor C
$50k → $55k
```

가 된다.

Provider Y의 성과는 이 Investor들에게 영향을 주지 않는다.

---

# 6. Strategy별 NAV

따라서 Protocol에는 두 종류의 NAV 개념이 존재한다.

## Vault NAV

실제 Omnibus Vault 전체 자산 가치.

예:

```text
Vault NAV = $10,000,000
```

이는 custody/accounting reconciliation을 위한 값이다.

---

## Strategy NAV

각 Provider 전략에 귀속되는 경제적 가치.

예:

```text
Provider A Strategy NAV = $2.1M
Provider B Strategy NAV = $3.4M
Provider C Strategy NAV = $1.8M
...
```

Investor return은 **Strategy NAV**를 기준으로 결정된다.

---

# 7. Vault NAV는 투자 상품의 수익률이 아니다

매우 중요한 구분이다.

```text
Vault NAV change
≠
Investor Return
```

Investor의 return은 자신이 선택한 Strategy Sleeve의 성과로 결정된다.

예:

```text
Provider A Strategy
+20%

Provider B Strategy
-10%
```

Vault 전체에서는 두 결과가 섞여 보일 수 있지만:

```text
A Investor → +20%

B Investor → -10%
```

이다.

---

# 8. Alpha Provider

Alpha Provider는 자신만의 전략을 운용한다.

Provider가 Protocol에 전달하는 것은 strategy source code가 아니라 private alpha다.

예:

```text
Provider A

BTC +0.8
ETH -0.2
MON +0.4
```

Provider B:

```text
BTC -0.5
ETH +0.9
SOL +0.3
```

두 alpha는 서로 합치지 않는다.

---

# 9. Alpha는 독립적으로 유지한다

다음은 하지 않는다.

```text
Provider A alpha
+
Provider B alpha
+
Provider C alpha
       ↓
Aggregate Alpha
```

각 Provider의 alpha는 자신의 Strategy Sleeve에만 영향을 준다.

```text
Alpha A
  ↓
Strategy A

Alpha B
  ↓
Strategy B

Alpha C
  ↓
Strategy C
```

---

# 10. Strategy Capital

각 Strategy가 사용할 수 있는 자본은 해당 Strategy를 선택한 Investor들의 자본으로 결정된다.

예:

```text
Provider A

Investor 1     $100k
Investor 2      $50k
Investor 3     $350k

Strategy A Capital
= $500k
```

따라서 Provider A의 position sizing은 기본적으로 이 $500k를 기준으로 한다.

---

# 11. 실제 돈은 Strategy별로 분리 보관하지 않는다

논리적으로:

```text
Strategy A $500k
Strategy B $800k
Strategy C $300k
```

가 존재하더라도 실제 onchain custody는:

```text
ONE VAULT
$1.6M
```

이다.

따라서:

> **Strategy segregation은 accounting-level segregation이지 custody-level segregation이 아니다.**

---

# 12. 실제 주문도 동일한 Vault에서 발생한다

Provider A:

```text
BUY BTC $100k
```

Provider B:

```text
SELL BTC $70k
```

Provider C:

```text
BUY ETH $200k
```

실제 chain에서는:

```text
AlphaVault → BUY BTC $100k

AlphaVault → SELL BTC $70k

AlphaVault → BUY ETH $200k
```

만 보인다.

각 주문이 어느 Provider의 것인지는 공개하지 않는다.

---

# 13. Provider ↔ Order Mapping

Private Ledger는 다음 관계를 알고 있다.

```text
Order #1001
→ Provider A
→ Strategy A

Order #1002
→ Provider B
→ Strategy B

Order #1003
→ Provider C
→ Strategy C
```

외부에서는:

```text
Order #1001 → AlphaVault
Order #1002 → AlphaVault
Order #1003 → AlphaVault
```

만 확인 가능하다.

---

# 14. Privacy의 핵심

Protocol이 숨기는 것은:

```text
Provider
   ↓
Alpha
   ↓
Strategy Position
   ↓
Order
   ↓
Fill
```

의 연결 관계다.

Vault의 실제 거래 자체를 숨기는 것이 아니다.

따라서 외부인은:

> “Vault가 BTC를 샀다.”

는 알 수 있지만,

> “Provider A의 전략 때문에 BTC를 샀다.”

는 직접 알 수 없어야 한다.

---

# 15. One Vault가 Shared Order Flow를 만든다

다양한 Provider가 동일한 Vault를 사용한다.

```text
Provider A
momentum

Provider B
mean reversion

Provider C
hedging

Provider D
relative value

Provider E
AI strategy
```

모든 거래가 동일한 Vault transaction으로 나타난다.

따라서 외부에서는 개별 Provider의 strategy를 transaction flow에서 분리하기 어려워진다.

---

# 16. Investor가 Provider를 선택한다

Protocol의 투자 UX는 기본적으로:

```text
Investor
    ↓
Provider / Strategy 탐색
    ↓
Track Record 확인
    ↓
Strategy 선택
    ↓
Capital 배정
```

이다.

Investor가 반드시 하나의 Strategy만 선택해야 하는 것은 아니다.

예:

```text
Investor A

$50k → Provider A
$30k → Provider B
$20k → Provider C
```

처럼 여러 Strategy에 투자할 수도 있다.

각 allocation은 독립적인 투자 position이다.

---

# 17. Investor Portfolio

Investor가 여러 Strategy를 선택하면 Investor 자체의 portfolio는:

```text
Investor A

Strategy A  50%
Strategy B  30%
Strategy C  20%
```

가 된다.

이는 **Investor가 직접 선택한 allocation**이다.

Protocol이 Alpha Provider들의 alpha를 자동으로 섞는 것과는 다르다.

---

# 18. Provider Track Record

Investor는 전략 코드 대신 Provider의 검증 가능한 forward track record를 확인한다.

예:

```text
Provider A

Live History       14 months
Return             +31%
Sharpe              1.6
Max Drawdown       -8.4%
Volatility          14%
Completeness        99.2%
```

이 데이터를 보고 투자 여부를 결정한다.

---

# 19. Provider의 가치 제안

Provider 입장에서는 자신의 strategy를 공개하지 않고 외부 capital을 받을 수 있다.

```text
Private Strategy
      ↓
Private Alpha
      ↓
Protocol
      ↓
Investor Capital
      ↓
Real Trading
      ↓
Performance Fee / Reward
```

즉:

> **Alpha를 공개하지 않고 AUM을 확보한다.**

---

# 20. Investor의 가치 제안

Investor는:

> **검증된 private strategy에 직접 편승할 수 있다.**

Investor가 얻는 것은:

```text
Vault 전체의 평균적인 성과
```

가 아니라:

```text
자신이 선택한 Provider 전략의 성과
```

이다.

이것이 Protocol의 핵심 investment product다.

---

# 21. Provider PnL

각 주문과 fill의 Provider attribution을 알고 있기 때문에 Strategy별 PnL을 별도로 계산한다.

예:

```text
Provider A

BUY BTC
$100k

BTC +10%

Strategy Profit
≈ +$10k
```

이 $10k는 Provider A Strategy의 economic value에 귀속된다.

---

# 22. Strategy Accounting

각 Strategy Sleeve에는 최소한 다음이 존재한다.

```text
Strategy Capital

Cash

Positions

Orders

Fills

Realized PnL

Unrealized PnL

Fees

Provider Reward

Strategy NAV
```

---

# 23. Investor Accounting

Investor별로:

```text
Investor
Strategy
Shares / Units
Entry NAV
Current NAV
PnL
```

을 관리한다.

예:

```text
Investor A

Provider X Strategy
100 strategy units

Entry NAV = 1.00
Current NAV = 1.12

Return = +12%
```

---

# 24. Strategy Share

개념적으로 각 Strategy에는 독립적인 share/unit accounting이 존재할 수 있다.

예:

```text
Strategy A NAV = $1,000,000

Shares = 1,000,000

Share Price = $1.00
```

Investor가 $100k 투자:

```text
100,000 Strategy A Shares
```

Strategy가 +10%:

```text
Share Price = $1.10
```

Investor value:

```text
$110,000
```

실제 token을 발행할 필요는 없다.

Private Ledger상의 accounting unit일 수도 있다.

---

# 25. Omnibus Vault의 역할

Omnibus Vault는 투자 상품 그 자체가 아니다.

Vault의 역할은:

```text
custody

execution

collateral

liquidity

settlement
```

이다.

투자 상품은 실질적으로:

```text
Provider Strategy Sleeve
```

다.

---

# 26. 정확한 구조

```text
                         INVESTORS

Investor 1 ──────→ Provider A Strategy
Investor 2 ──────→ Provider B Strategy
Investor 3 ──────→ Provider A Strategy
Investor 4 ──────→ Provider C Strategy

                        │
                        │ economic accounting
                        ▼

              ┌──────────────────────┐
              │    PRIVATE LEDGER    │
              │                      │
              │ Strategy A NAV       │
              │ Strategy B NAV       │
              │ Strategy C NAV       │
              │                      │
              │ Investor Positions   │
              │ Provider Positions   │
              │ Order Attribution    │
              │ Fill Attribution     │
              └──────────┬───────────┘
                         │
                         │ actual asset operations
                         ▼

              ╔══════════════════════╗
              ║   OMNIBUS VAULT     ║
              ║                      ║
              ║  All Real Capital   ║
              ║  All Real Assets    ║
              ╚══════════╤═══════════╝
                         │
                         ▼
                       MARKET
```

---

# 27. 가장 중요한 Invariant

Protocol accounting은 항상 다음 관계를 만족해야 한다.

전체 Vault equity:

[
VaultEquity
]

는 모든 Strategy의 economic equity를 합친 것과 일치해야 한다.

\sum\_i StrategyEquity\_i
+
ProtocolAccruals
]

그리고 각 Strategy는:

\sum\_j InvestorClaim\_{j,i}
+
ProviderAccrual\_i
]

관계를 유지해야 한다.

---

# 28. 핵심 설계 원칙

```text
1. Investor는 Vault 전체에 투자하지 않는다.

2. Investor는 특정 Provider Strategy를 선택한다.

3. Investor의 PnL은 선택한 Strategy의 PnL이다.

4. Provider별 Strategy는 경제적으로 독립적이다.

5. 모든 Strategy의 실제 자산은 하나의 Vault에서 보관된다.

6. Strategy별 별도 Vault는 만들지 않는다.

7. Provider Alpha는 서로 합성하지 않는다.

8. Provider Order도 서로 귀속을 섞지 않는다.

9. 모든 실제 주문은 동일한 Vault identity로 실행된다.

10. Provider ↔ Order mapping은 Private Ledger에서만 관리한다.

11. Vault는 custody/execution layer다.

12. Strategy Sleeve가 실제 investment product다.
```

---

# 29. 제품을 가장 정확하게 설명하면

Investor 입장:

> **Choose a private alpha provider and invest directly in their strategy.**

Provider 입장:

> **Monetize your alpha with external capital without revealing your strategy.**

Protocol 입장:

> **Keep strategy economics separate while pooling custody and execution into one vault.**

---

# 30. 최종 정의

> **A marketplace for private investment strategies where investors choose which alpha provider to follow, each strategy maintains independent economics and performance, while all real assets and executions are pooled through a single omnibus vault.**

짧게 표현하면:

> **Many private strategies. One shared vault.**

그리고 이 Protocol의 핵심은:

```text
One Vault
≠
One Fund Strategy
```

다.

정확히는:

```text
One Vault

Many Independent Strategy Sleeves

Many Independent Investor Exposures
```

다.