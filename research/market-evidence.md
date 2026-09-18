# Zero-Knowledge Alpha Market — 시장·거래 단위·실사 근거

조사일: **2026-09-16 (Asia/Seoul)**. 아래 URL은 이날 직접 조회했다. 범위는 A/B/C이며, 기술 구현 가능성이나 수익성 실험을 대신하지 않는다. **사실**은 문서·코드가 직접 말하는 내용, **추론**은 그로부터 도출한 제품 판단, **unknown**은 이번 공개자료 조사로 확인하지 못한 내용이다. 업체 자체 발표는 독립 감사 결과와 구분했다.

## 가장 강한 판단

**추론:** “코드를 숨긴 전략에 투자자가 돈을 내지 않는다”는 전제는 기각할 수 있다. Darwinex는 전략의 거래 세부를 감춘 복제 운용과 성과보수를 실제 상품으로 제공하며, 제작자에게 누적 $5M 이상 성과보수를 지급했다고 직접 밝혔다. 그러나 이것은 **비공개 전략 운용에 대한 지불**의 근거이지 **ZK 실행 무결성에 추가로 지불할 의사**의 근거가 아니다. [M1][M2][M3]

**추론:** 가장 자연스러운 거래 단위는 소스코드 매매가 아니라 **명시된 제약 안에서 특정 전략 버전으로 운용되는 자본에 대한 경제적 지분/운용 위임**이다. 전문 구매자가 자기 실행 시스템을 갖췄다면 **동일한 계약으로 정의된 signal/target stream 사용권**이 또 다른 자연스러운 단위다. 이 둘은 체결·상태·성과 귀속이 달라 같은 상품으로 취급하면 안 된다. [M1][M7][M9][M10][M12]

**unknown:** 신규 ZK 상품에 대한 유료 파일럿, 검증 비용을 감당하는 자본 규모, 실제 allocator의 수요, creator의 이식 비용 수용 여부는 확인되지 않았다. 기존 상품의 존재·누적 지급액으로 이 공백을 메울 수 없다.

## A. 거래 모델 비교

아래 표는 제품 구조 분석이다. 해당 구조가 존재하는 실제 근거는 다음 절에서 구분한다.

| 모델 | 실제 buyer / 받는 것 | creator의 경제적 권리 | 전략 비밀 | 실행 책임 | 수익률 차이의 귀속 |
|---|---|---|---|---|---|
| 소스코드/라이선스 | 전략 개발팀·prop·자체 운영 가능한 트레이더 / 코드 및 계약상 사용권 | 일시금, 기간 라이선스, 독점성·재판매 제한 등 계약상 권리 | 소스를 받은 buyer에게는 비밀 아님. 비공개 재배포 의무는 계약 문제 | buyer가 데이터·인프라·위험관리·체결 운영 | 버전, 입력 데이터, 포트폴리오 상태, 주문·체결 로그가 모두 있으면 분해 가능. 코드 일치만으로 원인 확정 불가 |
| signal subscription | 개인 자동매매 사용자 또는 signal을 조합하는 전문팀 / 시각·자산·방향·강도·만료·target 등 | 월 구독료 또는 합의한 signal 품질/기여도 보상 | 코드는 숨길 수 있으나 출력은 buyer에게 노출, 재판매·역추론 위험 | creator가 signal 생성·발행, buyer/브로커가 사이징과 체결 | signal 품질과 buyer의 실행 결과를 별도 평가. 서로 다른 계좌 수익률을 원래 전략 수익률로 동일시 불가 |
| black-box executable 사용권 | 자체 서버 운용팀 / 바이너리·컨테이너·호스티드 실행 endpoint | 설치/호출/기간 라이선스, 계약한 로열티 | buyer가 실행 파일을 직접 보유하면 비밀 보장이 별도 문제. 소스 미제공 ≠ 역분석 불가능. 호스팅·TEE 등 운영 선택 필요 | 배포형은 buyer, 호스팅형은 공급자·플랫폼; 장애 경계를 계약에 고정 | 모든 runtime 의존성·I/O 로그를 고정해야 분해 가능. 로컬 검증 가능한 실행물이 곧 성과 동일성은 아님 |
| creator 운용 vault / managed mandate | 자본 allocator·암호자산 운용 고객 / vault share 또는 계좌 수익에 대한 권리 | 운용·성과보수, 경우에 따라 최소 자본 약정 | creator 코드 비공개 가능. 온체인 포지션·거래 흐름의 비밀은 별도이며 흔히 공개 | creator 결정, vault 정책과 executor 집행, venue 체결. 법적 운용 책임도 정해야 함 | 동일 vault NAV를 공유하므로 개인별 복제 차이가 작아짐. 단 입출금 시점, 수수료, 정책 override, 실행 지연, 체결 차이는 남음 |
| B2B signal contribution 계약 | 이미 포트폴리오·실행 능력이 있는 fund/prop / 기존 포트폴리오에 추가할 예측 데이터 | 고정 데이터료·성과/한계기여도 보상 등 계약 | 입력 데이터·모델 코드는 creator에 남고 예측만 전달 가능 | buyer가 혼합, 중립화, 위험관리, 체결 | buyer가 기존 signal/포트폴리오 대비 한계기여를 평가. creator standalone PnL을 구매한다고 주장하지 않음 |

**추론:** 이 컨셉을 유지한다면 seller를 “private decision function과 가용성을 공급하는 strategy operator”, buyer를 “특정 위험 범위·버전에 자본을 위임하는 allocator”, transaction을 “조건부 운용 mandate + NAV 지분 + 보수”로 먼저 정의하는 편이 일관적이다. ZK는 이 mandate의 일부 실행 조건을 검증하는 수단일 뿐 소유권·수익성·운용면허를 만들지 않는다. [M1][M2][M9][M12][M14]

## B. 실제 상품과 고객 행동

### Darwinex / DARWIN — 가장 직접적인 선례

- **사실:** DARWIN은 trader 전략에 독립 risk engine을 결합한다. 주문을 복제하되 investor 포지션 크기는 Darwinex가 조정한다. 공식 목표 범위는 월간 95% VaR 3.25–6.5%이며 이는 손실 한도를 보장하는 표현으로 해석하면 안 된다. [M1][M4]
- **사실:** “this process takes place **without revealing the trade details** so as to protect the intellectual property of our traders.” 소스코드 공개를 구매 조건으로 설명하지 않는다. [M1]
- **사실:** 최소 투자액은 wallet 통화 200 EUR/USD/GBP. 문서상 기본 최대 100,000, 초과는 별도 문의. 관리보수 연 1.2%; 성과보수 20%, 그중 creator 15%, Darwinex 5%; 분기별 high-water mark. 이는 조회 시점의 문서상 조건이며 모든 관할·상품에 일반화하지 않는다. Global/FSA 고객은 DARWIN 투자가 제공되지 않는다고 명시한다. [M3]
- **사실, 업체 자체 발표:** “So far we've paid DARWIN providers **in excess of $5 million in performance fees**.” 실제 인접 상품의 보수 지급 주장이다. 이 페이지는 지급 내역을 Hall of Fame에서 공개한다고 말하지만 이번 조사에서는 개별 지급을 대조·감사하지 않았다. [M2]
- **사실:** 최근 3개 포지션은 숨기며, trading journal 전체와 거래 자산 통계까지 숨기는 옵션이 있다. 동시에 “some investors could choose **not to invest** ... if ... hiding too much trading info”라고 경고한다. 비밀 유지에 상품성 비용이 있음을 공급자가 직접 인정한다. [M5]
- **사실:** selection 문서는 수년의 track record, Darwinex 자체 거래 수개월, 위험 안정성·손실 회피 특성, 자산·보유 기간 다양화, creator 자본, 상관관계를 보라고 한다. 이는 실제 선택 기준을 제공하는 제품 설계의 증거이며 모든 고객이 이 기준으로 행동한다는 행동실험은 아니다. [M6]
- **사실:** 주문별 latency·slippage/return divergence와 capacity 지표를 제공한다. 거래량 증가가 체결 격차의 주원인이라고 설명한다. [M7]
- **추론:** source secrecy 자체는 fatal하지 않다. 독립 위험 제한, 추적 가능한 운용 기록, 실제 체결 성과, 수수료·법적 운용 구조가 함께 있어야 한다. 현재 컨셉의 강한 경쟁 대안은 “아무 보장 없는 PDF backtest”보다 이런 trusted managed execution 서비스다.

### eToro CopyTrader — 개인의 위임 행동은 있으나 ZK 유료 수요와 다르다

- **사실:** 투자자는 다른 trader의 포지션을 자기 포트폴리오에 비례 복제한다. 최소 $200, 복제 포지션 최소 $1; $1 미만 포지션은 열리지 않는다. 한 번에 최대 100명의 trader를 선택할 수 있다고 한다. [M8]
- **사실:** CopyTrader 추가 사용료는 없다. 적용되는 거래 수수료·spread는 남는다. Popular Investor는 승인된 프로그램 참가자일 때 플랫폼으로부터 지급받는다. [M8]
- **사실:** 제품은 전략 코드를 제시하기보다 transparent track record, 위험 수준, 실시간 포지션 복제를 전면에 내세운다. [M8]
- **추론:** “개인도 다른 사람의 재량/전략에 자본을 배정한다”는 인접 행동 근거다. 하지만 무료 복제 기능 이용을 private quant signal 구독료 또는 ZK 프리미엄 지불로 세면 안 된다.
- **unknown:** 이 조사에서는 실제 copying 활성 사용자 수, private quant 전략에 대한 별도 유료 전환율을 검증하지 못했다.

### Numerai Signals — 알파 기여도를 사고 코드 구매를 피하는 구조

- **사실:** 제출자는 자기 데이터·모델로 ticker별 숫자 prediction을 제공한다. “Numerai does not view the code ... Numerai only receives the predictions themselves.” [M9]
- **사실:** Numerai는 기존 signal에 대해 제출 signal을 neutralize해 자신이 아직 갖지 못한 성분을 평가한다. 기존 집합에 Barra 스타일 요인, 국가·섹터 요인, custom feature가 포함된다고 설명한다. standalone 예측력이 강해도 기존 signal과 겹치면 낮게 평가될 수 있다. [M9][M10]
- **사실:** 모델에 NMR을 stake해 성과에 따라 earn/burn할 수 있다. 이 권리가 Numerai fund 지분이나 수수료에 대한 청구권은 아니며, payout은 비공개 target과 재량을 따른다고 명시한다. 일반적인 buyer-capital vault와 다르다. [M9]
- **사실:** Scoring 문서의 **The Target** 절은 dataset에 **20D2L와 60D2L target을 제공**한다고 명시하며, 짧은 시계열 signal은 대형 펀드가 포지션을 만드는 시간 때문에 사용하기 어렵다고 설명한다. 이는 두 target이 모두 현재 payout을 결정한다는 뜻이 아니다. 조회 시점 문서 상단은 payout score를 **Alpha와 Meta Portfolio Contribution (MPC)**로 구분하고, **NCORR·NMMC는 연구용 표시이며 현재 payout을 결정하지 않는다**고 명시한다. Leaderboard 자격은 완전히 확정된 60일 NCORR·NMMC reputation에 기반한다. [M10]
- **사실:** 제공된 diagnostic만으로 좋은 signal인지 보장할 수 없고 validation overfit이 쉬우므로 stake 없이 timely live submission을 지속해 보라고 안내한다. [M9][M10]
- **추론:** 모든 구매자가 독창적인 “전략 작품”을 소유해야 하는 것은 아니다. 자신의 포트폴리오에 추가하는 신호의 한계기여를 구매하면 코드 공개나 세계 최초 발명 인증 없이 거래가 가능하다.
- **unknown:** Numerai 사례로 crypto allocator의 예산, ZK 수요, 일반 marketplace의 양면 유동성을 추정할 수 없다.

### Hyperliquid vaults — 가장 명확한 자본 풀/성과 귀속 사례

- **사실:** 현재 공식 문서는 HyperCore user vaults를 **legacy**로 분류하고, HyperEVM에서 CoreWriter와 precompile을 이용해 vault를 만들고 tokenize할 수 있다고 설명한다. 이는 공식 제품 분류이며 legacy 종료일이나 기존 vault 운용 중단을 뜻한다고 확대하지 않는다. [M11]
- **사실:** legacy user vault depositor는 해당 vault의 이익·손실 지분을 받는다. 리더는 10% profit share; 리더 지분은 vault의 5% 이상 유지하도록 문서에 명시된다. user vault 출금에는 1일 lockup이 있다. [M12][M13]
- **사실:** depositor 화면에 APY, TVL, PnL, max drawdown, volume, **open positions and trade history**, depositor 수와 참여 기간을 제공한다고 명시한다. 따라서 strategy code를 공개하지 않아도 운용 출력은 상당히 공개되는 구조다. [M12]
- **사실:** 출금 처리 중 margin 부족 시 주문 취소·포지션 청산이 발생할 수 있다. 동일 전략이라도 실제 자본·출금 조건이 상태 변화의 입력이 된다. [M13]
- **추론:** shared vault NAV는 signal seller와 buyer 계좌별 수익률 분쟁을 줄일 자연스러운 단위다. 그러나 strategy secrecy를 onchain order-flow secrecy로 잘못 확장하면 안 된다.
- **unknown:** 특정 third-party private quant vault의 수수료 지급액·유료 수요는 이번 조사에서 온체인 대조하지 않았다. HLP 존재만으로 독립 creator marketplace 수요를 확정하지 않는다.

### dHEDGE → Chamber / Enzyme — 운용 인프라와 전략 상품을 구분

- **사실:** dHEDGE 공식 docs는 Chamber로 redirect되며 별도 rebrand 문서는 “Same team, same core contracts, same DAO”, 기존 vault 주소·shares·holdings·manager의 연속성과 migration 불필요를 명시한다. 사업 실패/중단의 근거가 아니다. [M14]
- **사실:** Chamber는 manager 운용 권한을 onchain guard로 제한하는 vault 구조다. 관리·성과·입출금 수수료가 있고, 문서상 manager 보수의 10%는 protocol 몫이다. performance fee는 vault-level HWM, 신규 shares 발행을 통한 dilution으로 정산되므로 개인별 원가 기준 성과보수와 다르다. [M15]
- **사실:** leaderboard는 `Sortino × sqrt(7-day average vault value)`를 사용한다고 공개한다. 자체 문서는 score가 상관관계·manager 변경을 포착하지 못하고 risk score는 tail risk·contract risk를 포착하지 못한다고 명시한다. [M16]
- **사실:** Enzyme는 vault ownership과 configurable fee framework를 공식 문서에서 제공한다. fee 문서는 Blue 경로에서 Onyx 명칭을 섞어 쓰므로 이 조사에서는 세대별 구체 fee 제약을 확정하지 않는다. [M17][M18]
- **추론:** vault가 구현 가능하다는 증거와 검증된 alpha 전략에 투자자가 유입된다는 증거는 별개다. 플랫폼 infrastructure TVL 전부를 “private quant strategy 시장”으로 집계하면 안 된다.

### Collective2 — 연결 구조 확인, 현재 가격·지급 규모는 미검증

- **사실:** 현재 QuantConnect 공식 통합 문서는 Collective2를 strategy developer와 capital allocator 연결 서비스라고 정의하며 live algorithm에서 trading signal을 전송하는 기능을 제공한다. target 전송은 기본적으로 fill 후 5초 동안 holdings 변경을 모아 전송한다. 원 signal과 subscriber 체결이 같은 사건이 아니라는 점을 보여주는 구체 실행 경계다. [M19]
- **사실:** Collective2 본인 GitHub의 QuantData는 equity, closed trades, trading signals, leverage, max open loss와 strategy score 데이터를 공개하던 프로젝트였으며 현재 README에 “This project is no longer supported.”라고 적혀 있다. 이 말은 QuantData 프로젝트의 지원 상태이지 Collective2 전체 서비스 종료가 아니다. [M20]
- **unknown:** Collective2 본체·support 페이지는 HTTP 403으로 조회하지 못했다. 현재 구독료, creator 수익 분배, subscriber 수, paid revenue는 확인하지 못했으므로 익숙한 과거 수치로 채우지 않는다.

### QuantConnect Alpha Streams — 역사적 선례, 현재 운영으로 세지 않음

- **사실:** 공식 Documentation repository에 남은 landing 문서는 “quants offer their Alpha (algorithms) for licensing”, “QuantConnect acts as an independent third-party ... run it out-of-sample ... live market data”라고 설명한다. creator 설계 → QC review/host → investor license 구조였다. [M21]
- **사실:** 공식 SDK repository는 Python/C# API와 portfolio-analysis notebooks를 제공한다. [M22]
- **사실:** 현행 `/alpha`와 과거 docs 경로는 정상 상품 페이지를 반환하지 않았다. 공식 2022-03-24 docs commit에는 `outdated-alpha-streams-product`에서 관련 참조 제거, 2022-09-19 LEAN PR에는 “Remove redundant, depreciated Alpha Stream SDK requirements”가 있다. [M23][M24]
- **추론:** 현재 살아 있는 유료 양면 marketplace의 성공 근거로 사용할 수 없다. 역사적으로 코드 대신 hosted signal을 license하려 한 선례로만 사용할 수 있다.
- **unknown:** Alpha Streams의 정확한 서비스 종료일·사업적 실패 원인·유료 기관 고객 수는 이 근거로 확정할 수 없다. SDK 제거를 marketplace failure 인과증거로 쓰면 안 된다.

## C. 비공개 전략의 실사: 코드 비공개와 경제적 특성 비공개는 다르다

### 같은 수익률이면 무엇을 비교하는가

**추론, 권장 최소 공개 계약:** 동일한 관측 기간·가격 시점·fee 기준에서 계산한 net return stream, drawdown depth/duration, realized volatility, Sharpe/Sortino 계산 규칙, turnover와 비용 민감도, gross/net exposure, leverage와 margin 사용, asset universe, holding period, age/버전, backtest/forward/live 출처, 실제 운영 자본과 capacity, missed decisions/정책 override, creator 이력을 비교해야 한다. 위험 envelope와 자본 출금 조건은 관측 통계와 별도로 계약·집행해야 한다. 실제 서비스들이 이 중 여러 요소를 사용하며, single leaderboard score의 한계도 명시한다. [M6][M7][M12][M16]

**추론:** 수익률이 비슷해도 buyer의 기존 포트폴리오에 낮은 상관을 갖고, 낮은 비용으로 규모를 늘릴 수 있으며, 스트레스 구간에서 손실이 덜 겹치는 전략의 경제적 가치는 다르다. 어느 전략이 “더 좋은가”는 standalone Sharpe 순위만으로 결정되지 않는다. Numerai는 이 한계기여 문제를 명시적으로 제품화했다. [M9][M10]

### 코드 없이 correlation / factor exposure를 평가할 수 있는가

- **사실:** Darwinex는 DARWIN return series 사이 correlation tab과 보유 DARWIN들의 correlation matrix를 제공한다. 공식 계산은 최근 3개월이고, correlation은 시간이 지나면 달라진다고 경고한다. 따라서 코드 비공개 자체가 historical correlation 계산의 장애물은 아니다. [M25]
- **사실:** Numerai는 코드가 아니라 prediction vector를 받고, 기존 factor/stock signal에 neutralize한 성분을 평가한다. [M9][M10]
- **추론:** 양쪽의 동기화된 일별 net return series가 있으면 portfolio correlation과 공개 factor에 대한 회귀 추정이 가능하다. 공개/지연된 position·exposure가 있으면 위험 요인의 해석이 개선된다. 이것은 과거 표본의 추정이며 미래 위기상관, 비선형 tail exposure, 아직 경험하지 않은 손실, off-platform 포지션을 완전하게 식별하지 못한다.
- **추론:** 단순 historical PnL correlation 공개는 첫 제품에서 구현할 수 있다. 정확한 시점·valuation·완전성 검증이 없는 자기기입 PnL에 ZK 계산을 붙여도 양질의 실사 자료가 되지 않는다.
- **추론:** buyer 자신의 수익률은 로컬에 두고 marketplace의 signed return stream을 내려받아 correlation을 계산하면 buyer portfolio 비밀을 상당 부분 유지할 수 있다. marketplace 자료의 공개 범위를 줄이려면 지연·bucketed exposure·선택적 NDA 공개·독립 risk auditor 같은 운영 대안을 먼저 검토할 수 있다.
- **unknown:** 양쪽 return stream을 모두 숨기는 MPC/ZK correlation 서비스의 실용 비용·입력 출처·data availability·반복 query를 통한 정보 유출은 이번 시장 조사에서 실증하지 않았다. “privacy-preserving DD가 해결된다”는 완료된 기능으로 제시하면 안 된다.

### 기존 전략과 유사한가, 독창성을 검증할 수 있는가

- **추론:** 특정 return/exposure 표본에서 특정 benchmark와 유사하다는 것은 테스트할 수 있다. 코드의 동일성, 전략 아이디어의 표절, 세계의 모든 기존 전략 대비 독창성을 뜻하지 않는다. 다른 로직이 같은 거래를 만들 수도 있고, 같은 로직이 다른 asset·파라미터·leverage로 다른 PnL을 만들 수도 있다.
- **사실:** Numerai가 공개적으로 약속하는 것은 자신의 기존 signal 집합에 대한 orthogonal component 평가다. 이는 세계 전체 전략에 대한 독창성 인증보다 훨씬 제한된 문제다. [M10]
- **추론:** “세계 최초 전략 NFT/독점 alpha 구매”를 팔려면 독창성 입증 부재가 치명적이다. “비공개 시스템의 일관된 운용·관측 가능한 특성에 자본 배정”을 팔면 독창성 인증은 필수가 아니다. 다만 buyer가 diversification을 원한다면 correlation·exposure·version drift를 평가할 최소 정보가 전혀 없다는 것은 allocation 품질을 무너뜨릴 수 있다.

### 기관은 source 없이 due diligence를 할 수 있는가

- **사실:** AIMA는 DDQ를 실사의 초기 단계이며 마지막 단계가 아니라고 설명한다. 답변으로 후속 질문과 타 출처 cross-check를 하고, Overview·Governance·Operations and Risk Management 모듈을 둔다. [M26]
- **추론:** source code confidentiality는 기관 실사의 모든 측면을 불가능하게 만들지 않는다. 하지만 법인/실소유·책임 구조, 투자 mandate, custodian/venue, valuation, 권한·자본 인출 통제, 장애 대응, 재해복구, 독립 위험 제한, 비용·capacity, 데이터 권리와 strategy 변경 프로세스까지 “private”로 가리면 일반적 기관 실사를 충족한다고 보기 어렵다. ZK execution correctness는 이 항목들을 대신하지 않는다.
- **추론:** early buyer는 “기관” 전체보다 **crypto 실행과 custody를 이미 이해하며 제한된 시험 배정을 할 수 있는 소규모 전문 allocator** 또는 **자신의 집행 시스템을 보유한 signal buyer**처럼 좁혀야 한다. prop은 pooled vault보다 signal/target 계약을 선호할 가능성이 있으나 인터뷰 없는 가설이다.
- **unknown:** 해당 고객군이 creator source 접근 대신 proof+공개 envelope+독립 audit를 수용하는지, 투자 최소 기간·자본·보수를 얼마나 요구하는지 아직 검증하지 않았다.

## 제품 의사결정에 남겨야 할 가정

| 검증할 가정 | supporting evidence | contradicting / 제한 evidence | 현재 판정 |
|---|---|---|---|
| 코드를 안 보여도 자본을 받을 수 있다 | DARWIN 비공개 복제·creator $5M+ 지급 주장; vault/copy/signal 상품 | Darwinex 자체가 과도한 privacy는 투자자를 잃을 수 있다고 명시 | 좁은 의미로 지지. 완전한 경제정보 비공개는 지지 못함 |
| ZK execution integrity에 buyer가 추가 보수/마찰을 감수한다 | 자료에서 직접 근거 없음 | 경쟁자는 trusted execution, risk manager, onchain guard로 서비스 | **unknown; 유료 고객 실험 필요** |
| allocator가 정보공개 범위 안에서 합리적 선택을 할 수 있다 | Darwinex return correlation, Numerai neutralization, vault positions | 역사 표본·tail risk·regime 변화·운영 DD는 남음 | 제한 공개 계약 필요; “완전 opaque”는 기각 |
| retail이 자연스러운 초기 수익원이다 | $200 DARWIN/CopyTrader 진입 구조 존재 | eToro 복제 자체 무료; 작은 자본은 고정 운영비를 흡수하기 어려움 | 증거 부족. low-ticket retail부터 시작할 근거 약함 |
| 독창성 인증이 없어도 제품이 성립한다 | signal 기여도·운용 지분 거래 선례 | exclusive original alpha 판매라면 계약 가치가 흔들림 | 운용 서비스로 정의하면 필수 기능 아님 |

## 출처 목록과 직접 인용

모두 2026-09-16 조회. 링크 상태와 문서 표현만 확인한 자료는 실제 고객 행동·독립 감사의 증거로 과장하지 않았다.

- **[M1]** Darwinex, [What is a DARWIN?](https://help.darwinex.com/what-is-a-darwin). “The DARWIN automatically replicates trades ... without revealing the trade details”; risk-engine sizing.
- **[M2]** Darwinex, [Performance Fees for DARWIN providers](https://help.darwinex.com/performance-fees-darwin-provider). “15% is for you, 5% for Darwinex”; “in excess of $5 million in performance fees.” 업체 자체 지급 주장.
- **[M3]** Darwinex, [DARWIN Investment Conditions](https://help.darwinex.com/investments-costs). 200 minimum, 100,000 default maximum, 1.2% management, 20% HWM performance fee. Quote·divergence 표현은 M7과 일부 시기 차이가 있어 final investor net return을 별도로 명시해야 한다.
- **[M4]** Darwinex, [How the Risk Engine works](https://help.darwinex.com/risk-manager). Independent risk layer, investor leverage sizing, risk standardization.
- **[M5]** Darwinex, [3 levels to protect your intellectual property](https://help.darwinex.com/3-levels-protect-intellectual-property). “some investors could choose not to invest ... hiding too much trading info.”
- **[M6]** Darwinex, [How to select DARWINs for investing](https://help.darwinex.com/select-darwins-for-investing). Years of record, months with Darwinex, risk stability, loss aversion, correlation, assets, holding time.
- **[M7]** Darwinex, [What is divergence?](https://help.darwinex.com/divergence). Latency and investor volume; “it is impossible to replicate both traders' and investors' trades identically”; demo depth differs from live. 이 문서의 현재 net-of-divergence 표시 설명과 M3의 theoretical quote 설명을 혼합하지 않았다.
- **[M8]** eToro, [CopyTrader](https://www.etoro.com/copytrader/). No additional copying charge, $200 minimum, $1 minimum position, Popular Investor program payment.
- **[M9]** Numerai, [Signals Overview](https://docs.numer.ai/numerai-signals/signals-overview). “Numerai only receives the predictions themselves”; submission/staking/neutralization; fund ownership와 구분.
- **[M10]** Numerai, [Signals Scoring](https://docs.numer.ai/numerai-signals/scoring). “isolate the original or orthogonal component ... not already present in existing signals”; Barra/country/sector/custom features; overfitting warning and long-horizon execution constraint.
- **[M11]** Hyperliquid, [Vaults](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults). HyperEVM/CoreWriter/precompile vault accounting; legacy HyperCore 분류.
- **[M12]** Hyperliquid, [For vault depositors (legacy)](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-depositors-legacy). Profit/loss shares; open positions/trade history; 1-day user-vault lockup.
- **[M13]** Hyperliquid, [For vault leaders (legacy)](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders-legacy). 10% profit share, minimum 5% leader stake, withdrawal-triggered cancel/close rules.
- **[M14]** Chamber, [dHEDGE → Chamber](https://docs.chamberfi.com/introduction/dhedge-to-chamber). “Same team, same core contracts, same DAO”; existing vaults continue, no migration required.
- **[M15]** Chamber, [Fees & performance](https://docs.chamberfi.com/manage/fees-performance). Four fee types, 90/10 split, vault-level HWM and dilution.
- **[M16]** Chamber, [Leaderboard & ranking](https://docs.chamberfi.com/concepts/leaderboard-ranking). Formula and explicit missing correlation/tail risk/strategy changes/contract risk.
- **[M17]** Enzyme, [Fee](https://docs.enzyme.finance/user-documentation/blue-enzyme-vaults/editor/fee). Configurable fees; Blue/Onyx wording inconsistency noted.
- **[M18]** Enzyme, [Ownership](https://docs.enzyme.finance/user-documentation/blue-enzyme-vaults/editor/ownership). Owner wallet/Safe.
- **[M19]** QuantConnect, [Collective2 signal export](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/signal-exports/collective2). Current integration and portfolio-target timing; primary integration owner's documentation, not Collective2 prices.
- **[M20]** Collective2, [QuantData README](https://github.com/collective2/QuantData), [QuantData contents](https://github.com/collective2/QuantData/blob/main/QuantData_Content.ipynb). Official repository; project unsupported, historical metrics/data schema.
- **[M21]** QuantConnect, [Alpha Streams landing document in official source](https://github.com/QuantConnect/Documentation/blob/master/Resources/landing-page-introductions/alpha-streams-market.html). Hosting/licensing model; current market operation unverified.
- **[M22]** QuantConnect, [AlphaStreams SDK](https://github.com/QuantConnect/AlphaStreams). Historical API and portfolio-analysis interface; repository existence is not active commercial availability.
- **[M23]** QuantConnect, [Remove Alpha Streams references, 2022-03-24 commit](https://github.com/QuantConnect/Documentation/commit/d1b161c1fab7630b2b60ee6c34acdb61d6ef27ad).
- **[M24]** QuantConnect, [LEAN PR #6638](https://github.com/QuantConnect/Lean/pull/6638), merged 2022-09-19. “Remove redundant, depreciated Alpha Stream SDK requirements in Docker files.”
- **[M25]** Darwinex, [Correlation between DARWINs](https://help.darwinex.com/correlation-between-darwins). Return-series correlation matrix; rolling recent 3-month calculation; correlation changes.
- **[M26]** AIMA, [Due Diligence Questionnaires](https://www.aima.org/sound-practices/due-diligence-questionnaires.html). “an early step ... by no means ... the last step”; governance/operations/risk modules.
