---
status: accepted
date: 2026-09-18
---

# 전략 실행 증명에서 alpha 제출·합성·평가로 전환

제품의 공통 계약을 비공개 Python 코드 실행에서 사전 제출된 alpha vector로 변경한다. 전략의 언어·모델·원데이터와 인간의 판단 과정은 provider에게 두고, 플랫폼은 제출 시점·완전성·합성·실제 거래·세 종류의 평가·가중치 조정·보상을 연결한다. 이 선택은 임의 코드 실행의 격리·호환성 비용을 줄이고 인간 트레이더도 같은 인터페이스로 수용하지만, 제출자가 그 판단을 어떻게 만들었는지 증명하지 않는다. 이 ADR의 accepted 상태는 alpha vector 중심의 제품 전환에 적용된다.

사용자가 명시적으로 보류한 것은 TEE뿐이며 현재 구현은 vector를 복호화하는 trusted server다. 따라서 운영자에게 alpha가 비밀이라는 보장은 없고, 로컬 root는 독립 timestamp가 아니다. 합성·사용자 입력 가격, PAPER 거래·자본, reward credit 및 로컬 EVM만으로 구현을 제한한 것은 에이전트의 범위 축소였으며 사용자가 승인한 제품 결정이 아니다. 현재 산출물은 프로토콜 프로토타입이고 원본에서 합의한 충분한 MVP가 아니다.

실제 book과 provider의 shadow book을 분리하고 prediction quality·standalone performance·contribution을 독립적으로 기록한다. 현재 프로토타입은 실제 book을 PAPER로 대체하고 한 epoch leave-one-out contribution을 사용한다. contribution은 사전에 정한 비교 정책이며 실제 PnL의 유일한 객관적 귀속이라고 주장하지 않는다. 기존 TEE 실행 요구사항은 [원문 보관](../archive/legacy-tee/)으로 이동했고, [현재 요구사항](../requirements.md)은 프로토타입 구현 계약으로 유지한다. 이 문서들이 원본 alpha fund의 제품 범위를 대체하지 않는다.

원본 대비 미충족 항목과 완료 gate는 [MVP 준비도 판정](../mvp-readiness.md)을 따른다. `rtk npm run prove:mvp`로 근거를 재현하며 `rtk npm run prove:mvp -- --strict`는 제품 조건 미충족 시 종료 코드 `2`를 반환한다.
