# 독립 심사 의견 — 제출 적격성·시장·스폰서

평가 시점: 2026-09-23. 역할: Onchain Finance & Trading 심사위원 중 제출물·사업성·스폰서 적합성을 보는 심사자. 현재 저장소의 코드·명세·증거와 사용자가 제공한 공식 안내를 기준으로 판단했다. 운영 인프라나 거래를 실행하지 않았고, 다른 심사자의 평가를 이 판단에 사용하지 않았다. 아래 점수는 실제 심사 점수나 수상 확률이 아닌 자체 추정 범위다.

## 판단

**문제와 기술 연구에는 경쟁력이 있다. 그러나 현재 제출 가능한 증거는 새 Perpl 상품의 완성된 사용 흐름보다 연구·참조 구현에 가깝다. 지금 자료 그대로라면 상위 수상 후보로 추천하기 어렵다.** 가장 큰 손실은 어려운 암호학 기술을 선택했다는 데 있지 않다. 심사자가 실제 제품을 실행하는 증거와, 누가 이것을 첫 번째로 쓰겠다는 증거를 아직 확인하기 어렵다는 점이다.

README는 새 프로토콜이 M0/M1 일부 단계라고 분명히 밝힌다 (`README.md:5`, `README.md:29`). 이 정직함은 장점이다. 예전 Monad 테스트넷 거래, 외부 현물 포크 ZK, 실제 TDX proving은 팀의 기술 실행 능력을 보여준다. 다만 각각은 새 Perpl 상품의 end-to-end 거래나 고객 사용으로 합산할 수 없다.

전체 M8·독립 감사·실자금 출시까지 해커톤 전에 완성할 필요는 없다. **테스트 자산으로 작동하는 제한된 Monad 제품 경로와 그 한계를 명확히 보여주면** 제출 평가를 크게 개선할 수 있다. 반대로 제품 명세를 전부 나열하거나 코드 walkthrough를 녹화하는 것으로 live 제품 데모 요건을 대신할 수 없다.

## 공식 기준별 추정

공식 가중치 출처: 아래 F1의 41–45행. 각 범위는 해당 배점 안의 점수이며 별도의 가중 계산을 다시 하지 않는다.

| 항목 | 배점 | 현재 추정 | 판단 근거 |
|---|---:|---:|---|
| Technical Execution | 20 | **8–11** | 실제 proof·TDX·기존 Monad 테스트 자산 실행 증거는 있다. 새 Perpl 계정 주문·회계·출금 파이프라인은 미완료. `docs/evidence/omnibus-testnet.json:3`, `docs/evidence/zk-book-verification.json:3`, `docs/evidence/tee-hardware-probe.json:3`, `docs/team-status.md:49` |
| Design & Craft | 20 | **5–8** | 위험과 프라이버시 범위를 문서에 구분한 점은 좋다. 하지만 기존 화면은 새 명세 제품이 아니라고 명시돼 있고, 심사자가 접근하는 새 live URL과 입출금·실패·가격 상태 경험을 확인하지 못했다. 시각 품질을 직접 검증하지 못했으므로 잠정 범위. `README.md:55`, `docs/specs/2026-09-23-product-v1.4.md:38` |
| Originality & Track Insight | 15 | **10–12** | 비공개 목표를 받되 투자자 자본 귀속·승인 조건·정산을 검증하는 금융 운용 구조는 분명한 문제 설정이다. TEE/ZK 조합 자체가 새롭다는 주장보다 실행 전 기밀성과 자본 권한을 분리한 사용 사례가 설득력 있다. 빠른 Monad settlement가 실제로 어떤 운용을 가능하게 하는지는 아직 성능 목표 중심. `README.md:3`, 제품 명세 `:28`, `:61`, `:671` |
| Founder & Market Readiness | 25 | **8–12** | Darwinex·vault·allocator의 비교와 비용 민감도 분석은 깊다. 하지만 첫 사용자를 실제 이름/팀 또는 검증 가능한 익명 프로필로 특정한 인터뷰·시험 의향·도입 조건이 확인되지 않았다. 팀 소개와 창업 적합성은 pitch 자료가 없어 평가가 제한된다. `research/zero-knowledge-alpha-market-thesis.md:52`, `:67`, `:69`, `:71` |
| Traction & Path Forward | 20 | **5–8** | 공식 기준은 simulated volume/소수 시험 거래도 인정한다. 따라서 기존 통제된 테스트 거래와 검증 결과를 0점 취급하지 않는다. 다만 외부 사용·Perpl 시험 거래·새 경로의 실행 기록·기한 있는 고객 확보 계획이 부족하다. 기술 역할 분배는 구체적이지만 TVL/volume·liquidity partner·launch 단계의 시장 계획과는 다르다. `docs/evidence/omnibus-testnet.json:7`, `docs/team-status.md:23`, `:49`, `docs/evidence/perpl-readonly.json:39` |
| **합계** | **100** | **36–51** | 중간값 기준 약 44점. 미확인 영상·live 제품·고객 자료가 제공되면 달라질 수 있다. |

테스트 개수는 시장 traction의 대체 지표가 아니다. 수익률도 이 프로토콜의 정당성이나 사용자 수요를 증명하지 않는다. Technical에는 실행을, Traction에는 실제로 사용/시험했다는 기록을 각각 인정하되 같은 proof를 두 항목의 “완제품·고객 채택”으로 중복 계산하지 않았다.

## 제출 필수 준비표

마감은 제공된 안내 기준 **2026-10-14 12:59 KST**다(F1:33). 현재 시점에서 남은 기간이 약 3주라는 사실이 전체 제품 완료를 의미하지는 않는다.

| 공식 요구 | 현재 확인 상태 | 제출 완료 조건 |
|---|---|---|
| Project/team 생성, primary 선택 | 저장소만으로 포털 제출 상태 미확인. 붙여넣기의 `2 of 5 done`를 최종 상태로 단정하지 않음 | 실제 포털에서 팀·프로젝트와 primary track 선택 완료 확인(F2:27–34) |
| Logo/graphic JPG/JPEG/PNG/WEBP, ≤3MB | 제출용 logo 파일·등록 사실 미확인. `docs/specs/protocol-architecture.png` 존재만으로 logo 요건 충족이라 보지 않음 | 허용 포맷·용량을 맞춘 식별 가능한 프로젝트 graphic 업로드(F1:48) |
| Public GitHub + `metropolis@hackathon.monad.xyz` 접근 | 이 평가자는 API를 직접 재확인하지 않았으나, 코디네이터의 공통 사실 확인에서 `gh repo view`의 `isPrivate=false`를 확인했다. 공개 상태는 확보, 심사 계정 접근은 미시험. `package.json`의 private 필드로 GitHub visibility를 추정하지 않음 | 로그아웃/심사자 접근 확인. README 첫 화면에 실행법·실제 제출 범위·live/video 링크(F1:49) |
| Live technical demo, 최대 3분 | 검색한 README/docs/src에 YouTube/Loom/Vimeo 제출 링크 미확인 | 실제 제품에서 입력→허용/거절→체결→장부 결과를 보여주는 영상. 슬라이드·코드 설명으로 대체 불가(F1:50) |
| Team/problem/why pitch, 최대 2분 | 제출 영상 링크·팀 소개 영상 미확인 | 팀, 구체적인 첫 사용자, 기존 해결책의 실패, 이번 동작 범위, 다음 사용 실험을 짧게 설명(F1:51) |
| Monad mainnet/testnet live product link + 접근법/필요 credentials | 이전 Monad 테스트넷 계약 증거는 존재. 새 Perpl 제품의 공개 UI/API·접근 안내는 미확인. localhost와 과거 TDX probe endpoint는 곧바로 제출용 제품 URL이 아님 | 심사자가 개발자 컴퓨터 없이 실행 가능한 URL, 체인/계약/테스트 자산 안내, 필요한 시험 계정·재설정법 제공(F1:52) |
| 30초 광고 | 선택, 점수 반영 안 됨 | 필수 자료 뒤에 작업. 현재 우선순위 아님(F1:53) |

“미확인”은 외부에 해당 자료가 없다는 뜻이 아니다. README·docs·src·protocol에서 영상 호스트/일반 배포 호스트/관련 파일명·고객 용어를 검색하고 확인한 범위다. 로컬 프로그램을 새로 실행하거나 외부 배포 URL을 추측하지 않았다. 이전 테스트넷 계약 주소만 제출하면 “사용 가능한 live product link”가 자동 충족되지는 않는다.

## 첫 사용자와 사업성

제품에는 Investor·Manager·TEE Operator·Keeper·Committee라는 역할이 정의돼 있다(제품 명세 `:68`). **역할 정의와 첫 고객 확보는 다르다.** 시장 연구가 제시한 “small fund/전문 allocator”는 합리적인 초기 후보군이지만 실제 첫 사용자의 증거는 아니다(`research/zero-knowledge-alpha-market-thesis.md:67`). 같은 연구는 유료 수요 미검증을 명시한다(`:71`).

심사자로서 가장 궁금한 것은 “ZK로 수익을 검증하나?”가 아니다. **현재 Perpl에서 운용하는 어떤 사람이, 어떤 상대방의 자본을 받을 때, 어떤 정보/권한 때문에 거래가 성립하지 않는가?** 전략 수익성 보장은 명시적으로 제외돼 있으므로 이를 판매 주장으로 바꾸면 제품 명세와 충돌한다(제품 명세 `:40`).

다음은 제안하는 증거 형식이며 현재 확보된 사실이 아니다:

- 운용자 1곳과 allocator 1곳의 실제 업무 흐름, 현재 도구, 목표 노출을 꺼리는 이유, 기존 공개 vault를 쓰지 않는 이유를 기록한다. 신원 공개가 어렵다면 인터뷰 일시·직무·의사결정권·동의한 인용을 남긴다.
- “운용 전 목표만 비밀이고 체결 후 포지션은 공개”라는 범위를 읽힌 뒤에도 시험하겠는지 확인한다. 모든 전략이 끝까지 비밀인 것으로 이해한 의향은 이 상품 수요가 아니다.
- 이번 해커톤 시험 조건을 한 페이지로 정한다. 예: 외부 운용자 한 명이 테스트 자산으로 목표 제출·부분체결·거절·출금 대기를 수행하고, 소요 시간과 실패/복구 기록을 리뷰한다. 숫자는 팀이 확정할 목표이지 현재 실적이 아니다.
- 플랫폼의 보수/운영비와 고객 비용을 분리한다. 성과보수 구조 자체는 존재하지만 매출·흑자 근거가 아니다. 작은 AUM의 보수 풀이 proving·TEE·지원비를 감당하는지는 기존 연구도 미확정으로 다룬다(`research/zero-knowledge-alpha-market-thesis.md:69`).

기술 계획은 이미 역할·검수 기준으로 구체화됐다(`docs/team-status.md:21`). 다음 사업 계획에는 누구와 언제 시험할지, 관찰할 행동이 무엇인지, 시험 실패 시 어떤 약속을 줄일지를 붙여야 한다. 자금 운용 제품의 법률 검토를 인지한 점은 긍정적이나(제품 명세 `:745`), 해커톤 테스트 자산 데모와 실자금 출시 적격성은 구분한다.

## Primary track와 스폰서 판단

**Primary 추천: Onchain Finance & Trading.** 주 사용자는 Manager/Investor이고 출력은 운용 권한·거래 실행·자본 귀속이라는 금융 메커니즘이다. 단지 ZK·TEE를 사용한다는 이유로 Trust, Identity & AI Infrastructure로 옮길 필요는 없다. Financial mechanism이 실제 작동하는지 보여주는 것이 이 트랙의 정면 요구다(F1:38, F2:35–45).

**Bounty 1순위 후보: Best use of Perpl’s API — 단, 현재 충족 판정은 불가.** 공식 요약은 “production-ready trading bot or automation system on Perpl”이다(F2:116–120). M0 문서·ABI 조사·read-only RPC 성공은 integration research이며 bot의 생산 준비 증거가 아니다. 실제 Perpl 주문 제출, stale/retry/idempotency, 부분체결, 실패·재시작 회복, 권한·키 관리, 가시적인 작동 데모가 필요하다. 이 보고서가 sponsor의 세부 `production-ready` 기준을 임의로 인증하지 않는다. 제공된 것은 bounty 요약이므로 제출 전 세부 페이지의 testnet/API 범위도 확인해야 한다.

**보조 후보: Perpl Best Analytics / Risk Tool — 실제 기능을 만든 경우에만.** 공식 요약은 Perpl에 집중한 실시간 analytics/risk-monitoring/portfolio dashboard다(F2:122–126). 현재 프로토콜 위험 규칙이나 기존 도메인 화면은 곧바로 이 요건을 충족하지 않는다. 지연 공개 정책을 지키면서 실제 Perpl 포지션·담보·funding·청산 위험·가격 신선도를 읽고, 누구의 어떤 행동을 돕는지 데모해야 한다. 이를 위해 제품 전체를 대시보드로 바꾸는 것은 권하지 않는다. 운용자/운영자의 제한된 risk 검사 기능으로 제품 핵심을 보완할 때만 적합하다.

| 다른 bounty | 제공된 필수 성격 | 현재 판단 / 근거 |
|---|---|---|
| Agora Mobile Trading | mobile app + Mera 인증 + AUSD 잔액 + Perpl 거래 | AUSD venue 채택만으로 충족 불가. Mera/mobile·실거래 제품 증거 미확인(F2:62–66) |
| Agora Cross-Border Payments | Mera 온보딩, AUSD 국제송금 mobile app | 현재 상품 목적과 다름(F2:56–60) |
| Envio | HyperIndex/HyperSync/HyperRPC가 핵심 기능의 실제 온체인 데이터를 구동 | 일반 RPC probe는 Envio 통합이 아님. 기능적 사용 증거 미확인(F2:68–72) |
| Aurora Intents | any-chain deposit/swap/deposit-and-execute 통합 | `TargetIntent`라는 내부 용어는 Aurora 통합이 아님(F2:74–78) |
| Kuru trading / new markets | Kuru spot orderbook에서 실제 거래 / 새 거래 시장 | 후보 비교 문서 외 통합 증거 미확인. Perpl 파생 운용과 별개(F2:86–96; `docs/real-integration-validation.md:17`) |
| Dynamic | SDK 인증·embedded/agent wallets·signing, deployed demo | package/runtime에 통합 근거 미확인(F2:98–102; `package.json:42`) |
| Alchemy | Monad 배포 기능에 서비스/도구를 의미 있게 사용 | 일반 공개 Monad RPC 사용만으로 sponsor 통합 인정 불가(F2:104–108) |
| Chainlink CRE | CRE workflow를 build/simulate/deploy, orchestration에 사용 | venue가 oracle을 쓰는 것과 이 팀의 CRE workflow는 다름(F2:110–114) |
| Privy | login-only를 넘는 통합 | 단순 로그인만으로도 부족하며 현재 통합 증거 미확인(F2:128–132) |
| Nansen | data/API/MCP/CLI로 raw data 노출 이상의 제품 경험 | 시장 데이터 연구가 Nansen 제품 통합을 뜻하지 않음(F2:134–138) |
| Mera UX / PRF | 전체 account layer / 창의적인 비지갑 PRF 활용 | TEE 파생 키가 Mera PRF 활용은 아님. 해당 계정·키 경로 미확인(F2:158–168) |
| MetaMask Agent Wallet | 해당 plugin architecture의 trading plugin | 일반 wallet/relayer 연결로 대체 불가. plugin 증거 미확인(F2:170–174) |
| Cleanverse | CVI 검증으로 CVA 자산 이동 제어 | 현재 핵심과 별개. 통합 증거 미확인(F2:80–84) |
| Hunyuan / KIMI / Qwen | 해당 모델이 실제 제품 경험·agentic 동작을 구동 | 개발 중 LLM 사용이나 이름 언급은 제품 통합이 아님. 증거 미확인(F2:140–156) |
| Community Team | Metropolis community supporters 소속 팀 | 팀 소속 증거 미확인. 기술 구현과 별도로 적격성 확인(F2:50–54) |

여러 바운티를 넣기 위해 새 로그인·체인·모델을 늘리는 것은 현재 가장 큰 부족분을 해결하지 못한다. 우선 **Onchain Finance + 실제 Perpl automation** 한 경로를 완성하고, 이미 구현된 핵심 기능이 다른 bounty를 자연스럽게 충족하는 경우에만 추가한다. bounty 선택은 primary 평가 점수를 자동으로 높이지 않는다.

## 제출 전 세 가지 우선순위

1. **판정 가능한 하나의 live Monad 경로를 완성한다.** 새 명세 전체가 아니라, 범위를 명시한 테스트 자산 흐름에서 암호화 목표→승인/거절→Perpl 실제 결과→귀속/회계 확인을 보여준다. 금지 주문 하나와 부분체결/재시도 하나를 포함한다. 접근 가능한 URL·3분 녹화·chain/tx 링크를 같은 README에 연결한다. 새 경로가 미완성인 이유는 `README.md:34`와 `docs/team-status.md:52`에 명확하다. 기존 실험을 연결된 서비스처럼 편집해 보여주지 않는다.
2. **첫 사용자 한 조합의 도입 조건을 확보한다.** 기술 연구보다 가중치가 큰 Founder25와 Traction20을 현재 문서만으로 채우기 어렵다. 특정 운용자와 시험 자본 배정자의 실제 문제·기밀성 범위 수용·시험 일정·성공 행동을 검증하고, 동의 받은 증거로 2분 pitch를 만든다. 근거 공백은 시장 연구 `:67`, `:71`에 스스로 명시돼 있다.
3. **제출 주장을 하나로 맞춘다.** primary/bounty 문구, README, 영상, live 화면이 같은 구현을 설명하게 한다. 과거 현물 실험과 새 Perpl 구현을 라벨로 분리하고, logo/공개 접근/판정 가능한 실행 안내를 마감 전에 로그아웃 환경에서 점검한다. 현재 HTML 설명은 아직 “포트폴리오 합성, paper execution”이다(`index.html:7`); 새 제품 주장과 혼재하면 신뢰 점수를 잃는다. Perpl API 또는 Analytics 중 실제 시연 가능한 것만 sponsor 성과로 제출한다.

## 공식 자료 출처

- **F1 — Onchain Finance & Trading 상세.** 사용자가 제공한 `/Users/jaeman/.codex/attachments/16cf6959-e146-41b0-84fe-7bfa0d7c08a6/Pasted text.txt`. 트랙 취지 26–38행, 배점 41–45행, 제출물 48–53행, 마감 33행. 공식 페이지 URL이 원문에 없어 URL을 추정하지 않았다.
- **F2 — Tracks & Bounties 목록.** 사용자가 제공한 `/Users/jaeman/.codex/attachments/c2c14a03-79a3-477a-ae6a-87a9b393f30e/Pasted text.txt`. primary 33–45행, sponsor 요약 50–174행. 개별 bounty 상세 규정은 이 목록에 없으므로 본 판단은 제공된 요약 범위다.
- Repository evidence line numbers are the reviewed 2026-09-23 working tree. 고객 관계·외부 영상·포털 상태의 부재를 저장소 검색만으로 확정하지 않았다.
