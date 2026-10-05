# Perpl 공유 실행 계정

기준: 2026-10-05. 코드·로컬 검증과 기존 Phala CVM 반영을 완료했다. 기존 Vault·TEE operator·암호화 공개키를 유지했으며 `COMPATIBLE_MARKET_DIRECTIONS` 모드를 확인했다. 테스트넷 전용 전략의 실제 입금·신규 공유 계정 주문·포지션 종료도 확인했다. 여러 전략의 동일 방향 및 다중 시장 재사용은 회귀 테스트로 검증했으며 이번 라이브 확인은 단일 테스트 전략 범위다.

## 계정 배정

- Vault는 하나다. 전략마다 또는 시장마다 Perpl 계정을 생성하지 않는다.
- 같은 시장에서 같은 방향을 가진 전략과 서로 다른 시장은 계정을 공유한다.
- 같은 시장에서 반대 방향이 충돌하면 다른 계정을 배정한다. 이미 호환되는 다른 공유 계정이 있으면 먼저 재사용한다.
- 각 전략의 제출은 개별 요청으로 즉시 처리한다. 다른 전략의 제출을 기다리거나 반대 주문을 상쇄하지 않는다.
- TEE는 해당 전략의 이전 수량과 목표 수량의 차이만 주문한다. 컨트랙트는 공유 계정의 현재 수량이 기대 수량과 일치하는지 확인한다. 부분 체결은 실제 수량만 해당 전략에 귀속한다.

예: A와 B의 BTC 롱 및 A의 ETH 롱은 계정 하나를 쓸 수 있다. C가 BTC 숏과 ETH 롱을 제출하면 BTC 방향 충돌 때문에 두 번째 계정이 필요하지만, C의 ETH 포지션을 위한 세 번째 계정은 필요 없다.

## 장부와 정산

`shared-accounts.mjs`의 계정 → 전략별 담보·수량·평가 checkpoint는 봉인된 투자 장부에 저장한다. 투자자별 지분은 기존 전략 장부를 그대로 사용한다. 공개 DB와 지표 API에는 계정 귀속표나 수량을 추가하지 않는다.

동일 계정의 현금과 평가액은 한 번만 계산한다. 시장의 가격 손익은 각 전략의 실제 수량으로, funding은 동일 방향 노출 비율로 배분한다. 주문의 체결 비용과 수수료는 제출 전략에 귀속한다. 거래소의 계정 전체 평가액과 내부 귀속 합계를 대조한다.

위험 종료는 해당 전략 수량만 줄인다. 출금도 해당 전략의 현금·회수 가능한 담보를 먼저 사용하고 필요한 경우 해당 전략 수량만 줄인다. 정산 비용은 출금 지분에 귀속한다. 다른 전략 수량이나 자본을 임의로 가져오지 않는다.

확정 거래를 적용하기 전에 receipt 및 계정 상태를 확인한다. 확인 실패가 담보 차감의 일부만 저장하는 일이 없도록 원자적으로 장부에 반영한다. 동일 journal 항목을 재실행하면 담보·수량·비용을 중복 반영하지 않는다.

## 기존 Vault를 유지하는 배포 — 권장

기존 v1 Vault의 operator는 이미 `withdraw(address,uint256,bytes32)` 권한을 갖고 있다. 이를 이용해 신규 공유 실행 계정에 내부 운용 자금을 보내고, 같은 TEE operator가 `fundFromBalance()`로 Perpl에 입금한다. `recoverToVault()`는 자금을 원래 Vault로만 반환한다. Vault 교체, 투자자 전액 출금 또는 공개 DB migration은 필요하지 않다.

공유 계정 컨트랙트 배포·자금 전송·Perpl 입금·회수는 기존 TEE의 durable transaction journal에 각각 기록한다. 봉인 checkpoint는 Perpl 담보뿐 아니라 입금 중인 실행 계정의 AUSD도 포함한다. Perpl 계정 생성 전 응답이 끊겨도 자본을 누락하거나 중복 차감하지 않는다.

기존 열린 전용 계정은 기존 방식으로 관리한다. 해당 전략이 포지션을 정리하고 기존 계정의 평가액을 Vault로 회수한 뒤, 다음 신규 목표 제출에서 공유 방식으로 전환한다. 투자자 지분·입금/출금 이력·성과 기록은 유지한다. 실행 중인 주문의 계정이나 calldata를 바꾸지 않는다.

외부 통신이 가능한 환경에서 다음 순서로 반영한다:

```sh
# 기존 CVM, Vault, 봉인 상태 및 operator 정체성을 유지한다.
# 새 공유 계정 ABI/bytecode도 bootstrap과 attestation source hash에 포함된다.
node scripts/deploy-platform-worker.mjs

# UI의 담보 안내 변경 반영
npx vercel deploy --prod --yes

# 읽기 전용 연결 점검
node scripts/platform-smoke.mjs
```

`/platform/status`의 `accountSharing`이 `COMPATIBLE_MARKET_DIRECTIONS`인지 확인한다. 기존 operator 주소와 암호화 공개키가 유지됐는지도 attestation/config와 대조한다. 초기 공유 계정은 최초 주문이 필요할 때만 TEE가 배포한다. 새 전략 두 개의 동일 방향 주문과 서로 다른 시장 주문이 계정을 재사용하는지 실제 테스트넷에서 확인할 수 있다. 이번 라이브 검증에서는 단일 테스트 전략의 공유 실행 계정 생성·주문·포지션 종료를 확인했다.

## 선택 사항: v2 Vault로 전환

v2 Vault에는 `createSharedAccounts()`와 `executionAccountVersion()`가 있다. 신규 설치에서는 이 경로로 공유 계정을 등록하고 기존 `fundSlot()` / `recoverSlot()`으로 자금을 이동할 수 있다. 기존 v1 배포에서 이 전환은 필수가 아니다.

v2로 교체하려면 기존 투자금·지분·예약 출금·성과보수·미확정 거래와 실행 계정 잔액을 모두 정리해야 한다. 기존 투자자 자본을 새 Vault로 자동 이관하지 않는다.

```sh
# 먼저 기존 Vault를 사용하는 새 worker를 반영한다.
node scripts/deploy-platform-worker.mjs

# 원래 TEE 생성 시 client.json의 admin token 필요.
# reusedIdentity client.json의 token:null 파일은 사용하지 않는다.
MMQ_TEE_CLIENT_PATH=.data/cohort-tee/client.json node scripts/shared-account-rollout.mjs check

# ready:true 이후에만 기존 Vault의 신규 입금을 중단한다.
MMQ_TEE_CLIENT_PATH=.data/cohort-tee/client.json node scripts/shared-account-rollout.mjs pause

# 신규 컨트랙트를 준비하되 공개 입금 주소는 아직 바꾸지 않는다.
# PLATFORM_OPERATOR_ADDRESS는 기존 TEE operator와 같아야 한다.
node scripts/deploy-omnibus-vault.mjs --broadcast

# shared-deployment.json을 사용하고 기존 봉인 장부를 검증하여 pin 전환
node scripts/deploy-platform-worker.mjs --shared

# TEE가 후보 Vault를 실제 사용 중인 경우에만 DB의 입금 주소 전환
node scripts/shared-account-rollout.mjs activate
```

`pin()`은 잔액이 있는 장부의 전환을 거부한다. 기존 Vault가 pause 상태이고 실제 Vault 및 등록·미등록 실행 계정 자산과 주문도 비어 있어야 한다. 기록은 보존하고 기존 미완료 입금 요청만 retired 처리한다. 전체 자산 회수 조건을 충족하지 못하면 v2 전환을 진행하지 않는다.

## 검증과 경계

- 공유 계정/기존 Vault bridge 테스트: 다중 시장·동일 방향 재사용, 반대 방향 충돌, 방향 전환, 소액 전략 추가, 전략별 위험 종료·예약 출금, 손익/funding 귀속, 확정 자금·체결의 재시작 복구, 기존 계정 전환 조건.
- 로컬 EVM: 하나의 Perpl 계정으로 다중 시장 실행, 기존 다른 요청의 수량 보존, stale 수량 거부, replay·권한 검사, 부분 체결, 기존 Vault 권한을 통한 입금·회수.
- 기존 장부·투자·UX·요청·암호화 채널 회귀 테스트와 frontend build 통과.
- 기존 relay HTTP 통합 테스트 한 건은 sandbox의 `listen EPERM` 때문에 실행하지 못했다. 이 제한을 숨기기 위해 해당 테스트를 변경하거나 skip 처리하지 않았다.
- 기존 Phala CVM 재배포와 Monad 테스트넷의 신규 공유 계정 주문·종료를 확인했다. 다중 전략·다중 시장의 라이브 재사용 확인은 이번 단일 전략 검증 범위를 벗어난다.
- 물리적으로 계정을 공유하므로 거래소의 계정/포지션 청산 위험까지 전략별로 완전히 격리되지는 않는다. 예상하지 않은 수량 변경이나 설명되지 않는 평가액 차이는 자동으로 다른 전략에 배분하지 않고 reconciliation 오류로 실행을 중단한다. 평가 오류가 있는 전략은 새 공개 성과를 발행하지 않는다.
- 공유 계정의 전체 Perpl 포지션은 온체인에서 관찰 가능하다. 전략별 귀속과 투자자 배분은 TEE 내부에 있다. 이 변경은 ZK 검증을 추가하지 않는다.
- 최초 100 AUSD 요구는 새 Perpl 계정에 적용한다. 이미 생성된 공유 계정에 참여하는 전략은 필요한 담보만 추가한다. 반대 방향 충돌로 새 계정이 필요하면 최초 담보 조건이 다시 적용된다.
