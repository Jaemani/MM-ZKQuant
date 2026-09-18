# 외부·커스텀 알파 데이터 실현 가능성

확인일: 2026-09-17. 공식 문서·공식 저장소·공개 API를 직접 조회했다. 아래는 데이터 조달 검증이며, 수익성 검증이나 플랫폼 실행 지원 판정은 아니다. 인증이 필요한 유료 API 호출·실거래는 수행하지 않았다.

## 핵심 구분

**외부 데이터**는 공급자가 만든 관측값(펀딩·지수·공급량·언락 일정)이다. **커스텀 데이터**는 직접 정의한 계산·라벨·모델로 만든 피처(거래소 순유입, 공지 감성 점수)다. Dune이나 LLM을 사용한다고 데이터가 자동으로 과거 시점에 사용 가능했던 것은 아니다.

과거 시점 재현(point-in-time, PIT)을 위해 `event_time`과 `available_at`을 구분한다. 현재 조회한 과거 관측치에는 과거 `available_at`을 임의로 붙이지 않는다. 공급자의 과거 배포 기록이 없으면 현재 수집 시각을 기록하고, 별도로 보수적인 지연을 가정한 연구 결과는 **PIT 미검증**으로 표시한다. 단순 하루 shift는 수정 이력·라벨 누출을 해결하지 않는다.

## 1. Binance 펀딩·미결제약정(OI): 외부

- [펀딩 API](https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2), [OI API](https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1d&limit=2)를 직접 조회해 HTTP 200과 실제 2개 관측치를 확인했다. 펀딩은 `fundingTime`, `fundingRate`, `markPrice`; OI는 `timestamp`, `sumOpenInterest`, `sumOpenInterestValue`를 제공했다.
- 공식 [Python 커넥터 소스](https://github.com/binance/binance-futures-connector-python/blob/main/binance/um_futures/market.py)의 `open_interest_hist` 문서는 5분~1일 주기, 최대 500개, **최근 30일만 제공**한다고 명시한다. 이 REST 경로만으로 수년 OI 백테스트를 채우면 안 된다. 별도 공식 아카이브의 범위 검증이나 장기 자체 수집이 필요하다.
- [펀딩 문서](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [OI 문서](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics)는 이번 요청에서 HTTP 202 빈 본문이어서 제약은 공식 소스로 교차 확인했다.
- 후보: 과열 펀딩 + OI 급증 뒤 가격 모멘텀 둔화 시 포지션 축소/조건부 역추세. 확정 펀딩을 해당 정산 전에 알고 있었던 값처럼 사용하지 않는다. OI USD 증가는 가격 상승만으로도 발생하므로 수량 OI 변화와 구분한다.
- 현황: 단기 실데이터 수집 가능. 장기 PIT 백테스트는 추가 확보 필요. 조회 성공을 데이터 재배포 허가로 해석할 수 없으며 재배포·상업 이용 조건은 미확인.

## 2. Alternative.me 공포·탐욕: 외부

- [공식 API 규칙](https://alternative.me/crypto/fear-and-greed-index/)과 [실제 API](https://api.alternative.me/fng/?limit=2) 모두 HTTP 200. 실제 응답은 `value`, `value_classification`, `timestamp`, 최신 값의 `time_until_update`를 포함했다. 문서상 `limit=0`은 전체 이력 조회다.
- 후보: 극단 공포 뒤 가격 추세 회복을 확인한 BTC 위험 예산 확대. 지수 자체가 가격·거래량 등을 포함하므로 독립적인 정보 우위로 간주하지 말고 가격만 사용하는 기준 전략과 비교한다.
- PIT: 날짜 timestamp는 당일 정확한 배포·수신 시각이나 수정 버전을 증명하지 않는다. 앞으로 원본 응답과 수집 시각을 저장한다. 기존 이력에 하루 지연을 줘도 PIT 인증은 아니다.
- 이용 조건: 공식 페이지는 **데이터 표시 바로 옆 출처 표기 시 상업 이용 허용**, 원 제공자로 오인시키는 사용 금지를 명시한다. 플랫폼의 원자료 표시·배포 형태가 이 조건에 맞는지 확인한다.
- 현황: 공개 이력 확보 및 전향적 수집에 가장 간단한 후보. 광범위한 개별 코인의 감성 지수로 해석하지 않는다.

## 3. DefiLlama 스테이블코인 공급량: 외부

- [전체 시계열 API](https://stablecoins.llama.fi/stablecoincharts/all)를 직접 조회해 HTTP 200, 3,215개 날짜 관측치와 `totalCirculating`, `totalCirculatingUSD` 등을 확인했다. 날짜 범위·개수는 조회 시점에 따라 달라진다. [API 문서](https://api-docs.defillama.com/)는 이번 환경에서 HTTP 403이었다.
- 공식 [peggedassets-server](https://github.com/DefiLlama/peggedassets-server) README는 자산별 어댑터, minted·unreleased·bridged 분류를 설명한다. 체인별 총량 단순 합산은 브리지 처리 정의를 먼저 확인해야 한다.
- 후보: `totalCirculating.peggedUSD`의 7일/30일 공급 증가를 BTC 추세 전략의 시장 유동성 조건으로 사용한다. 서로 다른 통화 단위의 `totalCirculating` 값을 더하지 않는다. `totalCirculatingUSD`는 가격·환율 변화도 포함하므로 순발행과 같지 않다.
- PIT: 현재 전체 이력은 과거에 배포된 버전의 보관소가 아니다. 토큰 커버리지·어댑터 변경에 대비해 응답 원본, 자산 목록, 방법론 버전, 수집 시각을 고정한다.
- 현황: 실데이터 확보 가능. 과거 배포 버전과 데이터 재배포·상업 이용 조건은 이번 조사에서 확인하지 못했다. 오픈소스 코드의 공개 여부가 API 데이터 권리까지 보장하지 않는다.

## 4. Dune 거래소 순유입: 외부 원천 + 커스텀 SQL·라벨

- [공식 라벨 문서](https://docs.dune.com/data-catalog/curated/labels/overview.md)는 `labels.addresses`, `cex.addresses`, `tokens.transfers`, `cex.flows`를 설명하며, 수작업 seed·자동 분석·커뮤니티 기여를 통한 라벨 유지 방식을 명시한다. 문서 HTTP 200 확인. 인증된 SQL 실행·결과 다운로드는 수행하지 않았다.
- 후보: 자산별 `(거래소 외부→거래소 유입 − 거래소→외부 유출) / 과거 거래량`의 robust z-score. 거래소 내부 이동, 동일 소유자 지갑 이동, 브리지·민트/번을 명시적으로 처리한다. Ethereum WBTC 순유입과 Bitcoin 네이티브 BTC 순유입은 다른 데이터다.
- PIT 핵심: 오늘 알려진 거래소 주소를 과거 모든 블록에 붙이면 주소 식별 정보가 누출된다. `label_known_at`, 라벨 버전, 유효 기간, 원본 출처를 보관하고 판단 시각 이전에 알려진 라벨만 조인해야 한다. 공식 문서에서 완전한 과거 라벨 버전 API는 확인하지 못했다. Spellbook git 이력만으로 모든 라벨의 실제 공개 시점을 복원할 수 있다고 보장하지 않는다.
- [실행 결과 문서](https://docs.dune.com/api-reference/executions/endpoint/get-execution-result)는 결과 보관 **90일**, `expires_at`, 대용량 결과 부분 반환 가능성을 명시한다. `execution_id`, SQL hash, 결과 hash와 파일을 자체 보관해야 재현이 가능하다.
- 현황: 자체 SQL·라벨 정책을 정의해야 하는 커스텀 파이프라인. API 플랜·쿼리 크레딧 및 결과 재배포 권한은 별도 확인. 준비된 공개 PIT 순유입 피처로 분류하면 안 된다.

## 5. Tokenomist 언락 / 발행사 공지: 외부 + 커스텀 이벤트 정규화

- [Unlock Events v5 공식 명세](https://docs.tokenomist.ai/api-documents/unlock-events/v5.md) HTTP 200. `GET /v5/unlock/events/{tokenId}`는 cliff 이벤트이며 `unlockDate`, `cliffAmount`, `cliffValue`, `valueToMarketCap`, 배분 내역, `latestUpdateDate` 등을 정의한다. linear emission은 [Daily Emission](https://docs.tokenomist.ai/api-documents/daily-emission/v5.md)이라는 별도 데이터군으로 구분한다.
- [인증 문서](https://docs.tokenomist.ai/api-documents/authentication.md)는 HTTPS와 `x-api-key`를 요구한다. 인증된 데이터 접근은 검증하지 않았으며 문서 예시는 실수집 관측치가 아니다.
- 후보: 알려진 향후 7일 팀/투자자 언락 수량을 당시 유통량·평균 거래량으로 나눠 공급 부담이 큰 코인의 비중 축소 또는 헤지. 언락은 실제 매도와 같지 않으므로 실현 매도 압력으로 단정하지 않는다.
- PIT: `unlockDate`는 이벤트 시각, `latestUpdateDate`는 최신 수정 시각으로 과거 일정 버전 전체가 아니다. 미래 언락 일정을 사용하는 것은 판단 시각 전에 공개된 일정에 한해 가능하다. 현재 수정된 일정을 과거 공지 내용으로 재사용하면 안 된다. 날짜별 원본 스냅샷 또는 발행사 원문·최초 수신 시각·수정 이력이 필요하다. 현재 USD 가치나 유통량을 과거 분모로 재사용하지 않는다.
- 현황: API 키·계약 및 과거 버전 데이터 확보 전에는 조달 준비 단계. 발행사 공지 직접 수집은 대안이나 토큰별 공식 출처와 변경 추적 구현이 필요하다. 상업 이용·재배포 권리는 이번 조사에서 확인하지 못했다.

## 6. 고정 텍스트 감성 모델: 외부 텍스트 + 커스텀 추론 피처

- [ProsusAI FinBERT 모델 카드](https://huggingface.co/ProsusAI/finbert/raw/main/README.md) HTTP 200. 영어 금융 텍스트, Financial PhraseBank 미세조정, positive/negative/neutral softmax 출력이 설명되어 있다. [공식 코드 라이선스](https://github.com/ProsusAI/finBERT/blob/master/LICENSE)는 Apache-2.0이다. 이 사실로 뉴스 원문·학습 데이터·별도 배포 가중치의 모든 이용 권리를 일괄 인정하지 않는다.
- 후보: 공식 프로토콜 공지/RSS 또는 사용 권한이 있는 뉴스에서 `p_positive − p_negative`를 계산하고 과거 평균 대비 변화량을 가격 돌파의 확인 조건으로 사용한다. crypto·한국어 적합성은 별도 검증 대상이다.
- 커스텀 재현 계약: 입력 텍스트 hash, 최초 수신 시각, 기사 버전, 중복·재게시 규칙, 종목 매핑 버전, 모델 revision/weights hash, tokenizer·전처리 버전, 추론 설정을 고정한다. API LLM의 최신 응답을 매번 생성하는 방식은 동일 피처 재현을 보장하지 않는다.
- PIT: 원문에 적힌 발행일만 믿으면 사후 편집·백필이 누출된다. 모델 학습 자료의 시점도 고려한다. 과거 기간 후에 학습된 모델을 소급 적용한 성과를 당시 실현 가능한 성과로 설명하지 않는다. 고정 모델은 전향적 수집부터 평가하거나 학습 종료 시점이 검증된 버전을 사용한다.
- 현황: 공개 모델 존재 확인. 뉴스 조달 계약·crypto 평가셋·시점 정합 데이터는 구축 필요. 모델 카드 확인만으로 실행 가능한 감성 데이터셋이 생긴 것은 아니다.

## 플랫폼 검증에 연결할 제출 계약 제안

모든 피처 행은 최소 `asset`, `event_time`, `available_at`, `value`, `source`, `dataset_version`을 갖고, 데이터셋에는 `sha256`, 원본 위치, 단위, 시간대, 결측·지연 정책, 라이선스/출처 표시 메타데이터를 둔다. 커스텀 피처는 SQL/모델/라벨 버전을 추가한다. 이것은 권장 설계이며 현재 플랫폼이 지원한다는 주장이 아니다.

우선 실데이터 연결을 검증하기 좋은 후보는 Binance 펀딩, Alternative.me, DefiLlama다. 장기 OI, Dune 과거 라벨, 언락 과거 일정, 과거 뉴스 수신 이력은 별도 확보가 필요하다. 모든 후보의 경제적 가설은 수수료·슬리피지·펀딩·대차 비용과 분리된 미사용 기간으로 평가해야 하며, 여기에는 수익률·Sharpe를 제시하지 않는다.
