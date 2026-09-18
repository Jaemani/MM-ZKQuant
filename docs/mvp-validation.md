# 로컬 프로토콜 프로토타입의 과거 검증 기록

> 후속 v2 구현과 최신 상태는 [Pilot 개발명세](pilot/development-spec.md), [실행 안내](pilot/runbook.md), [재현 결과](evidence/pilot-readiness.md)를 따른다. 아래 PAPER v1 규칙과 과거 검증 기록은 비교용으로 보존한다.

기록 대상 검증일: 2026-09-18 · 환경: macOS arm64, Node.js 22.23.0 · 버전: alpha-policy-v1 / paper-linear-v1 / protocol 1

이 문서는 당시 수행한 엔지니어링 검증의 기록입니다. 시험 수·빌드·화면 동작은 원본에서 합의한 MVP의 제품 완성 증거가 아니며, 아래 56개는 현재 코드의 최종 시험 수를 뜻하지 않습니다. 현재 구현은 **프로토콜 프로토타입**으로 판정하며, 실제 시장 관측·거래·자본·지급을 포함한 원본 제품 흐름은 미충족입니다. 사용자가 명시적으로 보류한 것은 TEE뿐이고, 나머지를 PAPER·사용자 입력 가격으로 대체한 것은 에이전트의 범위 축소였습니다.

현재 판정과 제품 gate는 [MVP 준비도 판정](mvp-readiness.md)을 따릅니다. `rtk npm run prove:mvp`로 근거를 재현하고, `rtk npm run prove:mvp -- --strict`는 제품 조건 미충족 시 종료 코드 `2`를 반환합니다. 재현 가능한 프로토콜 결과를 제품 준비 완료와 구분합니다.

## 당시 확인한 결과

| 검증 | 실제 결과 | 근거 |
|---|---|---|
| 자동 시험 | **당시 56 PASS, 0 FAIL, 0 SKIPPED** | 보존된 node:test 결과, 아래 분류 및 실행 명령 |
| 브라우저 production build | PASS | Vite 7.3.6, React 19, `npm run build` |
| Dependency audit | 당시 알려진 취약점 **0** | 당시 lockfile의 `npm audit --json`; 보안 감사 전체를 뜻하지 않음 |
| 브라우저 직접 제출 | PASS | Browser QA provider 등록→Ed25519 키 생성→BTC +100 / ETH −100 bps 서명·암호화→접수증 |
| 수동 epoch | PASS | 11명 roster 중 1명 제출, 10명 MISSED, 최소 인원 미달로 기존 노출 유지, 이후 평가 |
| 연속 demo | PASS | 6개 epoch, weight 갱신·미제출·shadow·기여도·누적 credit 반영 |
| PAPER 입금 | PASS | 가상 1000 입금 후 NAV와 shares 증가, share price·투자 수익률 유지 |
| workspace 분리 | PASS | demo 기록이 forward에 나타나지 않음; forward는 provider/epoch 0 |
| 모바일 화면 | PASS | 390px viewport에서 document/body/scroll width 모두 390px, 주요 카드 겹침 없음 |
| 브라우저 console | 당시 오류·경고 0 | 당시 빌드 화면 console 관측 |
| SDK와 verifier | PASS | 별도 SDK provider의 서명·암호화 제출, finalized receipt, 외부 지정 서버키로 검증 |
| 실제 manifest의 로컬 EVM anchor | PASS | 아래 manifest·local-chain-anchor JSON의 root/hash 일치 및 `verified=true` |
| Monad 배포 실행기 dry run | PASS | `NOT_BROADCAST`, expectedChainId 10143, 컴파일·입력 검증만 수행 |

## 당시 자동 시험의 범위

| 파일 | 시험 수 | 확인한 실패 사례와 불변조건 |
|---|---:|---|
| tests/engine.test.js | 23 | cap·누락·상쇄·risk·분할·비용·가격 drift·LOO·credit 상한·미정의 IC·예측 유효 표본·파산·gap 최대낙폭 |
| tests/protocol.test.js | 4 | canonical encoding, 홀수/짝수 Merkle, 서명 변조, AES-GCM 인증 |
| tests/service.test.js | 18 | cutoff 경계·조기 정산 거부·roster 동결·재시작·멱등·자금보존·공개/DB 비밀 노출·누적 MDD |
| tests/http.test.js | 1 | localhost/Origin/content type/body size, private receipt, 실제 API 흐름, 중복 입금 |
| tests/contracts.test.js | 10 | 실제 EVM deploy/write/read, publisher·중복·0값 거부, 자금 수신 거부, manifest binding |

보존된 실행에서 계약의 중첩 시험을 포함한 node:test 집계는 56개였다. 현재 시험 결과는 다시 실행해 확인한다. 위 시험은 [인수 시험](acceptance-tests.md)의 주요 로컬 경로를 다뤘으며, 인수 문서의 모든 조합이나 장기간 장애 상황을 전부 시험했다는 의미는 아니다.

```bash
rtk npm test
rtk npm run build
rtk npm audit --json
rtk npm run verify:receipt -- .data/receipt.json --public-key .data/trusted-server-key.json
rtk npm run chain:demo -- --manifest docs/evidence/review-epoch-manifest.json --output artifacts/local-chain-anchor.json
rtk node contracts/deploy-testnet.mjs --manifest docs/evidence/review-epoch-manifest.json
```

당시 전체 자동 시험 결과는 [test-results.txt](evidence/test-results.txt)에 보존했다. 개인 receipt·token·SDK private key는 공개 증거 문서에 넣지 않고 `.data/`에만 보관한다.

## Commitment 증거

- [봉인한 공개 manifest](evidence/review-epoch-manifest.json)
- [로컬 EVM 저장·재조회 결과](evidence/local-chain-anchor.json)

두 파일의 epochId는 `c001907d-1566-4434-b599-4ddc712444b3`이고, root는 `0xf4f40a006c42bc136ce8c3592be582226bc3473ca35bdb2061f35955fa80a0e6`이다. 로컬 EVM의 chain ID는 31337이며 `@ethereumjs/vm`에서 Solidity 0.8.37 bytecode를 실제 실행했다. block timestamp는 로컬 fixture 값이다.

이는 **Monad에서 발생한 transaction이 아니다.** 앱 상태의 anchor는 계속 `LOCAL_ONLY`다. 별도 CLI로 생성한 로컬 EVM 증거를 앱이 Monad 확정 상태로 승격하지 않는다. verifier의 `independentlyTimestamped`도 `false`다.

## 미충족 제품 조건과 명시적으로 보류한 항목

아래의 미구현 항목을 모두 사용자가 승인한 후속 범위로 해석하지 않는다. TEE 보류와 달리 실제 시장 결과·실행·Monad 자본·보상은 원본 제품 흐름의 요구사항으로 남는다.

| 항목 | 상태·이유 |
|---|---|
| 실제 TEE / attestation | 사용자 결정에 따라 보류. 운영자 기밀성 보장 없음 |
| 실제 Monad testnet deploy / finality 확인 | 준비된 실행기·설정·runbook만 제공. 실제 RPC·테스트용 발행 계정으로 broadcast하지 않음 |
| 실제 DEX / 투자자 vault / provider token 지급 | 미구현. 현재 synthetic PAPER book / 공동 검토계정 shares / credit preview |
| 독립 market feed / live price truth | 미구현. demo 합성 가격, forward 사용자 입력 가격을 명시 |
| 장기 forward 운영 | 미실행. 실제 clock 경계는 fake-clock 서비스 시험으로 검증했고 장기간 수집 실적은 없음 |
| correlation/capacity/volatility model | 현재 고정 caps·prior-history heuristic. 고도화는 작업 계획의 후속 항목 |
| Sybil identity / stake / production auth / 다중 운영자 | 미구현. localhost 단일 운영자 리뷰 모델 |

## 사용자와 검토할 결정

1. 판단의 공통 계약을 conviction vector로 유지할지, 별도의 target-portfolio 제출 버전을 추가할지.
2. provider cap 10%, 자산 cap 25%, 최소 제출 3명의 초기값이 제품 실험에 적절한지. 최소 인원은 익명성 보장이 아니다.
3. 결석 시 fund는 정해진 합성/hold 규칙을 따르고 개인 shadow는 0 노출로 청산하는 정책이 적절한지.
4. 한 epoch leave-one-out contribution과 양의 기여 기반 reward credit을 후속 보상 실험의 출발점으로 쓸지. 현재 credit은 실제 지급 약속이 아니다.
5. 원본 범위를 충족하기 위한 독립 가격 feed·Monad anchor·실행·자본·지급 연결 순서. TEE는 별도로 보류된 항목이며, 현재 미구현 기능이 선택 사항으로 바뀐 것은 아니다. 제품 완료 기준은 [MVP 준비도 판정](mvp-readiness.md)에 연결했다.
