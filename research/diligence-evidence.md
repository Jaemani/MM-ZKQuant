# Due diligence, selection bias, and unit economics: evidence notes

조사일: 2026-09-16. 이 문서는 최종 보고서의 근거 노트다. **[사실]**은 아래 원문에서 확인한 내용, **[추론]**은 그 사실에 대한 제품/설계 판단, **[미확인]**은 이번 조사에서 검증하지 못한 사항이다. 수치 예시는 실제 상품 실적이나 측정한 proof 비용이 아니다.

## 1. 기관의 due diligence는 code review보다 넓다

**[사실]** AIMA 공개 안내는 DDQ를 due diligence의 초기 단계이며 마지막 단계는 아니라고 명시한다. 투자자는 응답으로 추가 질문을 만들고 다른 출처의 정보와 교차 확인한다. Short Form Manager Module은 Overview, Governance of the Investment Manager, Operations and Risk Management를 요약한다. 따라서 성과 계산 증명만으로 이 과정을 대체한다는 근거는 없다. [AIMA, Due Diligence Questionnaires](https://www.aima.org/sound-practices/due-diligence-questionnaires.html), 공개 FAQ. 회원 전용 상세 질문지는 열람하지 않았으므로 구체적인 비공개 질문 항목을 인용하지 않는다.

원문: “the DDQ is an early step in the due diligence process but by no means is it the last step”; “cross check information from other sources”.

**[추론]** 코드 비공개는 수용할 수 있어도, 경제적 전략 설명·운용 주체·자산 보관·독립 잔고 확인·유동성·레버리지·장애 대응까지 비공개인 운용은 별개의 문제다. 전문 고객의 후보는 “모든 기관”이 아니라 이 정보를 받으면서도 code escrow/현장 실사를 생략하거나 제한할 수 있는 crypto systematic allocator다. 그런 실제 구매자가 이 제품을 채택하는지는 **[미확인]**이다.

## 2. 성과 표시의 기준

**[사실]** CFA Institute의 2020 GIPS Standards for Firms는 거래비용 공제(2.A.13), 순수익률에서 운용보수 반영(2.A.38), 외부 현금흐름을 조정하는 수익률 계산(2.A.24), 실제 자산이 없는 theoretical performance의 구분 및 가정/비용 표시(4.C.48 등)를 요구한다. 3.A.9는 운용 중단된 portfolio를 해당 기간의 과거 성과에 포함하도록 요구한다. 이 요건들은 GIPS 적용 회사에 대한 기준이며, 이번 제품이 자동으로 GIPS를 준수한다는 뜻은 아니다. [공식 표준 PDF](https://www.gipsstandards.org/wp-content/uploads/2021/03/2020_gips_standards_firms.pdf), [공식 안내](https://www.gipsstandards.org/standards/gips-standards-for-firms/).

**[추론]** 제품에는 최소한 다음 서로 다른 수열이 필요하다.

1. **Target/model return:** 사전에 고정한 모델 가격·비용·체결 규칙으로 목표 포지션의 수익률을 계산. 실제 fill이 아니며, forward라도 paper다.
2. **Strategy sleeve/vault return:** 실제 잔고·주문·부분체결·fee·funding·입출금을 대사한 cash-flow-adjusted return. 제작자의 실제 거래 계좌와 buyer 계좌가 다르면 별도 수열이다.
3. **Investor return:** 투자 시점, 자금 흐름, 수수료가 반영된 각 투자자의 실현 경험. 전략 비교용 TWR과 투자자 경험을 나타내는 MWR/IRR을 혼동하지 않는다.

**[추론]** Sharpe와 correlation의 입력은 임의로 고른 profitable trades가 아니라 동일한 달력·통화·평가 시점의 전체 수익률이어야 한다. No-trade 구간에도 보유 포지션은 움직인다. Missed decision을 0% return으로 대체해서는 안 된다. Gap과 손실 구간을 삭제하지 않고, 입금이 수익으로 보이지 않게 해야 한다.

## 3. 무엇을 검증해도 alpha가 입증되지 않는 이유

**[사실]** Bailey, Borwein, López de Prado, Zhu의 *The Probability of Backtest Overfitting* (2015 개정본)은 투자 backtest에서 여러 대안의 탐색과 최적화가 false positive를 만드는 문제를 다루며, CSCV/PBO를 제시한다. 초록과 pp. 3–4를 확인했다. [저자 제공 원문](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

**[사실]** Bailey와 López de Prado의 *The Deflated Sharpe Ratio* (2014)는 multiple testing에 따른 selection bias와 non-normal returns에 따른 성과 과장을 다룬다. 초록과 pp. 3–4는 보고되지 않은 시도, file drawer effect, survivorship/backfilling을 설명한다. [저자 제공 원문](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).

**[추론]** 과거 데이터에서 정확히 실행됐다는 proof는 미래 alpha의 통계적 증거와 다르다. 한 artifact의 모든 epoch를 기록해도 제작자가 다른 계정/플랫폼에서 실패한 전략 999개를 숨기고 1개를 등록했는지는 알 수 없다. 사전 등록과 전 버전·중단 이력 공개는 플랫폼 안의 선택 편향을 줄일 수 있지만, 플랫폼 밖 연구 이력을 완전하게 증명하지 못한다. “모든 탐색 횟수가 증명된 DSR”도 연구 전체의 모집단이 신뢰할 수 있게 정의돼야 성립한다.

## 4. 코드 없이 비교할 수 있는 범위

**[추론: 수학적 예시]** 기존 portfolio와 후보가 각각 변동성 10%, 기대수익률이 같다고 가정한다. 50:50로 섞으면 변동성은 `sqrt(0.25σp² + 0.25σs² + 0.5ρσpσs)`이다. 상관계수 0.9인 후보는 약 9.75%, 0.1인 후보는 약 7.42%다. 같은 standalone 수익률이라도 marginal diversification value가 다르다. 이 값은 가정에 따른 예시이며 실제 자산 결과가 아니다.

**[추론]** 선택 기준은 standalone Sharpe 순위보다 순수익, drawdown 회복 시간, tail loss, downside correlation, BTC/ETH 및 기존 portfolio beta, turnover/capacity, leverage와 담보 위험, 자산·venue 집중, strategy/version age, 운용 중단 및 제작자 이력을 함께 보는 것이 자연스럽다. 과거 상관계수는 미래 분산효과의 보증이 아니다. 짧은 기간, stale marks, 비동시 평가, serial correlation 및 시장 regime 변화의 영향을 점검해야 한다.

**[추론]** 세 가지 분석을 분리한다.

- **Returns-based:** 같은 달력의 전체 net return stream으로 rolling/downside correlation과 요인 회귀를 계산. 코드는 필요 없다. 결과는 선택한 표본과 factor model에 조건부다.
- **Holdings-based:** 검증된 포지션으로 순/총 exposure, concentration, venue/collateral/liquidity 위험을 계산. 공개 지연이나 NDA 접근을 사용할 수 있다. Position 없이 returns만 보면 아직 실현되지 않은 비선형/꼬리 위험을 완전히 파악할 수 없다.
- **Policy-based:** 공개 risk envelope에 universe, allowed instruments, leverage, order budget, max position 등을 정하고 실행 권한에서 강제. 이는 미래 최대손실·MDD 상한을 보증하지 않는다. 가격 급변·유동성·체결 실패가 남는다.

## 5. Privacy-preserving DD는 무엇까지 가능한가

다음은 **[설계 추론]**이며 이번 조사에서 작동하는 완성 제품이나 proof benchmark로 실증하지 않았다.

- 공개 verifier program은 commitment로 고정한 전체 return/holdings history에서 max drawdown, turnover, exposure bound, 고정 factor와의 covariance 등을 올바르게 계산했다는 관계를 증명할 수 있다. 기록의 기간·빈도·결측 정책·평가통화·fee 정의까지 고정해야 한다.
- 수학적으로 correlation에는 `n, Σx, Σy, Σx², Σy², Σxy`가 필요하다. 이들을 fixed-point로 계산하고 tolerance/zero variance/overflow를 정의한 뒤, 정확한 값을 공개하거나 임계조건만 공개할 수 있다. Merkle root만 등록해도 그 leaf가 진짜 계좌 기록이라는 사실은 생기지 않는다.
- Seller의 returns와 buyer의 portfolio가 모두 비공개이고 어느 쪽도 상대 입력을 보지 않아야 한다면 단독 ZK proof만으로 공동 계산이 생기지는 않는다. 상호 신뢰한 분석자, TEE 또는 MPC를 추가해야 한다. 양쪽의 입력 또는 secret shares와 공동 계산 protocol이 필요하며, MPC에서는 단일 주체가 원문 전체를 보유할 필요는 없다.
- 질의를 무제한 허용하면 비밀성이 약해진다. 예를 들어 buyer가 임의의 basis-vector portfolio들을 질의할 수 있으면 inner-product/correlation 응답들로 수익률 경로를 복원할 단서를 얻는다. 고정 factor library, 최소 기간, coarse output, query budget, 지연 공개는 완화책이지만 완전한 비밀성 증명이 아니다.
- Returns/exposure fingerprint의 유사성은 관측한 경제적 행동의 유사성이다. 코드 복제, 아이디어 독창성, 알려지지 않은 모든 전략과의 차별성은 입증하지 못한다. 과거에는 같고 다음 epoch부터 다른 두 프로그램을 만드는 것이 가능하므로 finite replay도 미래의 동일 행동을 입증하지 못한다.

**제품 판단 [추론]:** “독창성 증명”을 제거해도 자본 배분 상품은 가능하다. 다른 전략과 겹쳐도 비용·용량·리스크·운영 안정성으로 가치가 생길 수 있다. 반면 buyer가 충분한 returns, exposure/risk disclosure, 운용 provenance를 전혀 얻을 수 없다면 target allocator에 대한 투자 판단 근거가 무너지므로 제품에 치명적이다.

## 6. Unit economics: 측정치가 아닌 민감도 분석

**[가정]** 거래·운영비 공제 후이되 성과보수 차감 전 연간 성과 10%, 그 양의 성과에 대한 수수료 20%, 관리보수 0%, HWM을 넘는 한 해이며 creator/platform의 분배 전이라고 하자. 단순 연간 수익은 `AUM × 10% × 20% = AUM × 2%`다.

| 자본 | 연간 성과보수 풀 | 해석 |
|---:|---:|---|
| $10,000 | $200 | 개별 맞춤 DD·지원·운용을 부담하기 어려운 규모라는 가설 |
| $100,000 | $2,000 | pooled scale/자동화가 없으면 비용 압박 가능 |
| $250,000 | $5,000 | 제한된 운영을 실험할 후보, 사업성 입증은 아님 |
| $1,000,000 | $20,000 | 전문 운용·보안·법무 및 creator/platform 몫을 고려하면 여전히 얇음 |
| $5,000,000 | $100,000 | 단일 strategy sleeve 단위의 비용 검증 후보 |

부진한 해에는 이 구조의 성과보수가 0일 수 있다. 위 예시는 Darwinex의 실제 요금표를 재현한 것이 아니며, profitability나 capacity를 가정한 계산이다.

**[가정]** proof 한 건이 $0.01 / $0.10 / $1이라면 매시간 1개 stream의 연비용은 8,760회를 기준으로 $87.60 / $876 / $8,760이다. 일 1회면 $3.65 / $36.50 / $365다. 이 proof 가격은 **실측도 견적도 아니다**. 실제 cost에는 proving hardware/cloud, verification/gas, market data, execution, custody, support, onboarding 및 감사가 추가된다.

**[추론]** `annual contribution = AUM × (management fee + positive net return × performance fee) × platform share − attributable recurring costs`를 고객별로 검증해야 한다. 공통 signal proof는 많은 subscriber에게 나눌 수 있지만, 실제 fill·잔고·입출금에 결박된 vault transition proof는 vault/state가 다르면 자동으로 공유되지 않는다. pooled vault는 이를 줄이지만 자본의 custody·accounting·정산 책임을 갖게 된다. Proof를 싸게 만들었다는 사실만으로 단위경제가 성립하지 않는다.

## Evidence boundaries

- 유료 고객 인터뷰, signed LOI, 독립 감사된 AUM 자료는 이번 조사에 없다.
- Backtest overfitting 논문은 문제의 존재와 방법론을 보여 주며, 이 제품의 전략들이 반드시 실패한다는 증거는 아니다.
- GIPS/AIMA는 DD 기준에 대한 근거이지, 임의의 소형 crypto vault에 동일한 법적 의무가 적용된다는 진술이 아니다.
- SEC FAQ는 HTTP 403으로 열람하지 못했고, QuantConnect portfolio-analysis 예상 경로와 Darwinex correlation 예상 경로는 유효 본문을 받지 못했다. 이 실패한 페이지는 주장 근거로 사용하지 않았다. Darwinex의 실제 correlation 문서는 별도 [공식 경로](https://help.darwinex.com/correlation-between-darwins)에서 확인했다.
- 원문 파일과 텍스트 추출본: `research/sources/`. 원문 PDF 일부 해당 페이지의 시각 검토도 수행했다. 소스별 fetch 결과는 `root-fetch.json`에 보관했다.
