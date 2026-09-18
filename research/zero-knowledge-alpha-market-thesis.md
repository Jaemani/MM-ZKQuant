# Zero-Knowledge Alpha Market — Product / Technical Thesis Validation

조사일: **2026-09-16**. 공개 상품·공식 문서·공개 코드와 제한된 adapter replay를 조사했다. 고객 인터뷰, 실제 자금 운용, zkVM proving benchmark는 수행하지 않았다. **[사실]**은 확인한 자료·실험 결과, **[추론]**은 그 근거에 대한 판단, **[미확인]**은 남은 가정, **[제안]**은 검증할 설계·의사결정 기준이다. 업체의 지급액 발표는 독립 감사와 구분한다.

## 1. 한 문장으로 수정된 product thesis

**코드를 공개하지 않는 저·중빈도 crypto systematic 운용자가, 사전 등록한 제한된 전략 버전의 결정·누락·실제 체결 이력을 검증 가능하게 제공하고, 전문 allocator에게 정해진 위험 범위의 자본 운용 mandate를 공급하는 서비스다.**

이는 **검증할 수정 가설 [추론]**이다. 판매 대상은 코드의 소유권이나 “증명된 alpha”가 아니라 **정해진 조건의 운용과 그 자본에 대한 경제적 지분**이다. ZK는 이 계약에서 계산 무결성을 검증하는 선택지다. 수익성·독창성·무중단 운용을 보장하지 않는다. 비공개 운용과 보수의 인접 선례는 [Darwinex](https://help.darwinex.com/what-is-a-darwin), 코드 대신 신호 기여도를 받는 선례는 [Numerai Signals](https://docs.numer.ai/numerai-signals/signals-overview)에 있다.

## 2. 정확한 seller / buyer / transaction 정의

### 후보 모델 비교

다음 표는 **[구조 분석]**이다. 실제 상품의 확인 범위는 4절에 구분했다.

| 모델 | Buyer와 실제 수령물 | Creator의 경제적 권리 | 전략 secrecy | 실행 책임 | 수익률 차이 attribution |
|---|---|---|---|---|---|
| **1. Code / license** | 개발팀·prop·자체 운영 가능한 trader가 소스와 계약상 사용권 수령 | 일시금, 기간 사용료, 독점/재판매 제한 | 공개 대중에게는 숨길 수 있으나 **소스를 받는 buyer에게는 비밀이 아님** | Buyer가 데이터·runtime·위험관리·체결 | 버전·설정·입력·주문·fill을 확보하면 단계별 분해 가능. 코드 일치만으로 P&L 일치 불가 |
| **2. Signal subscription** | 개인 또는 전문팀이 timestamped signal/target·expiry 수령 | 구독료, 데이터 사용료, 정의한 품질/기여도 보상 | 코드 비공개 가능. 출력은 구매자에게 노출·복제 가능 | Creator가 signal 생성/제출, buyer나 broker가 sizing·execution | Model signal return과 buyer별 실제 수익률을 분리. 지연·fee tier·사이징·fill 차이 남음 |
| **3. Black-box executable** | 운영팀이 binary/container 또는 실행 API 사용권 수령 | 설치·호출·기간 라이선스 | 일반 buyer host의 바이너리는 역분석 방어가 별도. Hosted/TEE도 운영·하드웨어 신뢰 필요 | 배포형 buyer, 호스팅형 공급자/플랫폼 | Runtime·state·입출력을 고정해야 분해 가능. 소스 미제공 자체는 실행동등성 보장이 아님 |
| **4. Managed mandate / vault** | Allocator가 특정 sleeve의 NAV 지분 또는 운용 계좌 수익에 대한 권리 수령 | 관리보수/성과보수 및 약정한 운용 권한; IP는 creator에 남음 | 코드 비공개 가능. 거래·포지션·상태 공개 범위는 별도 | Creator 결정, executor 주문, vault/custodian 자금 통제, venue 체결 | 같은 vault NAV를 공유하므로 복제 계좌 차이가 줄어듦. 입출금·fees·risk override·실행손실은 별도 기록 |
| **5. B2B signal contribution** | Fund/prop이 자기 포트폴리오에 넣을 prediction/target stream 수령 | 고정료 또는 buyer 기준 한계기여도 보상 | 모델·원천 데이터는 creator에 남을 수 있음 | Buyer가 혼합·중립화·위험관리·체결 | Standalone 전략 P&L 대신 기존 signal 대비 marginal contribution을 계약. Numerai가 인접 사례 |

**[판단] 4번을 주상품으로 선택한다.** Seller는 “private decision artifact와 운용 가용성을 공급하는 strategy operator”, buyer는 **소규모 시험 배정을 할 권한과 crypto 운용 경험이 있는 전문 allocator**, transaction은 **버전·위험·출금·장애 조건을 명시한 운용 위임 + NAV 지분 + 보수**다. Vault는 이 관계의 기술적 구현 중 하나이며, pooled fund와 별도 계좌 mandate의 법적 구조가 같다는 뜻은 아니다.

거래 계약에는 다음을 포함해야 한다 **[제안]**.

- 자산/venue, 거래 빈도, version commitment, input source, 공개 risk envelope, execution policy.
- 보수 기준: realized/MTM NAV, 비용 공제, high-water mark, 입출금 시 fee equalization/share class 처리, platform/creator 몫.
- 역할: creator에게 전략 결정 권한을 주되 임의 인출 권한과 구분. Executor의 정책상 override는 별도 기록.
- 중단/upgrade/출금권, 비밀정보 접근 주체, outage 시 emergency policy, 과거 이력 보존.

이 구조는 [Hyperliquid vault의 이익·손실 지분](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-depositors-legacy), [Darwinex의 보수](https://help.darwinex.com/performance-fees-darwin-provider), [Chamber의 vault-level fee accounting](https://docs.chamberfi.com/manage/fees-performance)과 맞닿는다. **“전략 NFT를 사면 미래 수익에 대한 권리가 생긴다”는 구조는 근거 없이 도입하지 않는다.**

**[추론]** 실행·custody를 직접 보유한 prop은 5번이 더 자연스러울 수 있다. 그러나 4번의 기록과 5번의 subscriber 체결을 하나의 수익률로 표시해서는 안 된다. 둘을 동시에 출시하면 검증할 거래 단위가 흐려진다.

## 3. 가장 치명적인 가정 5개

1. **지불 의사:** 충분한 자본과 예산을 가진 buyer가 비공개 전략 운용을 원하며, 기존 trusted execution보다 이 서비스의 검증 기능을 선택한다.
2. **Due diligence:** 코드 비공개를 유지하면서도 buyer가 위험·분산효과·capacity·운영 신뢰를 판단할 충분한 정보를 받을 수 있다.
3. **전략 공급과 migration:** 가치 있는 creator가 제한 artifact로 이식하고, 의미 변화와 새 canonical version 등록을 수용한다.
4. **운용 완결성:** 인증된 입력, 빠짐없는 예정 epoch 기록, 실제 fill, 다음 state, outage/upgrade 처리가 하나의 일관된 이력으로 연결된다.
5. **ZK의 차별성과 경제성:** ZK가 제거하는 특정 trust가 고객에게 중요하고, proving 지연·비용·비밀성·운영비를 감당할 수 있다.

이 중 하나라도 필수 고객에게 성립하지 않으면 “ZK private-strategy marketplace” 전체를 추진할 근거가 사라진다. 어떤 가정이 틀렸는지에 따라 운용 서비스·signal 계약·검증 도구로의 전환과 사업 중단을 구분해야 한다.

## 4. 각 가정의 supporting / contradicting evidence

### 가정 1: 실제 유료 수요와 고객군

**Supporting [사실]:** Darwinex는 거래 세부를 숨긴 복제 운용을 설명하며, creator에게 **누적 $5M 초과 성과보수 지급**을 자체 발표했다. 조회한 투자 조건은 최소 200 EUR/USD/GBP, 관리보수 연 1.2%, 성과보수 20%이며 그중 15%는 provider, 5%는 플랫폼이다. 관할/상품별 적용 범위가 다르다. 따라서 **“opaque 전략에는 아무도 돈을 내지 않는다”는 일반 명제는 기각**된다. 지급 총액을 감사하거나 현재 연 매출로 환산하지 않았다. [제품](https://help.darwinex.com/what-is-a-darwin), [지급 발표](https://help.darwinex.com/performance-fees-darwin-provider), [투자 조건](https://help.darwinex.com/investments-costs).

**Contradicting / 제한 [사실]:** eToro CopyTrader는 최소 $200로 타인의 포지션을 복제하지만 **copy 기능 추가료가 없다**. 거래비용은 별도다. 그러므로 retail의 위임 행동을 유료 private quant subscription 또는 ZK premium 수요로 셀 수 없다. [eToro](https://www.etoro.com/copytrader/).

| 실제 사례 | 확인한 transaction / 행동의 근거 | 이 thesis에 대한 의미와 한계 |
|---|---|---|
| **Darwinex / DARWIN** | Private replication + 독립 risk sizing + 투자자 보수 + provider 지급 자체 발표 | 가장 직접적인 인접 유료 선례. 돈을 받는 핵심이 ZK라는 근거는 없음 |
| **eToro CopyTrader** | 개인의 자본 배정·비례 복제, 무료 copy 기능 | Retail 위임은 존재. 별도 검증료 수요·성과동일성은 입증 못함 |
| **Numerai Signals** | 코드는 보지 않고 prediction만 받음. NMR stake에 따른 earn/burn | Buyer의 기존 신호 대비 기여도를 공급하는 모델. Fund 지분/수수료 청구권 판매와 다름. [공식 안내](https://docs.numer.ai/numerai-signals/signals-overview) |
| **Hyperliquid vaults** | 자본 pool의 P&L shares, positions/trades/metrics 공개. Legacy user vault leader profit share 10% | NAV 단위 attribution의 선례. 현재 공식 docs는 HyperCore user vault를 legacy로 구분하므로 최신 HyperEVM 전체에 이 요율을 일반화하지 않음. [vaults](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults), [leaders](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders-legacy) |
| **dHEDGE → Chamber** | Onchain manager guards, fee/HWM/share accounting | 공식적으로 같은 core contracts·기존 vault를 유지하는 rebrand. 사업 중단 증거가 아님. [rebrand](https://docs.chamberfi.com/introduction/dhedge-to-chamber), [fees](https://docs.chamberfi.com/manage/fees-performance) |
| **Enzyme** | Vault ownership와 configurable fee infrastructure | 운용 인프라의 존재를 확인. 그 전체 자산을 private quant 수요로 집계할 근거 없음. [ownership](https://docs.enzyme.finance/user-documentation/blue-enzyme-vaults/editor/ownership), [fee](https://docs.enzyme.finance/user-documentation/blue-enzyme-vaults/editor/fee) |
| **Collective2** | 현행 QuantConnect 공식 integration에서 전략 signal/portfolio target 전송 확인 | 개발자–allocator 연결의 선례. 본체 페이지 접근 제한으로 현재 가격·구독자·지급 규모 미확인. [통합 문서](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/signal-exports/collective2) |
| **QuantConnect Alpha Streams** | 공식 repository의 hosted alpha licensing·out-of-sample 검증 문서 | 역사적 선례만 인정. 현행 과거 URL 불능과 SDK 정리만으로 종료 원인/사업 실패를 단정하지 않음. [공식 설계](https://github.com/QuantConnect/Documentation/blob/master/Resources/landing-page-introductions/alpha-streams-market.html), [2022 SDK 정리 PR](https://github.com/QuantConnect/Lean/pull/6638) |

**고객 판정 [추론]:** 초기에는 대중 retail보다 **crypto systematic sleeve에 시험 자본을 배정할 수 있는 small fund/전문 allocator**가 적절한 후보이다. Prop은 signal licensing 쪽 가능성이 높다. Family office라는 명칭만으로 적합 고객이 되는 것은 아니다. Crypto mandate, 내부 DD 능력, 예산·배정 권한을 확인해야 한다. “기관이면 source 없이 투자한다”는 주장도 아직 **[미확인]**이다.

**자본·보수의 의미 [가정 계산]:** 관리보수 없이, 거래·운영비 공제 후이되 성과보수 차감 전의 HWM 초과 연 수익이 10%이고 성과보수가 20%라면 연 보수 풀은 AUM의 2%다. $10k → $200, $100k → $2k, $1m → $20k, $5m → $100k다. 여기서 creator/platform 몫과 운영비가 나뉜다. 부진한 해에는 성과보수가 0일 수 있다. 실제 예상 수익률이나 업계 표준이 아니라 작은 자본의 비용 민감도를 보여 주는 예시다. 작은 retail account들을 pooled 운영하면 다른 경제성이 가능하지만 고객 확보·지원·pool accounting이 추가된다.

**판정:** 인접 수요는 지지됨. **이 상품의 유료 수요와 목표 고객군은 미검증.**

### 가정 2: 코드 없는 due diligence

**Supporting [사실]:** [Darwinex](https://help.darwinex.com/correlation-between-darwins)는 return-series correlation matrix를 제공한다. [Numerai](https://docs.numer.ai/numerai-signals/scoring)는 기존 Barra/country/sector/custom signal과 겹치는 부분을 neutralize해 추가 성분을 평가한다. 소스코드 없이 경제적 중복을 평가하는 실제 구조다.

**Contradicting [사실]:** Darwinex는 정보를 지나치게 숨기면 투자자가 투자하지 않을 수 있다고 [명시](https://help.darwinex.com/3-levels-protect-intellectual-property)한다. [AIMA DDQ 안내](https://www.aima.org/sound-practices/due-diligence-questionnaires.html)는 실사를 단순 성과표가 아니라 governance·operations·risk management와 교차 확인의 과정으로 설명한다.

**판정 [추론]:** Code secrecy는 가능하다. **경제적·운영적 완전 불투명성은 기각.** 미래 tail risk와 모든 전략 대비 독창성은 미확인/비보장으로 남겨야 한다.

### 가정 3: 현실적인 adapter와 공급

**Supporting [사실]:** 5절 실험에서 공개 Freqtrade 두 신호 kernel을 deterministic streaming integer 연산으로 이식했다. 각 원래 timeframe의 실제 historical candles에서 signal mismatch는 0이었다. LEAN·Hummingbot에도 명시적 alpha/target/executor 경계가 있다.

**Contradicting [실험 사실]:** 1e-8 크기의 가격 변화 fixture에서는 같은 두 구현이 다른 결정을 냈다. 원본 전략의 ROI·stoploss·trailing·sizing·fill 처리는 이 kernel 실험에 포함되지 않았다. Python 전체 환경과 ZK execution을 실증한 것도 아니다.

**추가 미확인:** 공개 교육용 코드가 private alpha creator의 실제 코드 분포를 대표하는가, creator가 rewrite/새 track record를 수용하는가, 가치 있는 전략의 capacity가 비용을 감당하는가는 확인하지 못했다.

**판정:** **제한된 migration assistant/SDK는 지지. 원본 전략의 의미가 자동 보존되는 범용 adapter는 기각.**

### 가정 4: selective execution과 실제 운용의 연결

**Supporting [사실/설계 추론]:** zkVM receipt는 지정 program ID의 실행과 공개 output을 검증하는 구조다. Epoch·predecessor·input root·state·account를 명제에 결박하면 다른 버전/상태/epoch의 증명 사용을 거부할 수 있다. [RISC Zero receipts](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/receipts.md).

**Contradicting [논리적 한계]:** Creator가 secret과 state를 독점한 채 서버를 끄면 proof는 나오지 않는다. Mandatory epoch는 누락을 관찰 가능하게 할 뿐 강제 실행하지 못한다. 유효 proof가 있어도 venue가 체결하지 않을 수 있다. CEX API의 client request signature는 exchange가 서명한 fill 증명이 아니다. [Binance execution events](https://github.com/binance/binance-spot-api-docs/blob/b8a0f61e088c65d18a157f2e11a8e273826b6c08/user-data-stream.md), [request security](https://github.com/binance/binance-spot-api-docs/blob/b8a0f61e088c65d18a157f2e11a8e273826b6c08/rest-api.md#request-security).

**판정:** **“전 scheduled epoch가 성공·HOLD·누락·실행 실패 중 하나로 남는다”는 설계는 가능. “모든 scheduled strategy decision이 반드시 실행된다”는 보장은 기각.**

### 가정 5: ZK의 필요성과 원가

**Supporting [사실/추론]:** 올바른 관계와 proof mode를 쓰면 creator가 제출한 output이 등록 artifact의 계산 결과인지 제3자가 독립 확인할 수 있다. 코드와 계산의 정직성을 단일 운영자에게 맡기지 않으려는 계약에서는 의미가 있다. [RISC Zero](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/receipts.md), [SP1 security model](https://docs.succinct.xyz/docs/sp1/security/security-model).

**Contradicting [사실]:** SP1은 개별 STARK proofs가 현재 ZK가 아니며 Groth16/PLONK wrapper와 구분한다고 명시한다. 일반 외부 prover는 secret witness를 볼 수 있다. Trusted risk engine·audited execution·onchain guards도 이미 대안이다. [SP1](https://docs.succinct.xyz/docs/sp1/security/security-model), [RISC Zero security](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/security-model.md), [Darwinex risk engine](https://help.darwinex.com/risk-manager).

**미확인:** 선정 artifact의 실제 proving cost/P99 latency, verifier 비용, confidential proving 배치, 유료 고객의 ZK 필요성. 다른 vendor의 benchmark 숫자를 이 전략의 성능처럼 쓰지 않았다.

**판정:** **ZK는 조건부 기술 후보. Product necessity는 입증되지 않았다.**

## 5. Adapter 실증 결과

### Framework별 실제 abstraction boundary

| Framework | 코드에서 확인할 분리 지점 | 보존해야 하는 나머지 의미 |
|---|---|---|
| **Freqtrade** | `populate_indicators → populate_entry_trend / populate_exit_trend → bot sizing/order` | Config overrides, informative pairs/data provider, custom callbacks, ROI/stoploss/trailing, startup candles. Signal flag와 실제 order는 다름. [공식 customization](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-customization.md), [callbacks](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-callbacks.md) |
| **Hummingbot V2** | MarketDataProvider / controller의 processed data → `ExecutorAction` → executor lifecycle | Connector 가격·잔고·funding, async lifecycle, budget checker, order book, fills. 단순 controller 판단과 완전 전략은 별개. [공식 controller 문서](https://github.com/hummingbot/hummingbot-site/blob/f1108de3d352733936fc400e177021f81939eecc/docs/strategies/v2-strategies/controllers/index.md) |
| **QuantConnect / LEAN** | Universe → Alpha `Insight` → Portfolio `PortfolioTarget` → Risk → Execution | `QCAlgorithm`의 임의 이벤트 handler는 이 경계를 우회할 수 있음. History/custom data, scheduled events, holdings/order events, brokerage reality model도 고정해야 함. [Framework](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview) |
| **TradingView / Pine** | Series/indicator 계산 → `strategy.entry/order/exit` → TradingView broker emulator / alerts → 외부 execution | `barstate`, realtime/intrabar 계산, `request.*`, HTF lookahead, series indexing와 fill timing. Pine 런타임 자체가 proof guest가 되는 공식 경로를 확인하지 못함. [Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/), [other timeframes/data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/) |

### 직접 실행한 범위

**[실험 사실]** 두 공개 strategy에서 **수정하지 않은 method body 6개**와 crossover helper 2개를 추출해 pandas/TA-Lib로 실행했다. Framework class wiring과 parameter 객체는 최소 harness로 대체했다. 이를 `10^-8` 정밀도, 나눗셈마다 floor하는 streaming integer 참조 구현과 비교했다. **완전한 Freqtrade 실행 0건, 실제 fill 0건, zkVM proof 0건**이다.

| 공개 원본 / dataset | 원본 signal flags | Historical mismatch | 지표 숫자 최대 차이 |
|---|---:|---:|---:|
| [`AverageStrategy`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/berlinguyinca/AverageStrategy.py#L38), BTCUSDT **4h, 2024년 전체 2,196개 candle**, EMA 8/21 | Entry 41 / exit 41 | **0 candle / 0 flag** | EMA 약 `7.03×10^-8` 이하 |
| [`TrendFollowingStrategy`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/futures/TrendFollowingStrategy.py#L27), BTCUSDT **5m, 2024년 1월 8,928개 candle**, EMA20+OBV | Long entry 682 / short entry 682 / exit flags 0 | **0 candle / 0 flag** | EMA 약 `7.22×10^-8`, OBV 약 `2.55×10^-11` |

위 entry 수는 **체결 횟수·수익성·full strategy의 short 운용 가능성을 뜻하지 않는다**. 원본 설정과 engine은 ROI/stoploss 등으로 별도 청산할 수 있다. 실제 데이터는 Binance 공개 historical archive이며 생산 oracle의 무신뢰 인증을 실증한 것이 아니다. 코드 commit과 데이터 checksum, 환경 버전, 전체 mismatch를 [adapter-evidence.md](adapter-evidence.md), [결과 JSON](adapter/results.json), [실행 코드](adapter/replay.py)에 보관했다.

**결정적 반례 [실험 사실]:** 가격 100이 유지되다가 100.00000001로 움직이는 40-candle fixture에서 Average는 **2개 decision**, Trend는 **1개 decision**이 달랐다. Average에서는 EMA8/21 사이, Trend에서는 close/EMA20 사이의 미세한 차이가 floor 연산에서 사라져 결정이 달라졌다. 최소 가격 fixture에서도 불일치가 있었다. Missing/duplicate candle, NaN, 과도한 소수 정밀도, 음수 volume은 canonical input validator가 거부했다.

**해석 [추론]:** 관측된 historical signal match는 port의 유용한 regression evidence다. 보편적 semantic equivalence, 주문/체결/P&L equivalence, 증명 비용의 증거가 아니다. 이 실험은 “자동 이식 후 원본과 같은 전략이라고 홍보”하는 경로를 오히려 반박한다.

### 전략군별 migration 범위

아래는 공개 sample의 code inspection과 위 제한 실험에 따른 **[평가]**다. 전체 실행을 하지 않은 항목을 실증 완료로 세지 않는다. 정확한 sample별 pinned URL·함수·분류는 [adapter evidence](adapter-evidence.md)에 있다.

| 전략군 | 초기 proof artifact로의 평가 | 조건 / 실제로 남는 rewrite |
|---|---|---|
| OHLCV indicator | **신호 logic는 약간 수정**, full bot는 상당한 작업 | 실증은 EMA/OBV kernel에 한정. RSI 등 추가 indicator는 seed·warmup·NaN·rounding·threshold를 별도 검증 |
| Momentum / trend | **약간 수정 가능**, universe/portfolio까지 있으면 확대 | Fixed assets, closed bars, bounded windows, deterministic target으로 제한. Freqtrade trend 및 [LEAN EmaCrossAlphaModel](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Framework/Alphas/EmaCrossAlphaModel.py#L36) |
| Fixed-weight / scheduled rebalance | **판단 logic는 거의 그대로**, 구현 언어·state 연결은 수정 | [LEAN EqualWeighting model](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Framework/Portfolio/EqualWeightingPortfolioConstructionModel.py#L44)의 weight 산출은 작음. Schedule, active insight expiry, 잔고·입출금·rounding·order sizing은 별도 |
| Funding-based | **상당한 rewrite** | Rate observation vs 실제 funding 지급, 양 거래소 hedge·basis·margin·partial fills·정산 데이터가 필요. [Hummingbot funding sample](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/scripts/v2_funding_rate_arb.py#L175) |
| Stat-arb | **단순 fixed-window pair signal은 이식 후보**, full 운용은 상당한 rewrite | [Hummingbot stat_arb](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/controllers/generic/stat_arb.py#L241)는 positions/PnL/executors까지 참조. Feed 정렬, hedge 계산, borrow/funding, leg risk·fill 처리 필요 |
| Proprietary data | **데이터 계약 없으면 초기 지원 불가** | Point-in-time provenance, 공개 가능 범위·사용권·서명/attestation 필요. Private witness 자체는 출처 증명 아님 |
| External HTTP | **I/O를 인증 snapshot으로 재설계** | [LEAN CustomDataBitcoin](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Python/CustomDataBitcoinAlgorithm.py#L54)은 live HTTP/backtest CSV가 다름. 응답·cutoff·schema 인증 필요 |
| ML model | **작은 고정 inference는 후보; 일반 FreqAI pipeline은 상당한 rewrite** | [FreqaiExampleStrategy](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/freqtrade/templates/FreqaiExampleStrategy.py#L225)의 학습/feature/model version을 분리. Frozen quantized inference만 후속 후보 |
| Order-book market making | **전체 전략은 상당한 rewrite; 최초 scope 제외** | [Hummingbot simple_pmm](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/scripts/simple_pmm.py#L50)도 cancel·budget·fill state에 의존. Snapshot 간소화는 새 전략이지 원본 보존이 아님 |
| HFT | **초기 제약에서는 사실상 불가능/비대상** | Event/latency/fill feedback과 proof-before-trade를 동시에 맞췄다는 근거 없음. 암호학적으로 영원히 불가능하다는 뜻은 아님. [HftBacktest fill 모델](https://github.com/nkaz001/hftbacktest/blob/master/docs/order_fill.rst), [latency 모델](https://github.com/nkaz001/hftbacktest/blob/master/docs/latency_models.rst) |

공개 sample에서 “거의 그대로”라고 평가할 수 있는 것은 **작은 pure decision logic**다. 어떤 완전한 Python 전략을 그대로 zkVM에서 실행했다고 결론 내리지 않았다.

### 반드시 분리할 네 보장

1. **기존 Python 그대로 proof 환경에서 실행:** CPython, pandas/NumPy/TA-Lib native extension, OS/I/O·floating point까지 같은 환경인지 검증해야 한다. RISC-V 지원은 이 전체 stack의 drop-in 지원이 아니다. 이번 조사에서는 **실증하지 못했다**. 원리적 불가능으로 단정하지 않는다. [RISC Zero spec](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/zkvm-specification.md), [SP1](https://docs.succinct.xyz/docs/sp1/introduction).
2. **Logic를 proof-compatible artifact로 port:** 가능성이 확인된 범위는 bounded arithmetic·fixed input schema·deterministic state의 작은 kernel이다. 이번에는 host 정수 참조 구현만 작성했으며 compiled zk guest와 proof는 미수행이다. Indicator와 execution semantics가 바뀔 수 있다.
3. **Historical replay로 비교:** 같은 입력에서 관측한 동작의 유사성/차이를 측정한다. P&L만 비슷한 것으로 통과시키지 않고 indicator→signal→target→order 단계별로 비교해야 한다. 유한 표본은 미래 동등성을 보장하지 않는다.
4. **Adapted artifact를 새 canonical strategy로 등록:** 이후 proof가 보장하는 것은 **이 새 artifact**의 실행이다. 원본 전략의 live history를 새 버전의 live 실적으로 자동 승계하지 않는다. 원본과 port 사이의 변경 명세·replay report·새 forward segment를 제공한다.

**Adapter 결론:** **“자동 변환기”보다 지원 연산·입력·state를 제한한 SDK + migration assistant + 차이 보고서 + 새 등록**이 현실적이다.

## 6. Due-diligence 문제와 가능한 해결 범위

### Buyer에게 필요한 최소 정보

다음은 **[제품 제안]**이다. 실제 [Darwinex selection criteria](https://help.darwinex.com/select-darwins-for-investing), [vault depositor metrics](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-depositors-legacy), [GIPS 표준](https://www.gipsstandards.org/wp-content/uploads/2021/03/2020_gips_standards_firms.pdf)을 참고하되 GIPS 인증을 주장하지 않는다.

| 정보 | 고정해야 할 정의 / buyer가 판단할 범위 |
|---|---|
| **Return** | 전체 calendar의 net-of-cost return stream, 기준통화·mark 시점·입출금 조정. Model, 실제 vault, 개별 investor return을 구분 |
| **MDD** | Depth와 duration/recovery, 미실현 손실 포함. 과거 MDD는 미래 손실 상한이 아님 |
| **Volatility / Sharpe / Sortino** | Return 빈도, annualization, risk-free/target, 비용, sample length, zero variance/NA 규칙. 짧은 표본의 추정 불확실성 표시 |
| **Turnover / capacity** | Gross traded notional의 정의, 거래비용·slippage 민감도, 운용 자본, 시장 유동성 대비 participation |
| **Leverage / exposures** | Gross/net exposure, margin·담보·venue·asset 집중, 허용 instruments와 실제 포지션/지연 exposure |
| **Asset universe** | 자산/venue 목록·변경 규칙. 파생상품 여부, funding·borrow·liquidation 위험 |
| **Age / record provenance** | 원본 연구 시작일, canonical 등록일, backtest 기간, forward-paper 시작일, funded-live 시작일을 별도 표기 |
| **Version history** | Artifact/config/data/state 의미 변경, activation 시점, migration/reset, 이전 성과와 새 segment의 관계 |
| **Missed decisions** | 전체 예정 epoch를 분모로, missing proof / failed execution / data outage / override를 구분. HOLD와 혼동 금지 |
| **Risk envelope** | Allowlist, position/leverage/notional/turnover/expiry 등의 집행 가능한 조건. MDD·수익률 보증으로 표현 금지 |
| **Creator history** | 등록·종료·실패한 전략, 운용 장애, 변경 이력, 검증 가능한 identity/관련 이해관계·자기자본 범위 |

**Attribution [설계 추론]:** `canonical target → 허용된 주문 → 실제 fill → net NAV`를 각각 기록한다. Target 산출 차이는 artifact/input/state, 주문 차이는 sizing/risk override, fill 차이는 latency/liquidity/venue, net NAV 차이는 fee/funding/mark/cash flow에서 확인한다. 모든 counterfactual을 유일한 숫자로 분해할 수 있다는 뜻은 아니다. 특히 market impact 때문에 “그 주문을 안 냈다면”의 실제 시장은 관측되지 않는다. [Darwinex도 동일 체결 복제가 불가능함을 명시](https://help.darwinex.com/divergence)한다.

### 팀의 다섯 질문에 대한 직접 답

**1. 수익률이 비슷하면 무엇으로 고르는가? [추론]** 순수익과 tail loss·MDD 회복시간, 비용/turnover, capacity, 기존 portfolio와의 downside correlation, 투자기간·유동성, operational reliability로 고른다. Standalone Sharpe 순위만으로는 충분하지 않다. [Chamber leaderboard 문서](https://docs.chamberfi.com/concepts/leaderboard-ranking)도 score에 correlation·tail risk·manager changes 등이 충분히 반영되지 않는다고 설명한다.

**2. 기존 전략과 상관이 높으면? [추론]** 독립 alpha로 크게 배정하지 않거나, 더 싼 대체재·더 큰 capacity·다른 execution/venue를 제공하는지 평가한다. 수익률이 같고 두 자산 변동성이 각각 10%인 가상의 50:50 portfolio에서 correlation 0.9이면 변동성 약 9.75%, 0.1이면 약 7.42%다. 동일 standalone 성과의 경제적 가치가 달라지는 산술 예시이며 미래 예측이 아니다.

**3. Opaque인데 correlation/factor를 어떻게 평가하는가? [사실/추론]** 같은 기간·통화·marking의 net return stream이 있으면 코드 없이 rolling/downside correlation, BTC/ETH beta, 정한 factor에 대한 회귀를 계산할 수 있다. Holdings/exposure 정보가 있으면 해석이 더 낫다. [Darwinex correlation](https://help.darwinex.com/correlation-between-darwins)은 실제 사례지만 계산창은 최근 3개월이며 시간이 지나면 상관이 바뀐다고 설명한다. 몇 주 자료로 위기상관이나 희귀 tail exposure까지 안다고 주장하지 않는다.

**4. 알려진 전략과 유사한지 검증 가능한가? [추론]** 특정 benchmark/library에 대한 **관측 행동의 유사성**은 평가할 수 있다. Source hash의 다름은 아이디어의 다름이 아니고, 높은 return correlation은 코드 복제의 증거가 아니다. 과거에는 같다가 내일부터 다른 행동을 하는 두 프로그램을 만들 수 있으므로 finite replay는 일반적 동일성/독창성을 입증하지 못한다. Numerai가 [기존 signal 집합에 대한 orthogonal component](https://docs.numer.ai/numerai-signals/scoring)를 평가하는 것도 세계 전체 전략에 대한 독창성 인증과 다르다.

**5. 그 기능이 없어도 되는가? [판단]** **독창성 인증은 없어도 된다.** 운용·관측 성과·portfolio fit을 사는 거래이기 때문이다. 다만 diversification 판단에 필요한 전체 returns와 최소 risk/exposure 정보를 제공할 수 없다면 선택한 allocator 상품에는 치명적이다. “완전히 opaque지만 proof가 있으니 믿으라”는 실사 모델은 기각한다.

### Privacy-preserving 방법의 현실적 순서

1. **우선 구현 [제안]:** 독립 accounting과 예정 calendar에 대조한 전체 NAV/return stream에 그 accounting 주체가 서명하고, buyer가 자신의 portfolio와 로컬 비교한다. 서명 자체가 기록의 완전성이나 진실을 만드는 것은 아니다. Code는 숨기고 buyer의 기존 portfolio도 서버에 보내지 않아도 된다. Positions는 지연/집계 공개 또는 NDA/DD access로 다룬다.
2. **기술적으로 가능한 관계 [설계 추론]:** 인증되고 전체 기간이 고정된 returns/positions commitment에서 metric·exposure bound·고정 factor correlation을 올바르게 계산했음을 ZK로 증명할 수 있다. 범위·precision·missing policy·fee·valuation을 먼저 고정해야 한다. **계산의 정직성이지 원자료의 진실을 자동 증명하는 기능은 아니다.** [zkVM input/output 관계](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/host-code-101.md).
3. **추가 연구 [미확인]:** Buyer와 seller의 두 return stream을 모두 서로에게 숨기는 비교는 shared trusted analyst/TEE/MPC 같은 공동 계산 설계가 필요하다. 일반 single-prover ZK만으로 양쪽 비밀 데이터가 자동 결합되지 않는다. 무제한 correlation/inner-product query는 원래 수열을 추정할 단서를 준다. Fixed factor library·query budget·coarse/delayed output은 완화책이지 완전 비밀성 증명이 아니다.

**기관 실사의 남은 영역 [추론]:** 경제적 전략 설명, 법인·실소유·책임, custody와 독립 잔고 검증, 자금 인출 권한, 평가·감사, disaster recovery, 데이터 사용권, 비용/capacity, 변경 승인 등을 별도로 확인해야 한다. [AIMA](https://www.aima.org/sound-practices/due-diligence-questionnaires.html)의 공개 안내가 지지하는 것은 이처럼 넓은 과정이다. 이번 조사에서는 어느 기관이 이 disclosure package를 승인하는지 확인하지 못했다.

### Backtest: 하나의 engine을 표준 진실로 만들 수 있는가?

**그 가정은 기각한다. [사실]** Framework의 기본 가정부터 다르다.

| 환경 | 공식적으로 확인되는 가정 | 영향 |
|---|---|---|
| Freqtrade | Requested price가 candle high/low 안이면 기본 no-slippage fill; historical precision limits 대신 현재 exchange limits 사용; dynamic pairlist 재현성 제약 | 동일 indicator라도 fill·universe·precision이 P&L을 바꿈. [backtest docs](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/backtesting.md#assumptions-made-by-backtesting) |
| TradingView Pine | OHLC로 intrabar 경로 추정, broker emulator, 다음 가능한 tick fill, bar magnifier와 commission/slippage 옵션 | Candle-only 결과와 live execution은 다름. Slippage를 정확히 simulate할 수 없다고 명시. [공식 docs](https://www.tradingview.com/pine-script-docs/concepts/strategies/) |
| LEAN | Fill·fee·slippage·buying power·settlement 등 교체 가능한 reality models. 기본은 높은 유동성을 가정 | 전략·거래 규모에 따라 custom 모델 필요. [key concepts](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts), [slippage models](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/slippage/supported-models) |
| HftBacktest | Replay 주문은 과거 시장을 바꾸지 못하므로 market impact 미포함. Queue와 feed/order latency 모델 분리 | Order-book/HFT에는 OHLCV benchmark가 부적합. 전용 engine도 live validation 필요. [fill](https://github.com/nkaz001/hftbacktest/blob/master/docs/order_fill.rst), [latency](https://github.com/nkaz001/hftbacktest/blob/master/docs/latency_models.rst) |

**[제안] 공통 benchmark의 허용 범위:** BTC/ETH 같은 고정된 소수 spot 자산, closed bars, 명시한 sizing·fee·slippage sensitivity, market impact를 무시할 수 있다고 가정한 작은 order size, 동일 data/cutoff만 비교한다. 이는 **공통 조건의 screening 실험**이며 creator 공식 backtest를 대체하지 않는다. Fee/slippage를 변화시켰을 때 결과가 무너지는지도 함께 표시한다.

**[판단] Benchmark 없이 forward/live 중심 상품은 가능하다.** Darwinex 같은 운용 상품이 인접 근거다. 다만 새 artifact의 cold start와 충분한 관측 기간 문제가 커진다. Backtest는 screening·stress·이식 차이 확인, forward-paper는 미래 데이터에서 uptime/decision 관측, funded-live는 실제 비용·fill·NAV·capacity 관측으로 역할을 분리한다. 검증 전 원본의 과거 live history를 새 artifact의 live로 승격하지 않는다.

**[사실/한계]:** [Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)과 [Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)는 다중 시도·선택 편향 문제를 설명한다. 한 artifact의 정확한 replay는 creator가 실패한 후보를 숨겼는지 증명하지 못한다. 전 플랫폼 등록/종료 기록은 플랫폼 안의 편향을 줄이지만 외부 연구 전체를 포괄하지 않는다. **4주간 forward나 높은 Sharpe로 alpha를 검증했다는 결론은 내릴 수 없다.**

## 7. 기술적으로 가능한 것 / 불가능하거나 과도한 것

### End-to-end flow

다음은 **[설계 제안]**이다. 일반 PC에서 encrypted binary를 buyer에게 배포하는 대신 creator 측 private execution/proving을 기본으로 한다.

```text
creator local private artifact + latest private state
                ↓
independently fixed input snapshot + canonical account/receipt state
                ↓
decision (target or HOLD) + proof, before registered deadline
                ↓
registry accepts decision → constrained vault/executor submits order
                ↓
actual fills / fees / cancellations / failure / cash flows
                ↓
reconciled public account state + committed private next state
                ↓
next scheduled epoch

missing proof → independent MISSED record → pause/recovery/defined unwind
```

**Public statement [제안]:** `registry/version/interpreter ID, epoch, predecessor, data root & cutoff, previous state commitment, account/vault ID, canonical account-state root, receipt root, target/HOLD, expiry, next pending state commitment`. Secret witness에는 salted artifact, private state, 인증된 입력/receipt의 필요한 opening이 들어간다. Verifier는 data/receipt/account roots를 prover가 임의로 선택한 값이 아니라 registry/vault에 이미 확정된 canonical 값과 대조하고, 순서가 있는 전체 receipt 범위와 잔고·현금흐름 대사를 확인해야 한다. Public interpreter는 commitment·schema·bounded operations·transition·risk 조건을 확인한다. 단순히 private binary를 hash하는 것보다 buyer가 보장의 의미를 검토하기 쉽다. [RISC Zero receipt](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/receipts.md), [untrusted host](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/zkvm/host-code-101.md).

| 사건 / 질문 | 필요한 동작과 정확한 한계 |
|---|---|
| **사전 등록** | Logic뿐 아니라 parameters·runtime·rounding·warmup·NA 처리·universe/data/state schema·schedule을 결박. Timestamp는 chain/log의 시간·finality에 의존. 알려진 과거 자료에 맞춘 전략을 등록했다고 사전 예측이 되는 것은 아님 |
| **Creator 서버 종료** | 독립 watcher가 예정된 기한 초과를 기록. 자본 추가/신규 위험 중단, 정해진 recovery/unwind. 계속 같은 전략을 돌리려면 다른 주체가 artifact와 최신 secret state를 확보할 failover 필요 |
| **불리한 signal 미제출** | `MISSED_DECISION` 영구 기록, late proof로 지우지 못함. Bond/SLA는 억제책일 뿐 강제 실행/손실보상 보증 아님. 장애인지 고의인지 부재만으로 알 수 없음 |
| **HOLD** | 매 epoch proof 필요. HOLD는 계약에서 명시한 no-action이며 0% return·계좌변화 없음이 아님. 동일 target weight를 다시 내는 것과도 구분해야 함. 같은 target이라도 가격 drift·입출금 때문에 rebalance 주문이 생길 수 있음. 기존 포지션·fee·funding·open orders는 계속 영향을 줌 |
| **Input outage / bad data** | 허용 provider/key·cutoff·완전성·수정 정책을 등록. Provider 서명은 발행자를 인증하지만 경제적으로 올바른 가격이라는 보증은 아님. 장애를 정상 HOLD로 숨기지 않음 |
| **Proof acceptance 뒤 체결 실패** | `DECIDED`와 `EXECUTION_FAILED/EXPIRED`를 구분. 실패 swap 때문에 decision ledger까지 사라지는 구조는 피함. 유효 proof가 체결을 보장하지 않음 |
| **Actual fills → next state** | Filled qty/price, fees, funding, 잔고, pending orders/cancel, 입출금, NAV를 reconcile. “희망한 체결”로 state를 전진시키지 않음. Initial scope는 epoch 전 정산 확정되는 단순 주문으로 제한 |
| **CEX vs DEX** | CEX API 응답은 exchange/executor/attester 신뢰가 남음. DEX는 canonical receipt·event·vault balance와 finality를 연결할 수 있으나 oracle/contract/chain trust는 남음. [Binance events](https://github.com/binance/binance-spot-api-docs/blob/b8a0f61e088c65d18a157f2e11a8e273826b6c08/user-data-stream.md), [Uniswap swap events](https://github.com/Uniswap/v3-core/blob/d0831dc6b8a318df3872b6d68f6de135c9f3ec29/contracts/interfaces/pool/IUniswapV3PoolEvents.sol) |
| **Upgrade / state migration** | 새 version과 미래 activation epoch, buyer 동의/출금 기회. Vetted state migration 또는 reset/new segment. Old record 삭제·합성 금지 |
| **Executor의 timing 선택** | 정해진 order window·TTL·price bounds·keeper failover로 재량 제한. 정확한 최선 체결·실행 liveness는 보증하지 않음 |
| **긴급 위험 축소** | 독립 reduce-only/withdrawal 권한을 공개 정책으로 두고 `OVERRIDE`로 기록. 원래 private strategy가 낸 action이라고 표시하지 않음. 시장 유동성 없으면 즉시 청산도 불가 |
| **Order-flow 역추론** | ZK가 공개 action·position에서 새는 정보까지 지우지 않음. 지연 공개/집계가 완화할 수 있으나 공개 chain의 거래 비밀을 되돌릴 수 없음 |

**Secrecy의 범위 [추론]:** 제한된 EMA/threshold 전략군은 가능한 후보가 작아, 관측한 데이터와 주문을 반복 대조해 파라미터를 좁힐 수 있다. Salted commitment는 저엔트로피 artifact hash의 사전 대입을 완화하지만 공개 출력에서의 추론까지 막지 않는다. 판매할 수 있는 약속은 source/parameter의 비공개 처리이며 영구적인 alpha 복제 방지가 아니다. 이 공개 범위를 creator가 받아들이는지도 공급 검증에 포함해야 한다.

**가장 중요한 정정:** Mandatory epoch + state transition의 보장은 **누락을 숨기지 못하는 기록의 완전성**이다. Secret holder의 computation/execution **liveness**가 아니다. Missed epoch와 종료된 전략이 남아야 하고, 복구하더라도 중단이 있었던 사실은 유지해야 한다.

**Timing [추론]:** Proof-before-trade는 `data finalization + computation/proving + submission/finality + execution`이 고객의 decision-to-order 예산 안에 들어야 한다. 빠른 backfill proof는 당시 제때 제출했다는 증거가 아니다. 사후 proof를 택하면 “잘못된 주문을 사전 차단”하는 보장이 “사후 계산 감사”로 바뀐다.

### ZK와 대안의 trust 비교

| 방법 | 실제로 줄이는 trust | 남는 trust / 비용 | 선택 판단 |
|---|---|---|---|
| **Local zkVM, 적절한 ZK mode** | 제출된 계산이 commitment와 공개 verification relation을 따른다는 creator/executor 신뢰 | Guest/interpreter 정확성, crypto/proof bugs, input provenance, custody/venue, liveness, output leakage, proving 비용 | Customer가 독립 계산검증을 요구할 때 후보 |
| **TEE** | Host가 enclave 내부 code/data를 열람·변조하지 않는다는 위험을 isolation/attestation으로 완화 | Hardware/vendor/firmware/PKI, measurement 검토, key·rollback/freshness·I/O·가용성 | 기존 Python/native stack 수용에 더 유리할 수 있으나 이식 실증 필요 |
| **Central trusted executor** | Creator가 제멋대로 strategy를 바꾸거나 실행을 숨기는 위험을 독립 운영자로 이전 | 운영자가 code/state·ledger·실행을 정직하게 관리한다는 신뢰 | 고객 수요와 disclosure package 검증의 단순한 기준선 |
| **Commitment + audited execution** | 사후 artifact 바꿔치기·이력 조작에 대한 증거 | Commitment 자체는 execution proof가 아님. Auditor/operator가 코드·이력을 확인해야 함 | 고객이 이 신뢰를 수용하면 먼저 검토할 선택지 |
| **Hybrid TEE execution + ZK batch audit** | TEE의 실시간 운영에 사후 계산 검증 추가 | Hardware privacy trust와 사전 방지 부재; 데이터 오류는 공통으로 남음 | Low latency 요구가 있으면 별도 보장으로 평가 |

**[사실]** AWS Nitro는 persistent storage·외부 networking이 없고 parent instance를 통해 통신하며, attestation은 AWS PKI에 의존한다. 따라서 TEE도 데이터 정확성과 availability를 자동 보장하지 않는다. [Nitro](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html), [attestation trust](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html).

**[사실]** 일반 prover는 witness를 볼 수 있다. SP1의 별도 TEE Private Proving 문서는 program을 S3에, encrypted inputs를 TEE에 보내는 workflow를 설명하며 조회 시점 private beta/Enterprise다. Private input 보호를 private ELF 보호로 혼동하면 안 된다. [RISC Zero security](https://github.com/risc0/risc0/blob/3bbcd44d6459b9ef6ac0df3846dc9215514934e8/website/api/security-model.md), [SP1 private proving](https://docs.succinct.xyz/docs/sp1/prover-network/private-proving). 공개 interpreter 안에 secret artifact를 private input으로 넣는 설계도 올바른 proof format·local/TEE proving·trace/log 관리가 있어야 한다.

**[미확인] 원가:** Hourly stream은 365일 기준 연 8,760회다. Proof 한 건을 가상으로 $0.01/$0.10/$1로 놓으면 연 $87.60/$876/$8,760이다. **실제 견적·측정치가 아니다.** Verification, data, executor, custody, support, audits는 추가다. 공통 signal은 subscriber에게 proof를 공유할 수 있지만 실제 fills·입출금·state에 결박된 proof는 vault마다 자동 재사용되지 않는다. 비용은 선정 artifact와 운용 구조에서 측정해야 한다. [SP1의 비용/timeout 설명](https://docs.succinct.xyz/docs/sp1/prover-network/faq).

### 허용할 주장과 기각할 주장

| 기술적으로 가능한 제한 주장 | 불가능하거나 현재 과도한 주장 |
|---|---|
| 등록 이후 동일 canonical artifact/config와 state를 사용한 계산 검증 | “원래 Python 전략과 모든 미래 입력에서 동일” |
| 인증된 input root에 대한 연산과 risk predicate 검증 | “Witness로 준 market/fill 데이터가 참이므로 alpha가 참” |
| 모든 예정 epoch의 on-time decision/HOLD/miss/failure 이력 | “Creator가 꺼져도 secret strategy가 무조건 계속 실행” |
| 정해진 표본의 metric·correlation·exposure 계산 검증 | “미래 profitability, 최대손실, 독창성, 독점성 보증” |
| 소스/파라미터를 공개하지 않는 적절한 ZK proof | “외부 prover도 못 보고, 주문 흐름에서도 아무 정보가 새지 않음” |
| 특정 fill ledger와 전략 state를 연결 | “Proof가 실제 fill 또는 최선 체결을 만들어냄” |

## 8. 4주 MVP가 가능하다면 가장 작은 형태

**[제안] 가능한 것은 비자금 pilot과 technical falsification prototype이다.** 상용 자금 운용 marketplace, 장기간 live track record, 새 vault의 보안/법적 운용 구조까지 완성한다는 계획은 기각한다. 아래 기간은 기존 Rust/zkVM 경험이 있는 개발자와 고객 접근이 있는 담당자가 있다는 조건부 추정이다.

**고정 scope:** Creator 1명, private parameterized artifact 1개, **4시간 또는 일 1회**, BTC/ETH spot long/flat 중 1–2개 자산, closed OHLCV, single trusted data publisher, bounded public interpreter, no external HTTP/ML/funding/order-book, 공개 risk envelope. 이번에 port한 kernel도 source와 동일 전략이라고 주장하지 않고 새 canonical로 등록한다.

| 주 | 완료할 가장 작은 결과 | 이 주에 반증할 것 |
|---|---|---|
| **1주** | Transaction/disclosure sample과 동일 조건의 trusted baseline vs ZK 제안서. Creator logic/semantics·epoch schema 확정. Allocator에게 실제 검토 가능한 예시 보고서 제공 | Buyer가 요구하는 것이 proof인지, track record/독립 risk/custody인지. Creator가 새 artifact 등록을 수용하는지 |
| **2주** | 작은 public interpreter + private artifact, **실제 ZK mode proof**의 local 생성/verify. HOLD와 잘못된 version/state/root/replay 거부. 대표·최악 입력의 비용/지연 측정 | 선택한 subset에서도 proving 또는 비밀성이 성립하지 않는지 |
| **3주** | 독립 expected-epoch ledger, deadline miss·late proof·wrong order·version activation·restart/state recovery fault injection. 하나의 명시된 paper fill rule과 accounting | 손실/실패를 숨길 수 있는지, decision과 fill state가 분리되는지 |
| **4주** | 최소 1주 forward-paper의 전체 outcomes·version history·synthetic NAV·proof timing·비용 보고서. 여력이 있으면 testnet execution/revert/account reconciliation | 시스템이 실제로 연속 기록하는지와 고객이 pilot budget을 약정하는지 |

**MVP 성공의 의미:** “이 좁은 관계를 실제로 증명하고 누락·장애를 정직하게 기록할 수 있으며 특정 고객이 그 차이를 원한다.” **Alpha 검증이나 allocator-grade live history가 아니다.** 새 marketplace UI, token, 전략 추천 알고리즘, private-MPC correlation, 범용 adapter는 이 질문에 답하기 위해 필요하지 않다.

## 9. Kill criteria

아래 숫자는 업계에서 발견한 기준이 아니라 **[제안] 사전에 고정할 의사결정 기준**이다. 인터뷰 결과에 맞춰 성공선을 사후에 낮추지 않는다.

| Gate | 구체적으로 확인할 실패 조건 | 의사결정 |
|---|---|---|
| **Buyer / 지불 의사** | 검토 권한·예산이 있는 allocator **8곳**에 실제 disclosure/protocol/cost가 담긴 제안을 보여줬으나 **2곳의 예산·의사결정자·착수 조건이 명시된 pilot 의향** 또는 **1곳의 유료 pilot**조차 확보 못함 | 후속 marketplace 개발 **KILL**. 흥미/무료 가입/칭찬은 통과로 세지 않음 |
| **ZK necessity** | 위 고객 모두 trusted executor/감사·commitment만으로 같은 거래를 하며, ZK가 도입 조건·예산·자본 한도·DD 시간 중 무엇도 바꾸지 않음 | **ZK 중심 thesis KILL**, 유료 운영 기록/위험관리 서비스 수요가 별도로 있으면 그 사업으로 PIVOT |
| **Disclosure** | 적합 buyer는 code access 또는 creator가 허용하지 않는 수준의 positions/risk disclosure를 필수로 요구하고, 두 조건을 만족하는 고객–creator 조합이 없음 | 해당 **opaque allocation 모델 KILL**. 단순 metric 추가로 유예하지 않음 |
| **Supply / migration** | Qualified creator **5명** 중 **2명**도 제한 SDK·차이 공개·새 canonical/forward segment를 수용하지 않거나, 합의한 단순 전략 하나도 **5 engineer-days** 내 설명 가능한 port를 못 만듦 | “쉽게 기존 전략이 들어오는 시장” 가정 KILL. Native artifact 제작자만을 위한 더 작은 시장의 수요가 없으면 전체 중단 |
| **Integrity** | Wrong version/state/root/account, skipped epoch, late proof를 정상으로 받아들이거나, fill 불일치를 기록 없이 덮거나, miss가 HOLD/0 return으로 표시됨 | 자금 연결 **중단**. 수정·재검증 못하면 protocol KILL |
| **Performance / 비용** | 4h/day pilot에 정한 decision-to-order 예산을 **5분**으로 두고, ≥100회 대표·최악 case에서 P99 end-to-end가 초과. 또는 명시한 committed capital/fee 시나리오에서 연간 recurring contribution이 0 이하. 성과보수 0인 해의 운영비를 충당할 최소 보수·확정 예산/재원도 없음 | Frequency/runtime/trust model **PIVOT**. 같은 고객 요구를 충족하는 대안이 없으면 KILL. 100회는 장기 SLA 입증이 아님 |
| **불가능한 약속 고수** | Creator-only secrets와 무조건 failover, 세계적 originality, future profit/MDD 보증, universal Python equivalence를 필수 기능으로 유지 | **즉시 KILL** |
| **실운용 경로 부재** | Buyer가 납득하는 custody·권한·exit·독립 accounting·책임/운용 구조를 확정할 경로가 없음 | **Capital product KILL**. 실자금을 다루지 않는 검증 tooling 수요가 있는지 별도 판단 |

**4주에 판단하지 않을 것:** 전략이 수익을 냈는지, 짧은 Sharpe가 높은지, 시장 전체 TAM이 큰지. 이들은 위 가정들을 대체하는 통과 기준이 아니다.

## 10. 최종 결론: **PIVOT**

**전략 등록·구매를 전면에 둔 marketplace에서, 전문 allocator의 제한된 운용 mandate와 검증 서비스로 PIVOT한다.** 사용자가 제시한 계산 무결성 용도와 좁은 전략군은 기술적으로 유효한 후보이다. 그러나 현재 근거만으로 marketplace 구축에 GO를 줄 수는 없다. 이식·공개 조건을 함께 수용할 creator–buyer 조합, ZK가 바꾸는 구매 조건, 실제 proving 경제성이 아직 확인되지 않았다.

그러나 **비공개 전략 운용에 자본과 보수를 배정하는 거래 자체는 존재한다**. 코드 없이 return/exposure의 일부를 비교하는 방법도 실제 상품에서 사용한다. 따라서 비공개 전략이라는 이유만으로 전체 문제를 KILL할 근거도 부족하다.

**전환할 대상은 “제한된 canonical strategy의 운용 mandate와 검증 가능한 execution/track-record 서비스”다.** 먼저 전문 allocator와 creator 한 조합에서 거래가 성립하는지 확인하고, trusted baseline과 비교해 ZK가 어떤 계약 조건을 바꾸는지 검증한다. 현재 근거에서 **새 marketplace의 수요·ZK 필요성·proving 단위경제는 모두 미확인**이다.

**유료 고객과 양립 가능한 disclosure/운용 구조를 확보하지 못하면 전체 사업을 KILL한다. ZK에 대한 수요만 없다면 ZK thesis를 KILL한다. 운용 서비스 자체의 유료 수요가 별도로 확인된 경우에만 그 사업을 검토한다.**

---

검증 근거와 재현 자료: [시장·상품 원자료 노트](market-evidence.md), [adapter 표본·실험·소스 manifest](adapter-evidence.md), [프로토콜·zkVM·TEE·backtest 원자료 노트](technical-evidence.md), [DD·통계·unit economics 노트](diligence-evidence.md). 각 자료는 사실·추론·미확인을 구분하며 중요한 주장에 직접 1차 출처를 연결한다. 이 보고서에 쓴 시장 핵심 사실 8개 페이지는 별도 [spot-check 기록](sources/market-spotcheck.json)으로도 보존했다.
