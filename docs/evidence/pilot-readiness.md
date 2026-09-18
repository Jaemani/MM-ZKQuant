# TEE 제외 구현 및 외부 검증 결과

2026-09-17T20:35:09.160Z

**제품 판정: NOT_READY_EXTERNAL_EVIDENCE**

로컬 계약 실행과 공개 가격 수집은 검증했습니다. 외부 기록이 없으면 로컬 시험을 공개 테스트넷 실적으로 승격하지 않습니다.

| 조건 | 외부 제품 판정 | 구현·검증 |
|---|---|---|
| G1 실제 독립 운영자 승인·서명 제출 | 미충족 | 승인·키 연결·서명 SDK·마감 구현 |
| G2 평가 전 외부 확정 커밋 | 미충족 | 계약의 마감/시작 제한·finalized 확인·재개 journal 구현 |
| G3 독립 가격 원자료와 평가 연결 | 미충족 | Kraken 네 자산 동일 시각 closed 1m 원자료 수집·재계산 통과 |
| G4 자본·지분·롱/숏 체결·환매 | 미충족 | 로컬 EVM 예치·AMM 매수/매도·담보부 차입/상환·환매·자산 보존 통과 |
| G5 연속 weight 갱신·실제 지급 | 미충족 | 로컬 2 epoch·실현 이익 한도 지급·손실기 무지급·중복 지급 거부 통과 |
| G6 승인 운영자 단위 보상 악용 통제 | PASS | 계정 복제 불변·상쇄 신호 기여 0·cap 포화 Shapley 검증 |
| TEE TEE 격리·attestation | EXCLUDED | 사용자 요청으로 제외 |

## 실제 로컬 EVM 결과

| Epoch | 실현손익 tUSD | 실제 지급 tUSD | entry/exit fills |
|---|---:|---:|---:|
| 1 | 1067.611959 | 106.761196 | 6 |
| 2 | -2148.636353 | 0.000000 | 6 |

최종 환매: 98812.214410 tUSD. 모든 asset token의 계정별 잔고 합계가 공급량과 일치하며, 차입 잔고는 전액 상환했습니다. 실제 계약의 로그를 별도 검증기가 재계산했습니다. 제어한 가격과 로컬 시계를 쓴 결과이며 시장 수익률이 아닙니다.

## 시장·외부 연결

Kraken closed 1m boundary: 1789677240. {"BTC":"76582.0","ETH":"2453.04","MON":"0.02309","SOL":"101.13"}

Monad chainId: 10143. 테스트 가스 주소: 0xA761529aE65a0966125C47911DEDCC7F23951D57. 잔액: 4128720386000000000 wei.

외부 오류 없음. 외부 evidence 파일이 없으면 해당 조건은 미충족입니다.

## 원자료

- [전체 결과·소스 지문](pilot-readiness.json)
- [계약 실행·서명 제출·체결·상환·지급](pilot-local.json)
- [로그 재계산 결과](pilot-local-verification.json)
- [복제·공모·cap 반례 검증](pilot-reward-challenges.json)
- [공개 가격 원자료](market-live.json)
- [실행 및 중단 복구 안내](../pilot/runbook.md)

재현: `rtk npm run prove:mvp -- --strict`. exit 0: 제품 조건 충족, exit 2: 구현 재현 성공·외부 근거 미충족, exit 1: 실험 또는 검증 실패. 기본 실행은 재현 성공시 0을 반환하지만 제품 판정은 동일하게 표시합니다.

## 공개 테스트넷에서 확인한 범위

- 펀드: [0x912ED1eF5581E48F6DAa0fE02EB357706E821cC7](https://testnet.monadvision.com/address/0x912ED1eF5581E48F6DAa0fE02EB357706E821cC7)
- 예치: [거래 보기](https://testnet.monadvision.com/tx/0x7c83bd6ecbfbeed702ca5ec90f2ed9e8fe284af0acae0ecc55868646b7a10360)
- 현재 소스와 배포 bytecode 대조, finalized receipt와 NAV/share 재계산: PASS
- 검증된 운용 epoch: 0회. 환매 관측: 없음.
- 테스트 토큰·운영자 공급 AMM을 사용하며 독립 제공자의 실제 운용·지급 증거와 구분합니다.
