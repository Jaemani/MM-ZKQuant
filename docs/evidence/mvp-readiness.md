# 재현 실행 결과: NOT_READY

실행: 2026-09-17T18:42:29.839Z → 2026-09-17T18:42:50.902Z · v22.23.0 · darwin/arm64

실험 재현은 성공했습니다. 원래 합의한 제품의 MVP 조건은 충족하지 못했습니다.

## 직접 확인한 숫자

초기 모의 NAV $100,000. Bull BTC +1, Bear BTC −0.9, Neutral 0, Missing 미제출.
각 weight 10%. BTC $100→$110. 수수료 10bps와 slippage 5bps를 가정했습니다.

| 값 | 손계산 | 실제 HTTP 결과 |
|---|---:|---:|
| 순 BTC 목표 | 100 bps | 100 bps |
| 모의 주문 금액 | $1,000 | $1000 |
| 비용 | $1.50 | $1.5 |
| 최종 NAV | $100,098.50 | $100098.5 |
| Bull standalone NAV | $102,462.50 | $102462.5 |
| Bear standalone NAV | $97,462.50 | $97462.5 |

사칭/대체/마감 후 제출/조기 평가/확정 결과 덮어쓰기 거부와 실제 재시작도 포함해 23개 관측이 기대와 일치했습니다. 이 숫자는 시장 수익 증거가 아닙니다.

## 무결성 공격

수정 전 DB 암호문을 바꾸면 같은 root/유효 receipt를 유지하면서 NAV가 $102462.5에서 $97462.5로 바뀌었습니다. 수정 후 동일 공격은 HTTP 상태에 대응하는 service 오류 409로 거부하고 장부를 변경하지 않았습니다.

before JSON은 수정 전 실행 기록입니다. 이번 실행은 after 거부를 다시 검증했습니다. 소스 변경 patch도 함께 보존했습니다. 운영자가 코드·키·DB 전체를 바꾸는 공격까지 막았다는 뜻은 아닙니다.

## 통과하지 못한 제품 주장

* 같은 alpha를 복제하면 한 운영자의 credit이 5,000→6,666으로 증가합니다.
* 동일 신호가 cap에 포화되면 수익 $2,462.50에도 모든 개별 LOO가 0입니다.
* 상반 BTC 신호 두 개의 공동 기여는 $0인데 전체 10,000 credits를 가져갑니다. Fund는 $1,015 손실입니다.
* 방향 표본 하나로 IC=1·적중률=100%가 나옵니다. 장기 역량 증거가 아닙니다.

| 제품 조건 | 상태 | 근거 |
|---|---|---|
| G1: 서로 독립된 실제 provider 3명 이상이 동일 규칙으로 제출 | NOT_DEMONSTRATED | 독립 client 구현이 만든 4개 fixture key; 실제 독립 참여자 운영 증거 없음 |
| G2: 정책·roster·weights·root가 결과 구간 시작 전에 외부에서 확정 | NOT_MET | LOCAL_ONLY receipt와 로컬 EVM. 외부 확정 시각 없음 |
| G3: 독립된 가격 출처·상품·관측시각·원자료로 결과 재계산 | NOT_MET | 통제한 USER_ASSERTED 가격; 잘못된 양수 가격도 접수됨 |
| G4: 테스트 자산 예치→shares→venue 체결→잔고/NAV→환매 | NOT_IMPLEMENTED | PAPER 선형 노출, 로컬 shares. 자금 계약/venue fill 없음 |
| G5: 평가→다음 weight→테스트 자산 보상→반복 2회 증거 | NOT_MET | weight와 미지급 credit만 구현; 실제 지급 없음 |
| G6: 보상에서 동일 운영자의 복제·상반 신호 악용을 통제 | COUNTEREXAMPLE | 공동 기여 $0인 두 identity에 전체 10,000 credits 배정 재현 |
| TEE: 운영자로부터 vector 기밀성 | USER_DEFERRED | 사용자가 유예한 항목. 위 G1–G6 미충족 판정의 이유가 아님 |

## 원자료

* [실제 HTTP·원 payload opening·receipt·손계산](http-challenge.json)
* [경제적 반례와 정확한 입력](quant-challenges.json)
* [수정 후 변조 및 신뢰 경계](security-challenges.json)
* [수정 전 공격 기록](security-challenges-before.json) · [수정 patch](commit-binding-fix.patch)
* [실행 소스 지문과 모든 원자료 SHA-256](mvp-readiness.json)
* [원본 요구사항 대비 판정과 작업 배분](../mvp-readiness.md)

재실행: 프로젝트 루트에서 `rtk npm run prove:mvp`. 약 20–30초의 실제 대기 시간이 있습니다.
기본 종료 0은 실험 재현 성공, 1은 실행/검증 실패입니다. `--strict`는 제품 미충족 때 2를 반환합니다. 원자료가 바뀌면 다음 실행의 시각·ID·root도 바뀝니다.
