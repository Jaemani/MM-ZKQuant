# Perpl · Monad 외부 의존성 M0 조사

조사일: 2026-09-23. 기준: 제품 명세 v1.4 및 개발 상세 명세 v0.1의 7절·15절. 공식 문서, 공식 SDK ABI·소스, 공개 RPC의 **읽기 전용** 호출을 사용했다. 계정 생성·주문·입출금·배포·서명·유료 서비스 사용은 하지 않았다.

## 결론과 구현 경계

**M0 전체 통과가 아니다.** Perpl은 실제 온체인 조회와 IOC·isolated 기능의 근거가 있으나, 컨트랙트 소유 계정의 전체 실행 경로, 비동기 증거금 해제, slot별 외부 손익 귀속, private 제출 경로는 아직 차단 항목이다. 참조 모델·인코딩·회로 골격은 진행할 수 있다. Perpl 운영 Adapter와 원자적 Gate 실행이 검증됐다고 표시해서는 안 된다.

| 항목 | 이번 확인 | 상태 / 다음 작업 |
|---|---|---|
| B1 계정·주문·장부 입력 | Exchange 주소·ABI, isolated 문서, IOC 필드, 포지션·잔액·funding 조회 확인 | **미해소.** 실제 코드의 계정 권한, DCP 완료 권한, 명세 snapshot과 필드 매핑 검증 필요 |
| B2 출금 제한 | 전역 block 기반 rate limit 문서와 실제 allowance 조회 확인 | **제약 확인, SLA 미확정.** RELEASE 재시도·DRAINING·Custody buffer·공시 및 혼잡 테스트 필요 |
| B3 private 제출 | 일반 RPC는 다음 3개 leader에게 전달되는 local mempool 경로 | **미해소.** 비공개 계약/보장·API가 확인된 endpoint 없음. 기본 PRIVATE_ONLY 유지 |
| B4 암호 precompile·gas·무작위성 | 실제 testnet BN254·PREVRANDAO read-only probe 성공, block gas 150M | **기본 호환 확인.** 전체 Gate+proof gas와 randomness 편향/재시도 설계는 별도 검증 |

## 1. 배포와 버전

공식 network 문서 [P1] 및 실제 RPC 조회:

| | Monad mainnet | Monad testnet |
|---|---|---|
| chain ID | 143 | 10143 |
| Exchange | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| collateral, 6 decimals | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| RPC | `https://rpc.monad.xyz` | `https://testnet-rpc.monad.xyz` |
| sampled block | `0x664b489` | `0x3df2aab` |
| sampled block hash | `0x85130def56ca4c71c3403edb5f50fefdd6d17dcf6fa7b91777930fa24970c962` | `0x89163d8b95bd149aa85873146b916ce3bc8d58d0bc6848222eb5f29f3e69547a` |
| getContractVersion | `major=1, minor=7, patch=4` | `major=1, minor=7, patch=5` |
| BTC perpetual ID | 1 | 16 |

동일 ABI 이름만으로 두 환경의 동작이 같다고 가정하면 안 된다. Adapter 등록에는 chain ID·proxy·implementation·runtime code hash·version·MarketSpec을 결합하고 업그레이드 시 재검증해야 한다. 이번 조사는 runtime hash 일치 검증까지 완료하지 않았다.

ABI 출처는 공식 `PerplFoundation/dex-sdk` commit `5b5be46a3349d719fbb59a08cf3955194bc8dfd8`, `crates/sdk/abi/dex/Exchange.json`이다 [P2]. SDK의 ABI REVISION은 `rc_v1.1.7-203-g0e5902dd`다. 공식 SDK 소스가 공개됐다는 사실은 모든 Exchange Solidity 소스와 배포 구현의 검증이 끝났다는 뜻이 아니다.

## 2. B1 — 실제 venue와 명세 사이의 연결

### 계정·격리·주문

- 공식 문서는 Perpl을 isolated-margin exchange로 설명한다. free balance가 포지션 구제에 자동으로 사용되지 않는다 [P3].
- ABI에 `createAccount(uint256 amountCNS)`, `getAccountByAddr(address)`, `depositCollateral(uint256)`, `withdrawCollateral(uint256)`가 있다 [P2]. 그러나 ABI는 `msg.sender`/EOA 제한, 외부 권한, contract wallet의 주문 가능 여부를 증명하지 않는다. **컨트랙트 계정 지원을 확인 완료로 처리하지 않는다.** Pool의 각 account 주소를 전용 wrapper로 만들고 Gate만 호출할 수 있게 한 뒤, 해당 wrapper로 생성→입금→주문→출금이 가능한지 fork에서 시험해야 한다.
- generic `getMarginMode`/`setMarginMode`는 조사한 ABI에서 발견되지 않았다. isolated-only를 지원하는 deployment의 코드/버전을 승인하는 방식이 가능한지 확인하고, 존재하지 않는 `marginMode()`를 Adapter API로 꾸며서는 안 된다.
- `execOrder` 및 `execOrderV2`의 order descriptor에는 `immediateOrCancel`, `fillOrKill`, `postOnly`, `lotLNS`, `pricePNS`, `expiryBlock`, `lastExecutionBlock`, `leverageHdths`, `amountCNS`가 있다. v2는 extension도 받는다. 명세의 timestamp 만료를 venue block 만료로 매핑하는 규칙이 필요하다.
- Perpl order enum은 `OpenLong=0`, `OpenShort=1`, `CloseLong=2`, `CloseShort=3`이다 [P4]. 명세 BUY=1/SELL=2를 직접 전달하면 안 된다. reduceOnly는 반대 포지션을 새로 만드는 open 주문이 아니라 close enum과 실제 보유 수량에 매핑해야 한다.
- SDK는 `ImmediateOrCancelExecuted`를 “not completely filled” 상황으로도 분류한다 [P5]. 거래 receipt 성공 여부나 요청 수량만으로 체결을 확정하지 않는다. **Gate의 실제 실행 후 포지션·잔액을 읽어야 하며, IOC 부분체결/0체결에서도 요청 수량을 완료 수량으로 note에 저장하면 안 된다.**

### 증거금 해제는 별도 완료 단계가 있다

ABI [P2]:

```text
increasePositionCollateral(uint256 perpId, uint256 amountCNS)
requestDecreasePositionCollateral(uint256 perpId, uint256 amountCNS, bool clampToMaximum)
decreasePositionCollateral(uint256 perpId, uint256 accountId,
  uint32 impactAdjPricePNS, uint16 borrowMarginFracHdths, uint8 positionType)
cancelDecreaseCollateralRequest(...)
declineDecreaseCollateralRequest(...)
```

문서는 DCP 요청이 120초 안에 실행돼야 하며, 남은 담보가 initial margin 조건을 만족해야 한다고 설명한다 [P6]. 요청·완료·거절·취소·만료 이벤트도 따로 있다. 따라서 명세의 “증거금 조정과 IOC를 한 번에 실행” 중 **증거금 해제를 항상 동기적으로 완료할 수 있다는 가정은 미검증**이다. 실제 실행 권한과 oracle/관리자 개입을 확인할 때까지 `REQUESTED → COMPLETED / DECLINED / EXPIRED`를 다룰 Adapter 상태가 필요하다. 완료 전에 slotCredit을 늘리거나 RELEASE를 완료 처리하지 않는다.

### 읽기 데이터 매핑

| 명세 입력 | 확인한 ABI | 남은 문제 |
|---|---|---|
| signed position, entry, margin | `getPositionV2(perpId,accountId)` → `positionType, lotLNS, pricePNS, depositCNS, entryBlock, pnlCNS, deltaPnlCNS, premiumPnlCNS, priceResiduePNSQ16`; 별도 `markPricePNS, markPriceValid` | signed lots 및 long/short rounding, Q16 residue를 회계에 반영 |
| free balance | `getAccountByAddr/Id` → `balanceCNS, lockedBalanceCNS, frozen, positions` | free가 balance 자체인지 balance−locked인지 소스/fixture 대조 필요. 둘을 중복 차감하지 않음 |
| mark, scale, funding 설정 | `getPerpetualInfoV2` → `markPNS, markTimestamp, priceDecimals, lotDecimals, fundingSumScalingExp` 등 | 만료·상태값, 공식 가격 scale을 config에 바인딩 |
| 누적 funding | `getFundingSumAtBlock(perpId,blockNumber)` → `int48 fundingSumPNS, fundingEventBlock` | 체결 시점과 funding 적용 순서, 실현/미실현 이중 계상 방지 |
| 미체결 주문 | `getOrderLocks(accountId)`, `getPerpOrderLocks(...)` | array와 order lot를 직접 확인; generic openOrderQty 단일 getter로 가정하지 않음 |
| liquidation/fill 순번 | 관련 이벤트 존재 | 영속 per-slot liquidation/fill sequence getter는 발견하지 못함. Gate accIndex와 venue 사건 순번은 다른 값 |

실제 양 환경 BTC 조회에서 `priceDecimals=1`, `lotDecimals=5`, `fundingSumScalingExp=0`이었다. AUSD는 6 decimals다. 값은 변경될 수 있으므로 상수로 고정하지 않는다. SDK funding 구현에는 같은 블록의 funding과 position decrease 순서를 검증하는 회귀 테스트가 있다 [P7]. “SDK는 funding을 처리하지 않음”이라는 developer overview 문구 [P3]와 현재 SDK 소스가 일치하지 않으므로, 문서만으로 현재 SDK 회계를 신뢰하지 말고 버전을 고정해 대조해야 한다.

### 외부 사건 인증의 한계

`TakerOrderFilledV2`, `MakerOrderFilledV2`, `PositionLiquidated`, `PositionDeleveragedV2`, `FundingEventCompleted` 등이 ABI에 존재한다 [P2]. RPC log는 indexer가 사건을 관찰하는 방법이지만, Solidity의 Gate는 과거 로그를 그대로 조회할 수 없다. `sync`로 읽은 현재 상태는 그 순간의 상태를 인증할 뿐, 두 snapshot 사이 모든 사건의 수·원인·비용 귀속을 복원한다는 보장은 없다.

특히 동일 account free balance를 여러 slot이 공유할 때, 두 slot의 외부 청산/담보 반환이 sync 전에 발생하면 account 총액 차이만으로 slot별 credit 귀속을 정할 수 없다. per-slot 잔액/누적 실현손익을 충분히 읽을 수 있는지 먼저 검증해야 한다. 안 되면 account 단위 Lease 또는 인증된 receipt/event 증명 등 설계 변경이 필요하다. Gate가 “값이 달라지면 EXTERNAL snapshot”만 남기는 것으로 손실 누락 방지가 완성됐다고 판단하지 않는다.

## 3. B2 — RELEASE·claim 지연

공식 출금 제한 [P8]:

- 모든 계정에 적용되는 전역 한도이며 내부 accounting transfer에는 적용되지 않는다.
- 기본 hourly limit은 `max(10% × TVL, $1,000,000)`이고 owner가 값을 바꿀 수 있다.
- 시각이 아니라 **8,571 blocks**를 한 주기로 사용한다. 문서의 약 1시간은 0.42초/block 가정이며 지급 SLA가 아니다.
- 최초 약 25% burst 이후 block별 capacity가 늘어난다.
- bypass는 owner가 주소별로 설정한다. MM에 bypass가 부여됐다는 근거는 없다.
- 다른 사용자가 capacity를 일시 소진할 수 있다고 문서가 명시한다. 반복 소진·venue 중단에서 MM 출금 완료 시간을 상한으로 약속할 수 없다.

`getWithdrawAllowanceData(blockNumber)`는 `allowanceCNS, expiryBlock, lastAllowanceBlock, cnsPerBlock`를 반환한다. 위 표의 mainnet block에서 `allowanceCNS=505187870000`, `expiryBlock=107267209`, `lastAllowanceBlock=107263113`, `cnsPerBlock=116672500`을 읽었다. testnet에서는 각각 `3540672689889, 64960944, 64957099, 749192274`였다. 이 값은 관찰 순간의 capacity이며 미래 지급 보장이 아니다.

필수 검증: capacity 소진 때 RELEASE가 DRAINING을 유지하고 자산/지분을 중복 소각하지 않는지, 동일 청구의 재시도가 정확히 한 번 지급되는지, custody buffer 소진을 사용자에게 별도 대기 상태로 보여주는지. 제품 SLA는 buffer 크기와 실제 혼잡 테스트 후 결정한다.

## 4. B3 — private submission

공식 Monad 구조는 global mempool이 없지만, 일반 RPC가 거래를 다음 **3개 leader**의 local mempool로 전달하고 재전송할 수 있다고 설명한다 [M1]. **global mempool 부재는 비밀 주문 제출 보장이 아니다.** RPC 및 validator는 포함 전 calldata를 볼 수 있다.

조사한 공식 network/RPC/local-mempool/privacy 문서에는 이 제품이 요구하는 private validator submission의 endpoint, 인증, 보존 기간, 전파 금지, 실패 시 처리 계약이 확인되지 않았다. “존재하지 않는다”는 결론은 아니다. 별도 provider와의 기능·정책 확인이 필요한 상태다. VDP 정책은 외부 MEV 시스템을 언급하지만 private 제출 API를 제공하는 문서가 아니다 [M2].

`PRIVATE_ONLY`는 확인된 private provider가 없을 때 미제출/만료로 끝나야 한다. 일반 `eth_sendRawTransaction`을 PRIVATE로 표시하지 않는다. `ALLOW_PUBLIC`로 기본값을 바꾸는 것은 기술팀이 조용히 처리할 구현 선택이 아니라 노출 정책 변경이다. 제품 mandate의 명시적 선택과 `SUBMISSION_PUBLIC_FALLBACK` 결과 표시가 필요하다. 포함 후 온체인 주문 공개도 별도로 설명해야 한다.

## 5. B4 — Monad 실제 읽기 probe

Testnet block `0x3df2aee`, hash `0xd90894ce48cfcd6bd7978429170cb949940c522a9c75472042e36df89e654b67`에서:

| 검사 | 입력 | 결과 |
|---|---|---|
| PREVRANDAO | 생성형 `eth_call` initcode `0x4460005260206000f3` | `0x2e6228643ff0b17dd03d527b6a31100a88ee10bf0fbb689f6a34d0f00ee2c0bd`, block.mixHash와 일치 |
| BN254 add | address 0x06, zero 128bytes | infinity `(0,0)` 반환 |
| BN254 mul | address 0x07, zero 96bytes | infinity `(0,0)` 반환 |
| BN254 pairing | address 0x08, zero 192bytes / 768bytes | 각각 true(1) |
| block gas limit | RPC header gasLimit | 150,000,000 |

이는 opcode/precompile dispatch와 기본 유효 입력 검증이지, 전체 MM Groth16 증명/가스/부정 증명의 통과 결과가 아니다. RPC `eth_estimateGas` 결과는 add `0x57d1`, mul `0xca41`, 1-pair `0x66d7b`, 4-pair `0xe4e8d`였으며 estimator 여유분·intrinsic gas를 포함하므로 precompile 원가와 혼용하지 않는다.

공식 문서는 ecAdd 300 gas, ecMul 30,000 gas를 명시한다 [M3]. **pairing 표의 225,000은 완전한 상수 비용으로 해석하면 안 된다.** 공식 소스 [M4]는 Monad pricing version≥1에서 `5 × (45,000 + 34,000 × pairCount)`를 계산한다. 따라서 4-pair Groth16 pairing 자체가 **905,000 gas**이며 public input별 scalar multiplication과 Gate/Perpl/Poseidon 비용은 추가다. 과거 Ethereum 포크 proof gas를 Monad 예상값으로 재사용하지 않는다.

공식 summary [M5]는 per-transaction gas limit 30M, block gas limit 150M를 기재한다. depth32 NoteTree·최대 slot checkpoint·Perpl matches까지 합친 최악조건이 단일 tx 한도 안에 있는지 아직 측정하지 않았다.

PREVRANDAO opcode가 동작해도 공정한 slot 배정이 증명되지는 않는다. validator 선택 편향, 호출자 재시도·선택적 abort를 모델링해야 한다. 추측 가능한 현 블록 값을 그대로 선정에 쓰지 말고 commit-reveal/미래 entropy 등 배정 정책을 명시한 후 테스트한다.

## 6. 다음 실행 순서와 종료 조건

1. ABI·chain·implementation·version을 고정하고 전용 contract-owned account fork fixture를 만든다. EOA 중계 서명이 없어도 Gate wrapper로 계정 생성·IOC·reduce-only·담보 조정·출금이 되는지 검사한다.
2. DCP의 권한·120초 만료·실제 완료 이벤트를 확인한다. 동기 해제를 구현할 수 없으면 Gate 명세를 비동기 상태로 수정한다.
3. 계정 내 여러 slot에 청산/ADL/funding이 겹치는 fixture를 만든다. 실제 포지션·account free balance와 slotCredit 합계가 매 단계 일치해야 한다. 일치시킬 입력이 부족하면 B1을 닫지 않는다.
4. IOC 부분·0체결 및 funding 같은 블록 실행을 reference accounting과 대조한다. 요청량과 체결량을 구분한다.
5. 출금 제한 소진·재충전·동시 경쟁에서 RELEASE/claim의 정확히 한 번 처리와 대기 상태를 검증한다.
6. private 제출 제공자를 확정하거나 제품 차원의 공개 제출 정책을 승인한다. 구현이 옵션을 임의로 완화하지 않는다.
7. 새 회로의 양성·음성 proof를 Monad EVM에서 검증하고 최악 gas를 측정한다. PREVRANDAO 공정성은 별도 공격 시나리오로 검토한다.

## 출처

### 재현 가능한 추가 관측

저장소 루트의 `npm run probe:perpl`은 고정 commit의 공식 ABI와 공개 Monad testnet RPC를 사용한다. RPC 메서드는 read-only whitelist로 제한되며 signer/키는 없다. `-- --write-evidence`를 붙이면 [관측 기록](../evidence/perpl-readonly.json)을 갱신한다.

2026-09-23 추가 실행은 block 64960757에서 성공했다. Exchange 1.7.5, proxy와 EIP-1967 implementation의 runtime code hash, 실제 allowance를 기록했다. BN254 add/mul은 무한원 입력뿐 아니라 `(1,2)`의 두 배를 독립적인 base-field 정수 계산과 대조했다. pairing은 1·4개 무한원 쌍의 기본 dispatch 검사이므로 실제 Groth16 검증으로 표현하지 않는다. PREVRANDAO는 해당 block의 mixHash와 일치했다. 코드 해시는 관측한 버전을 고정하기 위한 값이지 승인된 구현/소스 대조 결과가 아니다. B1–B3 차단 항목은 그대로 남아 있다.

### 공식 자료

- [P1] [Perpl Networks & Configuration](https://docs.perpl.xyz/resources/for-developers/networks-and-configuration)
- [P2] [공식 Exchange ABI, 고정 commit](https://github.com/PerplFoundation/dex-sdk/blob/5b5be46a3349d719fbb59a08cf3955194bc8dfd8/crates/sdk/abi/dex/Exchange.json)
- [P3] [Perpl developer overview](https://docs.perpl.xyz/resources/for-developers/overview)
- [P4] [공식 order enum](https://github.com/PerplFoundation/dex-sdk/blob/5b5be46a3349d719fbb59a08cf3955194bc8dfd8/crates/sdk/src/types/order.rs)
- [P5] [공식 event model](https://github.com/PerplFoundation/dex-sdk/blob/5b5be46a3349d719fbb59a08cf3955194bc8dfd8/crates/sdk/src/state/event.rs)
- [P6] [Perpl Margin / DCP](https://docs.perpl.xyz/exchange/margin)
- [P7] [공식 position funding accounting와 회귀 테스트](https://github.com/PerplFoundation/dex-sdk/blob/5b5be46a3349d719fbb59a08cf3955194bc8dfd8/crates/sdk/src/state/position.rs)
- [P8] [Perpl Withdrawal Limits](https://docs.perpl.xyz/exchange/security/withdrawal-limits)
- [M1] [Monad Local Mempool](https://docs.monad.xyz/monad-arch/consensus/local-mempool)
- [M2] [Monad VDP Policy on MEV Systems](https://docs.monad.xyz/node-ops/validator-delegation-program/mev)
- [M3] [Monad Precompiles](https://docs.monad.xyz/developer-essentials/precompiles)
- [M4] [Monad gas multipliers](https://github.com/category-labs/monad/blob/2e1c9fa9ba7ca7c71aca818151831e61e0bb6939/category/execution/monad/monad_precompiles_gas_cost_impl.cpp), [pairing gas formula](https://github.com/category-labs/monad/blob/2e1c9fa9ba7ca7c71aca818151831e61e0bb6939/category/execution/ethereum/precompiles.hpp)
- [M5] [Monad Deployment Summary](https://docs.monad.xyz/developer-essentials/summary)
