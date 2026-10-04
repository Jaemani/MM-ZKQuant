# 코어 MVP 1–4 구현·검증 결과 · 2026-10-04

**장부 전이 ZK, 중단·재개, TEE 내부 서명·제출, 투자자 지분·보수·출금을 하나의 공개 테스트넷 운용 주기로 연결했다.** 아래의 제한된 cohort MVP가 통과했으며, 전체 제품 v1.4를 구현했다는 뜻은 아니다.

## 이번 범위

한 Product에 투자자 2명이 운용 시작 전에 입금한다. 지분은 최초 NAV 1로 발행하며 운용 중 추가 입금은 받지 않는다. 투자자 한 명이 출금을 요청하면 그 운용 주기 전체를 종료한다. 실제 Perpl 포지션을 0으로 만든 뒤 담보를 회수하고, 종료 장부를 ZK로 검증한 뒤 두 투자자에게 지급한다. 지분은 전부 소각하고 같은 계약으로 다음 주기를 열지 않는다.

이는 기존의 한 투자자·전용 계정 실험을 확장한 **한 번의 운용 주기**다. 여러 Product가 계정을 공유하는 구조, 운용 중 NAV와 추가 가입, 시리즈별 반복 HWM, 분기별 보수 확정, committee Forced Exit는 별도다. 4개 원문 회로 전체를 이 작은 종료 정산 회로로 대체한 것이 아니다.

## 요청한 1–4의 결과

| 항목 | 구현과 실제 합격 근거 | 한계 |
|---|---|---|
| 1. 장부 전이 | `perpl-cohort-ledger.circom`: 최초 장부 root → 실제 회수액·최종 거래 nonce → 청구권·성과보수·종료 root. 공개 계약이 직접 읽은 회수액/입금액/보수율을 public inputs로 구성해 proof 검증 | 전량 종료 후 현금 정산 전이. 포지션 보유 중 mark NAV·funding 귀속·공유 slot Ledger는 미구현 |
| 2. 중단·재개 | 서명된 tx를 암호화 저장하고 fsync한 후 전송. 서명/전송/영수증 직후 crash와 응답 유실 테스트, 실제 포크 주문 전송 후 엔진 재생성, 실제 TEE VM 재시작 모두 확인. 같은 요청의 tx 중복 없음 | 디스크 소실/nonce 불일치/rollback은 새 거래 없이 중단. 다중 cloud 자동 복구·committee 복구는 없음 |
| 3. TEE 운용·제출 | TDX 내부에서 거래 서명 키와 가스 relayer 키 파생, Manager 서명·기한·키 세대·수량 한도·종료 상태 검증, ZK 생성과 공개 tx 서명/제출. 실제 공개 tx sender가 quote에 묶인 TEE 주소와 일치 | Manager가 합성 목표를 작성·서명하는 것은 클라이언트. 일반 전략 프로그램 실행·PRIVATE_ONLY 제출·성능 목표는 별도 |
| 4. 지분·보수·출금 | 투자자 2명 지분 발행, 출금 요청 후 신규 진입 차단, pause 중 종료·회수·지급, 지분 소각, 원금 초과분만 성과보수, 중복 청구 거절 | terminal cohort 전용. 상시 입출금·부분 출금·유동성 부족 시 자동 재시도/지급 SLA는 없음. 회수가 실패하면 Closing에 머물고 정산·청구 불가 |

## 데이터와 상태가 움직이는 순서

1. **Funding:** 투자자 주소별 실제 ERC-20 입금액만 지분으로 기록한다. 취소는 운용 시작 전 가능하고 pause 중에도 출구가 열린다.
2. **Live:** 입금액과 총 지분으로 최초 Poseidon root를 만들고, 총 200 테스트 AUSD를 전용 Perpl 계정에 넣는다. TEE는 암호화된 목표를 받아 Manager의 EIP-712 서명과 체인·Vault·요청 nonce·기한·키 세대를 검사한다.
3. **거래:** TEE가 실제 venue 포지션과 가격을 읽고 고정 정책(시장 16, 최대 100 lot, 0.5% 주문 가격 범위)으로 주문을 만든다. TEE가 생성한 목표 승인 proof를 TEE 가스 지갑이 제출한다. Vault→전용 계정→verifier→Perpl 순서로 같은 tx에서 실행한다. 실제 수량을 snapshot 이벤트로 기록한다.
4. **Closing:** 투자자 요청으로 전체 cohort가 종료 단계에 들어간다. 목표 0만 허용한다. 이번에는 키를 0세대에서 1세대로 교체하고 pause한 후에도 새 키로 전량 종료했다. 불필요한 관리자 자금 이체 함수는 없다.
5. **Recovered:** 계약이 포지션·주문·잠금 잔액을 확인하고, Perpl에서 Vault로 들어온 실제 토큰 증가분을 고정한다. 목표 수량이나 클라이언트 보고 금액을 담보로 인정하지 않는다.
6. **Settled:** 종료 장부 proof가 투자자별 배분·보수·root를 검증한다. 총 청구권+보수=실제 회수액을 다시 검사하고 지분을 소각한다. 각 투자자만 자신의 청구권을 받을 수 있고, 지급 전에 청구권을 0으로 만든다.

보수 예시: 100/300 입금 후 440 회수, 성과보수율 20%이면 수익 10/30 중 보수 2/6을 제외해 108/324를 지급한다. 손실이면 보수는 0이다. 각 투자자의 이번 입금 원금이 해당 한 주기의 HWM이다. 첫 투자자의 배분을 내림하고 나머지를 둘째 투자자에게 배분하므로 1 최소 단위 미만의 비례배분 오차만 허용되며 총액은 보존한다. 공개 실험의 20%는 테스트 계약 설정이며 상품 보수 최적화 결과가 아니다.

## 실제 공개 결과

| 항목 | 결과 |
|---|---|
| 체인 | Monad testnet 10143 |
| 투자자 입금 | 60 / 140 테스트 AUSD |
| 실제 체결 | +100 lot 진입 → 0으로 종료 |
| 실제 회수 | **199.911176 테스트 AUSD** |
| 투자자 지급 | **59.973352 / 139.937824 테스트 AUSD** |
| 성과보수 | **0** — 손실 구간 |
| 종료 상태 | 총 지분·미지급 청구권·Vault/계정 잔액·포지션·주문 0 |
| 공개 tx | 21건, 모두 status 1 |
| 전체 가스 | **2.334507558 테스트 MON** |
| TEE 제출 주소 | `0xDA523a9D4B00904E56145E49F880293B4DBA7bBE` |
| Vault / Perpl 전용 계정 | `0x42c87A3dBDf7B4CbC20F7149045EeeE5D8e223E7` / `0x2A1d05ee5E82085Cf36275F5bC7f9ee281B6206d` |

전체 가스 비용과 별도로 TEE 지갑에 1 테스트 MON, 새 테스트 투자자 지갑에 0.3 테스트 MON을 보내 가스를 준비했다. 사용하지 않은 테스트 MON은 해당 지갑에 남는다. 실자금·메인넷 자산은 사용하지 않았다.

| 단계 | 공개 탐색기 |
|---|---|
| rotate-key | [0x8fe2ea73fa…](https://testnet.monadscan.com/tx/0x8fe2ea73fa55e1eba539131e87e660ee986b2853c6e697d035989e26b9935ab9) |
| recover | [0xad4438fcf5…](https://testnet.monadscan.com/tx/0xad4438fcf5cfa25f7916fca9019a76a2d7fc9cb7ac4962369cf6cbacb956982c) |
| ledger-settle | [0x3aa258dbd8…](https://testnet.monadscan.com/tx/0x3aa258dbd8f879351301a2af84baa3b0f624f095b6a4d5831f5930da22a28795) |
| claim-0 | [0x371af02ea8…](https://testnet.monadscan.com/tx/0x371af02ea8dc1514aba83fa9e24adaa0ce7142c0e2126ed1fc71e1121e09bd52) |
| claim-1 | [0xea3d4a0828…](https://testnet.monadscan.com/tx/0xea3d4a0828ce8d179843dd87490d6024e92f8f33176c4c3df60cdd6dc1d62700) |
| open | [0xa4a40d6f34…](https://testnet.monadscan.com/tx/0xa4a40d6f34a11ab47c6888d4bafaff64c1e6226644c18f3b9c46a85da13d66ec) |
| close-0 | [0x0379ed24e5…](https://testnet.monadscan.com/tx/0x0379ed24e51118c4a2d2d9bec7be640e1b114f9c36a57f2eabee09d240d89c21) |

## 검증 근거

- 기존 포함 JS 테스트 **430개** 통과. 회계 테스트는 1,000개 금액에 대한 보존식·반올림 범위를 검사한다.
- 로컬 Perpl 포크: 기본 21개 검사, 운용 엔진 및 실제 전송 후 중단·재개 25개 검사, 이익 fixture와 보수 지급 26개 검사. 이들은 겹치는 검사 집합이므로 합산하지 않는다.
- 이익 fixture는 로컬 impersonation으로 venue에 20 테스트 AUSD를 추가한 조건이다. 실제 전략 수익이나 공개 체인 수익으로 표시하지 않는다. 공개 실행은 손실 사례였다.
- 위조 지분·잘못된 root·부풀린 청구권·배분·보수는 witness 생성 또는 계약 검증에서 거절됐다. 공개 증명의 calldata·계약 입력·실제 지급액은 별도 검증기로 대조했다.
- 실제 TEE 재시작 후 새 challenge로 quote를 확인했다. 동일 운용 주소와 두 세대 공개키가 복구됐고, 저장된 기존 요청은 기존 tx hash를 반환했다. 운용 지갑 nonce는 바뀌지 않았다.
- 실제 TEE에서 잘못된 Manager 서명·폐기된 세대·기한 만료·101 lot 요청·정산 종료 후 주문을 거절했다. 이 검사들은 실패 tx를 채굴한 것이 아니라 TEE에서 제출 전에 거절한 것이다.
- VM을 끈 뒤 공개 실행 도구를 다시 실행해도 추가 tx는 0건이다.
- 별도 검증기는 영수증, 배포 calldata/runtime, 실제 TEE sender, 두 주문의 내부 호출, 종료 장부 proof, 독립 회계 계산, 각 투자자 Transfer와 최종 잔액을 확인한다. TDX quote와 배포 소스 hash도 재검증한다.

[공개 실행](evidence/cohort-public.json) · [독립 검증](evidence/cohort-public-audit.json) · [TEE 재시작/거절](evidence/cohort-tee-restart.json) · [로컬 엔진](evidence/cohort-operator-local.json) · [이익·보수 fixture](evidence/cohort-profit-local.json).

## 재검증·실행 명령

```sh
npm ci
npm test
npm run verify:cohort:testnet
```

공개 결과 재검증에는 키·`.data`·proving key·실행 중 TEE가 필요 없다. 과거 상태와 callTracer를 제공하는 공식 RPC, Phala quote 검증 API가 필요하다. 이 API/공급자 신뢰와 단독 Groth16 setup 한계는 남는다.

```sh
# 새 로컬 실험. 기존 target circuit 산출물은 보존한다.
npm run build:cohort-zk
npm run prove:cohort:fork
npm run prove:cohort:profit
```

`build:cohort-zk`는 종료 정산 회로의 별도 산출물만 만든다. 원래 target proof 산출물은 다시 만들지 않는다. 하드웨어 실험은 `prepare:cohort:tee` → Phala compose 반영 및 실제 compose hash 고정 → `MM_COHORT_TEE_ENDPOINT=<HTTPS ingress> npm run prove:cohort:testnet` 순서다. 이미 존재하는 client manifest/실행 journal은 덮어쓰지 않는다. `verify-cohort-tee-restart.mjs`는 VM 재시작 후 실행하는 온라인 검사다.

## 운영 제한과 다음 경계

실험 관리자(controller)가 pause·운용 시작·키 교체를 관리한다. 운영 거버넌스·업그레이드·다중 운용자 권한 구조는 아니다. 암호화 journal이 소실되거나 과거 버전으로 돌아가면 체인 nonce 대조로 거래를 중단하며, 자동으로 안전 복구를 완료한 것으로 주장하지 않는다. 정상 요청의 임의 가격 선택은 허용하지 않지만 oracle 공격·청산·전역 출금 혼잡·장기간 funding까지 검사한 것은 아니다.

TEE VM은 실험과 재시작 검사 후 **Stopped**를 확인했다. 종료 후 prepaid·auto-topup OFF, 크레딧 $19.01을 관측했다(시작 전 $19.03). 초기 $20 대비 누적 차감 관측은 $0.99이며 반영 지연/반올림이 있을 수 있다. 카드 자동 충전을 켜거나 기존 $2 예산을 늘리지 않았다. 디스크는 암호화 journal 재현을 위해 삭제하지 않았으므로 보관 비용이 남을 수 있다. 종료 화면은 [증거](evidence/cohort-phala-stopped.jpg)에 있다.

**이 결과를 기준으로 코어 시나리오를 시연할 수 있다.** 다음 확장은 여러 운용 주기·중도 가입/부분 출금·비공개 귀속이며, 이번 테스트 완료와 별도로 판단한다.
