# ZK 승인·정산 연구 경로

현재 팀 명세 전체를 구현한 제품이 아니라, **운용자 인증 → 자금 예약 → 실제 외부 체결 → 비공개 Book 정산**의 검증 실험입니다. 기존 ApprovedVault 서명 경로와 별도로 둡니다. 기존 사용자 데이터와 Dapp은 변경하지 않습니다.

## 재현

```bash
rtk npm ci
rtk npm run build:zk
rtk npm run prove:zk
rtk npm run verify:zk
```

`build:zk`는 Circom 2.2.2(circom2 0.2.22 패키지), circomlib 2.0.5, snarkjs 0.7.6을 사용합니다. 최초 powers-of-tau 준비에는 수 분이 걸립니다. 생성 파일은 Git에서 제외된 artifacts/zk에 둡니다. 로컬 한 주체의 Groth16 setup이므로 운영용 ceremony로 인정하지 않습니다. 재빌드하면 검증키·proof가 달라질 수 있습니다.

`prove:zk`는 Monad mainnet RPC를 읽어 Anvil 포크를 만들고 실제 Uniswap WMON/USDC 라우터에 거래합니다. 송신은 loopback chain 31337로 제한합니다. ZkBookVault 생성자도 다른 chain ID에서 배포를 거부합니다. 최초 Book별 배정은 신뢰된 테스트 상태이며 실제 투자자 지분 증명이 아닙니다.

`verify:zk`는 저장한 공개 proof를 오프라인 재검증합니다. 독립적으로 신뢰된 production 검증키는 아닙니다. prove:zk 실행 중에는 별도 검증 프로세스가 살아 있는 포크에서 receipt·root 순서·체결 수량·코드 hash까지 다시 읽고 검증합니다. 포크 종료 뒤에는 해당 임시 RPC 거래를 재조회할 수 없으므로 오프라인 결과를 live receipt 검증으로 표시하지 않습니다.

## 구현 경계

| 파일 | 책임 |
|---|---|
| circuits/book-transition.circom | private 두 Book, EdDSA 운용자 인증, 예약·잔액 변화·비귀속 Book 불변·96-bit 범위·root 검증 |
| src/zk/book.js | Poseidon commitment, 서명 입력, witness 생성, proof 생성 |
| contracts/integration/ZkBookVault.sol | domain/root/설정 검증, proof 검증, 원자적 실제 DEX 호출, 실제 잔액 차이 receipt, 정산 직렬화 |
| scripts/prove-zk-fork.mjs | 정상 거래·악의적 witness·악의적 공개 입력·실패 원자성 통합 시험 |
| scripts/verify-zk-evidence.mjs | 별도 공개 proof 및 live receipt 재검증 |

Book private leaf는 `[cash, asset, reservation, providerSequence, providerPubX, providerPubY]`입니다. root는 고정 Book index가 포함된 두 leaf hash, 매번 갱신한 난수, pending 주문 commitment를 묶습니다. 지분·부채·보수·다중 자산을 포함하는 전체 장부와 구분합니다.

공개 입력 순서: `phase, chainId, vault, config, batch, oldRoot, newRoot, buy, amount, minOut, deadline, amountOut, cashTotal, assetTotal, maxSpendBps`.

운용자는 chain/vault/config/batch/Book/제출 순서/주문 방향/수량/minOut/deadline/현금 사용 한도에 서명합니다. 연구용 BabyJubJub 키를 쓰며 기존 Ethereum 지갑과의 등록 증명은 아직 없습니다. 현재 입력은 구체적인 주문입니다. 팀 명세의 목표 포지션에서 주문을 만드는 계산 증명은 후속 작업입니다.

## 실제로 검사하는 것

1. 다른 운용자 서명, 다른 chain/vault 서명, 서명 후 주문 변경, 제출 순서 건너뛰기 거부.
2. 현금 사용 한도 초과, 음수 잔액, 다른 Book에 예약 귀속 거부.
3. proof의 새 root 변경 및 다른 chain 입력을 계약에서 거부.
4. 증명은 유효하지만 minOut을 만족하지 못하는 실제 DEX 거래는 예약·root까지 함께 rollback.
5. 체결 후 정산 전에는 다음 일반 batch 금지.
6. 전체 합계가 맞아도 다른 Book으로 현금·체결을 넘기는 witness 거부.
7. 체결 누락·중복 witness 거부.
8. 임의 체결 수량에 대한 수학적으로 유효한 proof도 실제 계약 receipt와 다르면 거부.
9. 체결된 거래는 주문 만료 후에도 정산 가능. 정산 proof 재사용 거부.
10. 두 Book의 매수·매도 네 건을 순서대로 정산하고 실제 token 잔고와 대조. DEX allowance 잔여 0 확인.

원본: [실행 기록](evidence/zk-book-fork.json), [독립 재검증](evidence/zk-book-verification.json). 잘못된 witness 시험 중 출력되는 `Assert Failed`는 의도한 거부 결과입니다. 스크립트 최종 종료 코드와 PASS 상태를 함께 확인합니다.

## 현재 한계와 다음 작업

- 신뢰된 genesis 대신 입금 이벤트·투자자 소유권·지분 전이를 증명해야 합니다. 연구 Vault에는 환매 API가 없습니다.
- 25% 값은 실험의 현금 지출 상한입니다. NAV 기준 target exposure 한도나 확정된 상품 정책이 아닙니다.
- 현물 한 쌍·동기식·한 번에 한 거래만 처리합니다. 외부 funding/청산/비동기 부분체결의 event cursor는 아직 아닙니다.
- 운용자 지분 잠금·staking·성과보수·oracle·복구·공개 지표 proof는 별도 개발입니다.
- 측정된 proving 시간은 해당 로컬 CPU의 값이며 TEE 성능으로 간주하지 않습니다.
- circomlib/snarkjs/circomlibjs는 GPL 계열 의존성이 포함됩니다. 제품 배포 전 라이선스 적용 범위 검토가 필요합니다.

회로가 허용한 계산이 맞다는 사실은 입력된 가격·체결 데이터가 진짜라는 뜻이 아닙니다. 이 실험은 실제 receipt 인증을 Vault에 연결하는 경계를 별도로 검증합니다.
