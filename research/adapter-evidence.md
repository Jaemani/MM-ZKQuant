# Adapter feasibility: source inspection and bounded historical replay

조사 기준일: 2026-09-16. **사실**은 읽은 공식 문서·코드 또는 이 작업에서 실행한 결과, **추론**은 그 사실에서 내린 제품/기술 판단, **미확인**은 실행·실측하지 않은 주장이다. 공개 예제의 수익성이나 실제 채택률을 추정하지 않았다.

**판정 — 추론:** 현실적인 것은 “Python 전략 업로드 → 같은 전략을 즉시 ZK 실행”이 아니라, **제한된 closed-bar 전략의 decision kernel을 명시적인 상태·정수 연산·입력 계약으로 옮기고, 원본과 차이를 보여준 뒤 새 canonical artifact로 승인·등록하는 migration SDK**다. 두 실데이터 replay가 일치했어도 경계값에서는 실제로 행동이 달랐다. Adapter를 코드 동일성 또는 보편적인 의미 동등성 보장으로 팔면 안 된다.

## 1. 실제 abstraction boundary

| Framework | market data → alpha/signal | signal → target/order | execution/feedback | 의미 |
|---|---|---|---|---|
| Freqtrade | `populate_indicators(DataFrame)` → `populate_entry_trend` / `populate_exit_trend`; DataFrame 행은 OHLCV candle | 프레임워크가 entry/exit flag를 포지션·ROI·stoploss·stake·order config와 결합 | exchange와 Trade/Order 상태, `custom_stake_amount`, `adjust_trade_position`, `order_filled` 등 callback | signal 함수는 좋은 절단점이나 전체 전략 아님. callback, config override, order state까지 가져오려면 state machine 범위 증가 |
| Hummingbot V2 | `MarketDataProvider`의 candles/orderbook/trades → controller `update_processed_data()` | `determine_executor_actions()` → `CreateExecutorAction` / stop action; 방향 controller는 signal 이외에 현재 mid, 활성 executor 수, cooldown 등을 사용 | executor가 position·DCA·arbitrage 등의 주문 lifecycle 수행, fill·PnL·active executor 상태를 controller가 다시 읽음 | controller가 모듈식이라고 pure 함수라는 뜻은 아님. 입력과 feedback을 모두 snapshot 계약으로 만들 수 있는 부분만 추출 |
| LEAN Algorithm Framework | UniverseSelection → AlphaModel `update()` → `Insight` | PortfolioConstruction → `PortfolioTarget`; RiskManagement가 조정 | ExecutionModel이 target을 주문으로 바꾸고 brokerage·holdings·fills가 다음 Slice/event에 반영 | 네 ecosystem 중 개념 경계가 특히 명확. Python 클래스는 `AlgorithmImports`/.NET indicator, history, consolidator에 의존하므로 런타임 이식성과 구분 |
| Pine | bar별 실행 + `ta.*`, history `[]`, `request.*` | `strategy.entry/order/exit` 또는 alert | TradingView broker emulator가 체결·position state를 만듦; realtime tick/rollback/`varip` 설정은 역사적 bar와 의미가 다름 | closed-bar 계산식만 옮길 수 있음. `strategy.position_size`, fill callback에 의존하면 emulator semantics도 재구현 대상 |

**사실 출처:** [Freqtrade strategy customization](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-customization.md), [callbacks](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-callbacks.md); [Hummingbot 공식 controller 문서 원본](https://github.com/hummingbot/hummingbot-site/blob/f1108de3d352733936fc400e177021f81939eecc/docs/strategies/v2-strategies/controllers/index.md), [directional controller action 생성](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/hummingbot/strategy_v2/controllers/directional_trading_controller_base.py#L152); [LEAN framework overview](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview), [EMA model](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Framework/Alphas/EmaCrossAlphaModel.py#L36); [Pine execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/), [strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/). Hummingbot 웹 렌더링 주소는 403/404였으며 공식 GitHub 문서 원본으로 확인했다.

## 2. 실제 공개 code sample 분류

아래 분류는 **decision logic을 제한된 artifact로 옮길 난이도에 대한 추론**이다. “거의 그대로”도 원래 Python/Pine/.NET 런타임을 그대로 증명했다는 뜻이 아니다. 표의 **실행**은 아래 실증을 수행한 신호 kernel만 의미한다. 나머지는 **소스 검사**이며 전체 framework 실행은 모두 0회다.

| 실제 sample / 유형 | 옮길 경계와 관찰한 의존성 — 사실 | 분류 — 추론 | 검증 수준 |
|---|---|---|---|
| Freqtrade [`AverageStrategy.py`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/berlinguyinca/AverageStrategy.py#L38), EMA crossover/OHLCV | 4h, TA-Lib EMA8/21 기본값, qtpylib cross, positive volume; 별도 ROI 50%/stoploss −20% config 존재 | **약간의 수정**: EMA seed·rounding·cross equality를 고정. ROI/stoploss와 주문은 별도 이식 | **실행: 3 원본 method body**, native 4h historical replay |
| Freqtrade [`TrendFollowingStrategy.py`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/futures/TrendFollowingStrategy.py#L27), trend/OBV | 5m, pandas EWM20 `adjust=False`, TA-Lib OBV, 4 signal flag; ROI·trailing stop가 추가됨 | **약간의 수정**: signal kernel. 모든 risk/short/exit lifecycle 동일성은 아직 아님 | **실행: 3 원본 method body**, native 5m historical replay |
| Freqtrade [`ADXMomentum.py`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/berlinguyinca/ADXMomentum.py#L38), momentum | TA-Lib ADX, PLUS_DI, MINUS_DI, SAR, MOM 등의 연산과 threshold 조합 | **약간의 수정**의 후보, 단 ADX/SAR 초기화·분기·numeric library를 먼저 지원해야 함 | 소스 검사; indicator 동등성 미실측 |
| Freqtrade [`HourBasedStrategy.py`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/HourBasedStrategy.py#L85), schedule | UTC/date→hour→inclusive `between` flag; hyperopt/config parameter와 ROI는 별도 | **거의 그대로**: 정수 hour predicate에 한정. timezone·경계값·로드된 params를 artifact에 명시 | 소스 검사; 전체 전략 미실행 |
| LEAN [`EqualWeightingPortfolioConstructionModel.py`](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Framework/Portfolio/EqualWeightingPortfolioConstructionModel.py#L44), rebalance | active Insight의 direction/bias를 세어 `direction / count`; 실제 rebalance 시점·insight expiry는 상위 framework | **거의 그대로**: 이미 결정된 universe와 active insight 집합의 weight 산출. schedule·dust·expiry는 명시 필요 | 소스 검사; 이는 **portfolio model**이며 독립 full strategy라고 세지 않음 |
| LEAN [`EmaCrossAlphaModel.py`](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Framework/Alphas/EmaCrossAlphaModel.py#L36), trend | .NET EMA readiness, `fast_is_over_slow` 상태, prediction interval, security 추가/삭제 시 indicator reset·consolidator | **약간의 수정**: 고정 universe·fixed bar라면. 동적 universe/Insight lifecycle 전체는 더 큼 | 소스 검사. [실제 framework 연결 예제](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Python/EmaCrossAlphaModelFrameworkRegressionAlgorithm.py#L23)도 확인 |
| Hummingbot [`bollinger_v1.py`](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/controllers/directional_trading/bollinger_v1.py#L67), OHLCV mean reversion | candles→pandas_ta Bollinger band percent→`signal` −1/0/1. 차트 timeframe과 latest candle 확정 여부를 정해야 함 | **약간의 수정**: 평균·분산·sqrt/threshold·warmup 명세. position executor 교체까지 자동 보장하지 못함 | 소스 검사 |
| Hummingbot [`supertrend_v1.py`](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/controllers/directional_trading/supertrend_v1.py#L60), trend | pandas_ta Supertrend 값·방향 및 close와의 상대 거리로 signal | **약간의 수정** 후보지만 재귀 indicator state와 초기화 구현 필요 | 소스 검사 |
| Hummingbot [`v2_funding_rate_arb.py`](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/scripts/v2_funding_rate_arb.py#L175), funding | connector별 funding interval 정규화→최대 rate 차이 조합; 실제 fee·현재 bid/ask·양쪽 position executors·funding payment event 사용 | rate 선택 arithmetic은 작지만 **상당한 rewrite**: 입력 timestamp·venue별 funding semantics·두 leg fill·settlement·margin state가 필수 | 소스 검사. [funding event](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/scripts/v2_funding_rate_arb.py#L266) |
| Hummingbot [`stat_arb.py`](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/controllers/generic/stat_arb.py#L241), stat-arb | spread/z-score 외에도 양쪽 현재 포지션·PnL·open/filled executor·hedge imbalance를 참조 | **상당한 rewrite**. 단순 fixed-pair end-of-bar z-score kernel 자체는 후속 지원 가능 | 소스 검사; 다중 venue 실행 미실측 |
| LEAN [`PearsonCorrelationPairsTradingAlphaModel.py`](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Framework/Alphas/PearsonCorrelationPairsTradingAlphaModel.py#L39), pairs/stat-arb | dynamic securities/history, log prices, scipy `pearsonr`, timezone 정렬, pair ranking | **상당한 rewrite**: fixed universe라면 bounded window로 재정의 가능. log·NaN·tie·calendar 의미 보존 필요 | 소스 검사; [실제 연결 예제](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Python/PearsonCorrelationPairsTradingAlphaModelFrameworkAlgorithm.py#L27) |
| Freqtrade [`TWAPStrategy.py`](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/TWAPStrategy.py#L86), execution schedule | `trade.has_open_orders`, filled entry/exit 목록, **마지막 실제 fill 시각**을 읽어 다음 slice와 stake 계산 | **상당한 rewrite**. 단순 시간 리밸런스로 취급하면 원본 전략을 바꾸는 것 | 소스 검사 |
| LEAN [`CustomDataBitcoinAlgorithm.py`](https://github.com/QuantConnect/Lean/blob/f9107abdf26121c5ce159f561bd27fead01d30e1/Algorithm.Python/CustomDataBitcoinAlgorithm.py#L54), external HTTP/custom data | live는 Bitstamp REST, backtest는 별도 historical CSV; parser가 BaseData를 생성 | **상당한 rewrite**: HTTP를 guest 밖으로 빼고 source·timestamp·schema·signature/attestation 계약 필요 | 소스 검사; endpoint 현재 가용성과 원본 backtest 미검증 |
| Freqtrade [`FreqaiExampleStrategy.py`](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/freqtrade/templates/FreqaiExampleStrategy.py#L225), ML | feature-engineering 확장, future-return label, `self.freqai.start`, `do_predict` gating 및 prediction으로 entry/exit | **상당한 rewrite**, 작은 frozen quantized inference만 별도 후보. 학습·재학습·전체 Python ML stack은 **초기 범위에서 사실상 불가** | 소스 검사; 모델 inference·학습 proof 미실측 |
| Hummingbot [`simple_pmm.py`](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/scripts/simple_pmm.py#L50), order-book market making | `on_tick`에서 cancel→current mid→proposal→budget adjustment→place; fill callback이 별도 발생 | quoted spread 계산식은 작지만 **상당한 rewrite**; book freshness, cancel/replace races, inventory·fill/queue state가 성과의 핵심 | 소스 검사; source 이름의 simple이 execution 단순성을 보장하지 않음 |
| Pine 공식 “Simple strategy demo”, SMA crossover | `ta.sma(14/28)`와 `ta.crossover`→`strategy.entry`; broker emulator가 reversal/actual simulated fill 처리 | **약간의 수정**: closed-bar signal 수식. Pine `strategy.*` 전체는 **상당한 rewrite** | [공식 실제 예제 검사](https://www.tradingview.com/pine-script-docs/concepts/strategies/#a-simple-strategy-example); Pine runtime 미실행 |
| proprietary data 전략 — **범주 평가** | 데이터 내용을 여기서 볼 수 없어 실제 proprietary 전략 sample은 없음. 위 REST/custom-data 예제는 경계가 존재한다는 증거만 제공 | 서명된 bounded private input이면 조건부 가능. source provenance/availability를 제공 못하면 초기 SDK에서 **사실상 불가** | **미확인:** private 전략의 포팅 성공률을 공개 코드에서 추정하지 않음 |
| HFT — **범주 평가** | Hummingbot의 [Cython PMM 구현](https://github.com/hummingbot/hummingbot/blob/2bfaccc48dd49e71a5b6d9b3011808e127dd00cd/hummingbot/strategy/pure_market_making/pure_market_making.pyx)은 참조했으나 production HFT 시스템 sample이거나 지연 벤치마크라고 주장하지 않음 | **초기 pre-trade-proof 범위에서 사실상 불가**: strict closed-bar MVP와 tick/queue/latency 기반 목적 불일치. 영구적 수학적 불가능을 뜻하지 않음 | **미확인:** hardware·venue·proof latency에 따른 한계 수치는 실측 필요. post-trade audit proof는 별도 제품 |

**추론:** initial whitelist는 fixed universe, 명시적인 bar close, 시간당~일별 decision, 작은 window의 SMA/EMA/return/volatility와 정해진 risk caps, one-shot target weight 출력으로 좁히는 것이 타당하다. 5m trend kernel은 실험상 계산식 이식 가능성을 보여주지만, 5m proof+execution 경제성·지연까지 검증한 것은 아니다. 모든 strategy subset을 “proof-compatible”이라고 이름만 붙여 받아서는 안 된다.

## 3. 실증: 실제로 실행한 것과 결과

**사실:** `adapter/replay.py`가 2개 Freqtrade 공개 source에서 `populate_indicators`, `populate_entry_trend`, `populate_exit_trend` **총 6개의 원본 method body**를 AST로 추출해 그대로 실행했다. qtpylib의 `crossed`, `crossed_above` **2개 원본 helper body**도 실행했다. pandas와 TA-Lib는 실제 라이브러리다. 클래스/parameter wiring은 shim으로 대체하여 Average의 기본 EMA8/21을 고정했다. 프레임워크, 계정, ROI, stoploss, trailing stop, fills, fees, leverage는 실행하지 않았다.

**실행 수: signal kernel 2개; 원본 strategy method 6개; 원본 helper 2개; complete strategy replay 0개; 실제 fill 0개; zk guest build/proof 0개.**

| Replay | Bars / 기간 | 원본 signal 수 | port signal 수 | 다른 bar / 다른 flag |
|---|---|---|---|---|
| AverageStrategy, native 4h, BTCUSDT | 2,196 / 2024-01-01~2024-12-31 | enter_long 41, exit_long 41 | 41, 41 | **0 / 0** |
| TrendFollowingStrategy, native 5m, BTCUSDT | 8,928 / 2024-01-01~2024-01-31 | enter_long 682, enter_short 682, exit_long 0, exit_short 0 | 682, 682, 0, 0 | **0 / 0** |
| Constant → 1e-8 increment → constant, Average | 40 / synthetic valid arithmetic grid | 1 entry, 1 exit | 0, 0 | **2 / 2** |
| 같은 경계값, Trend | 40 | 1 long-entry, 1 short-entry | 1, 0 | **1 / 1** |
| Minimum price 1e-8→2e-8→1e-8, Average | 50 | 1 entry, 1 exit | 0, 0 | **2 / 2** |
| 같은 minimum-price fixture, Trend | 50 | 1 long-entry, 1 short-entry | 1, 0 | **1 / 1** |

**사실:** 연속 상승·zero-volume reversal fixture에서는 두 kernel 모두 signal 차이 0이었다. missing bar, duplicate bar, NaN price, canonical precision 초과, negative volume 입력 5종은 port의 명시적 input contract가 거절했다. 이 거절은 framework 전체 동작의 reproduction이 아니라 새로운 canonical policy다. source TrendFollowing 예제의 두 exit column이 이 표본에서 0인 사실도 성과 판단으로 사용하지 않았다. 원래 framework의 ROI/stoploss/trailing/short 설정이 결과를 바꿀 수 있다.

**사실:** indicator 값 자체는 historical sample에서도 bit-identical하지 않았다. Average EMA8·21의 최대 절대차는 각각 약 `3.29e-8`, `7.03e-8`, Trend EWM20은 `7.22e-8`였다. 40-bar fixture의 index 30에서 원본 EMA는 `100.00000000222222 > 100.0000000009091`로 entry를 냈고, port는 두 값을 `100.0`으로 floor하여 HOLD였다. 이 fixture는 후보 arithmetic grid의 반례이지 실제 BTCUSDT tick size 주장이나 P&L 실험이 아니다.

**추론:** 입력과 결정을 여러 해 비교해도 본 적 없는 수치/분기/체결 상태에서 원본과 달라질 수 있다. 내부 indicator precision을 올리면 특정 차이는 줄지만 모든 float library와의 의미 동등성은 자동 획득하지 못한다. “historical replay pass”라는 단일 badge 대신 decision mismatch 개수·시점·원인·제외 lifecycle을 그대로 제시해야 한다.

재현 파일: [README](adapter/README.md), [replay.py](adapter/replay.py), [results.json](adapter/results.json), [source hashes/commits](adapter/sources-manifest.json), [data provenance](adapter/data/manifest.json), [fetch.py](adapter/fetch.py). 환경은 Python 3.12.14 / numpy 2.3.5 / pandas 2.2.3 / TA-Lib Python 0.6.8, C 0.6.4다. [Binance 공식 public archive 설명](https://github.com/binance/binance-public-data), [2024-01 4h 원본 archive](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/4h/BTCUSDT-4h-2024-01.zip), [2024-01 5m archive](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/5m/BTCUSDT-5m-2024-01.zip). 이 archive를 production oracle로 인증했다는 주장은 하지 않는다.

## 4. 서로 다른 네 보장

| 주장 | 실제 의미 | 이 조사에서 확보한 것 |
|---|---|---|
| 1. 기존 Python 그대로 proof environment 실행 | Python interpreter, pandas/NumPy/TA-Lib native extension, framework runtime와 의존성, floating point, clock/I/O까지 guest에서 그 의미대로 지원해야 함 | **미확인.** 이 실험은 host Python에서만 실행. 가능/불가능을 일반화하지 않으며 seamless adapter 주장을 뒷받침하지 못함 |
| 2. logic을 proof-compatible artifact로 port | 순수 transition, bounded state/input/loop, numerical semantics, prohibited I/O, compiler/VM target을 명시 | **일부 확보.** 정수 transition reference와 bounds를 작성. Rust/DSL guest compile 및 proof는 미수행이므로 실제 proving-compatible 바이너리라고 부르지 않음 |
| 3. original/adapted historical replay 비교 | 특정 input·parameter·초기 state·관측한 출력 범위에 한정된 empirical differential test | **확보.** 두 real-data sample은 flag 일치, 여러 numeric fixture는 불일치. full strategy·P&L·unseen input 동등성은 아님 |
| 4. adapted artifact를 새 canonical strategy로 등록 | creator가 새 수치/상태/데이터/실행 계약을 자신의 향후 전략으로 채택하고 version을 commit | **설계 가능, 미구현.** 이후 proof의 의미는 이 새 artifact 준수. 이전 원본의 과거 수익률·독창성·포팅 정확성을 자동 증명하지 못함 |

**추론:** SDK 산출물은 `original source hash + locked dependencies/config + migration diff + replay mismatch report + new artifact hash + state/data/execution specification`이어야 한다. initial model은 `state + closed data + authenticated fills → target/HOLD + next state`로 한다. raw Python source hash만 저장하면 config override·data choices·execution behavior가 빠진다. 관련 사실: [Average config override 주석](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/berlinguyinca/AverageStrategy.py#L21), [Freqtrade callback](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-callbacks.md), [TWAP가 실제 fill 시각을 사용](https://github.com/freqtrade/freqtrade-strategies/blob/f3340ce11f5bdf62f598522e64d1f5638eaa13f5/user_data/strategies/TWAPStrategy.py#L113).

## 5. Backtest 다양성과 execution feedback에 대한 직접 증거

**사실:** Freqtrade backtest는 candle high/low 범위 안의 요청 가격이면 slippage 없이 체결한다고 가정하며, low/high 순서·stoploss·ROI·exit signal 우선순위를 명시한다. 상세 timeframe 옵션으로 intrabar 모사를 바꿀 수 있다. [공식 가정](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/backtesting.md#assumptions-made-by-backtesting)

**사실:** Pine broker emulator는 기본적으로 chart OHLC로 intrabar 경로를 추정하고, 기본 close-bar 전략의 order는 다음 bar open에서 가장 빨리 체결된다. Bar Magnifier, `calc_on_order_fills`, `calc_on_every_tick`, `process_orders_on_close` 등이 의미를 바꾼다. [공식 broker emulator](https://www.tradingview.com/pine-script-docs/concepts/strategies/#broker-emulator), [calculation behavior](https://www.tradingview.com/pine-script-docs/concepts/strategies/#altering-calculation-behavior)

**사실:** LEAN은 portfolio, brokerage, fill, slippage, capacity 등의 reality model을 따로 두며 기본 모델은 유동성이 높은 자산을 가정한다. 거래량이 크거나 비유동 자산이면 custom model을 권장한다. [공식 reality modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts)

**사실:** Freqtrade `bot_loop_start`는 live/dry에서 보통 5초마다, backtest에서는 candle당 실행한다. 공식 예제는 `requests.get`으로 외부 데이터를 불러와 이후 signal 함수가 사용하도록 한다. 따라서 DataFrame의 OHLCV만 replay해도 source가 같다는 이유로 전체 live behavior가 같다고 할 수 없다. [callback cadence/HTTP 예제](https://github.com/freqtrade/freqtrade/blob/175ed3db469d1451224f0ab7677271bcc332c37e/docs/strategy-callbacks.md#bot-loop-start)

**추론:** 하나의 benchmark는 명시한 venue/data/fee/fill/impact와 fixed-bar subset의 비교 화면으로 유용하다. creator의 고유 backtest를 대체하는 universal truth로 주장할 근거는 없다. 표준 benchmark의 net return은 model output이고, 실계정 audited net NAV/수수료/funding/실체결은 다른 evidence다. Backtest는 screening과 adapter regression, forward/live는 실제 자본 배분 판단을 위한 주된 관찰 자료로 구분하되, 짧은 live 표본을 통계적 검증 완료로 취급하면 안 된다.

**추론:** actual fill-dependent 전략은 반드시 fill identity, order identity, filled size/price, fee/funding, cancel acknowledgement, event order를 canonical input에 포함해야 한다. 특히 TWAP·funding·stat-arb·market making은 intended order만 state에 넣으면 실제 포지션과 가상 state가 갈라진다. ZK는 제공된 fill record가 실제 거래소에서 일어났다는 사실을 자체로 만들어주지 않는다. 이는 source authenticity/venue integration 영역이며 이 실증에서 다루지 않았다.

## 6. 좁은 SDK에 대한 승인/기각 기준

**추론 — 지원 후보:** fixed universe의 spot 또는 제한된 단일 venue instrument; 사전 확정된 closed-bar schedule; bounded SMA/EMA/returns/variance; fixed-point와 explicit warmup; 완전한 HOLD record; 가벼운 target sizing와 hard risk cap. creator가 이 의미를 새 canonical artifact로 채택하는 경우다.

**추론 — 초기 기각:** arbitrary HTTP를 내부에서 실행하는 전략, clock/random/filesystem 의존, 학습을 포함한 mutable ML pipeline, venue별 지연/queue priority가 alpha인 HFT, 불완전한 historical data를 “원본과 동등”하다고 요구하는 경우, fill/cancel/margin 상태를 input 계약으로 제출할 수 없는 상태ful 전략. Frozen 작은 ML inference나 funding/stat-arb는 후속 별도 adapter일 수 있지만 4주 MVP의 범용 지원 근거가 아니다.

**미확인:** 이 제한을 받아들일 **수익성 있는 creator**가 몇 명인지, 그들이 포팅·검증 비용을 누가 부담할지, 실제 private artifact의 proof 생성 시간/메모리/단가, live 데이터 및 fill attestation 비용, 24/7 운영 가능성. 공개 educational samples 두 개의 계산식 이식 성공으로 이 공급 가정을 검증했다고 하면 안 된다.

**다음 실험 — 추론:** 실 creator 2~3명에게 bounded spec을 주고 기존 strategy의 migration diff와 mismatch report를 직접 검토받는다. 후보 하나의 compiled guest proof, HOLD를 포함한 1주 연속 결정, 실제 venue fill/state reconciliation, 중단/누락 recovery를 수행한다. 이 과정에서 creator가 “새 artifact 채택은 못 하고 원본 전체 runtime 그대로만 가능”하다고 하거나 비용·지연이 decision budget을 넘으면 해당 subset과 제품 주장을 기각한다.
