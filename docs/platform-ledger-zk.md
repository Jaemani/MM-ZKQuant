# 플랫폼 장부의 주기적 ZK 증명

실제 TEE 장부의 금융 전이를 5분마다 Groth16 증명 체인으로 만들고, Monad 테스트넷의 별도 검증 계약에 기록한다. 전략 제출은 계속 원하는 시점에 처리한다. 기존 단일 Vault, Perpl 계정 배정, 투자·주문·정산 주기는 바뀌지 않는다.

## 검증하는 내용

`ledger.mjs`, `execution.mjs`, `shared-accounts.mjs`의 실제 금융 변경과 전이 기록은 같은 암호화 장부에 함께 저장된다. 체크포인트에서는 모든 전략의 기록과 금융 상태를 원자적으로 동결한다. 기록을 재생한 잔액·지분·HWM이 실제 스냅샷과 일치해야 증명을 시작한다. 반복되는 평가 관측은 금융 변경 또는 체크포인트 사이에서만 합친다.

회로는 비공개 전략 장부와 투자자 행, 투자 건별 HWM Merkle 경로를 인증한다. 대기 입금, NAV에 따른 지분 발행의 정수 나눗셈, 투자 건별 HWM 보수와 실제 소각 보수의 반올림, 비례·잔여 지분 소각, 출금 시 소각 지분과 지급액의 장부 차감, 대기 현금 출금, 거래소 현금 이동, 보수 지급, 평가/NAV 갱신, 보수율 변경을 검증한다. 전체 지분은 투자자 지분 합과 같아야 하며 잔액은 음수가 될 수 없다. 보수율 상한은 20%다.

가격·체결·실제 송금액·출금 비용·지급액 결정·투자자 인증의 사실 여부와 주문/리스크 정책 실행은 TEE의 책임이다. 이 회로는 이 외부 입력으로 수행한 장부 계산을 증명한다. 거래소 수익의 진위, Vault 전체 자산에 대한 지급 능력 또는 투자자 서명을 회로만으로 증명하지 않는다.

## 공개 정보와 비공개 정보

공개 신호는 일곱 개다: 체인 ID, Vault 주소, 증명 순서, 전체 장부 체크포인트 시각, 이전 root, 다음 root, 비공개 이벤트 커밋먼트. 장부 root와 이벤트 커밋먼트는 비공개 난수로 블라인딩된다. 전략 ID, 선택된 전략, 투자자 주소·금액·지분, HWM, 포지션, 전이 내용, witness 및 Merkle 경로는 공개 API나 데이터베이스에 보내지 않는다. 공개 증명 수와 전체 체크포인트 시각은 관찰할 수 있다.

기존 장부는 기능 도입 시 TEE가 인증한 genesis에서 시작한다. `/attestation`의 quote에 genesis root, 검증키 hash, 검증 계약을 포함한다. 이전 거래가 소급하여 ZK 검증되었다고 표시하지 않는다. TEE 운용자가 공개 증명 payload에 서명하며, 온체인 계약도 이 운용자만 호출할 수 있다.

## 재시작과 실패

비공개 체크포인트 작업, witness, 다음 mirror와 난수는 기존 sealed store에 저장된다. 증명 생성은 별도 프로세스에서 IPC로 수행하며 witness를 평문 파일이나 로그에 쓰지 않는다. 생성 후 검증키로 검증하고 공개 증명 파일을 fsync한 다음 장부 root를 진행시킨다. 중간 재시작 시 이미 저장된 같은 증명을 재사용한다.

온체인 제출은 투자 실행과 같은 mutex 및 기존 durable signed-transaction journal을 사용한다. 동일 nonce/서명 거래를 재조정하며 이중 제출하지 않는다. 검증 계약은 체인·Vault·이전 root·순서·시간과 실제 Groth16 증명을 검사한다. 장부와 기록의 불일치, 가스 부족, 회로 용량 초과, 증명 실패 시 마지막 완료 체크포인트를 유지하고 상태를 공개한다. 누락된 전이를 제외하거나 genesis를 다시 설정하지 않는다. 증명은 사후 감사이며 투자 실행을 증명 주기에 묶지 않는다.

현재 회로 한도는 전략 4,096개, 전략당 투자자 16명, 투자자당 활성 투자 건 64개다. 소진된 투자 건 슬롯은 재사용한다. 용량을 넘으면 새 증명이 중단되고 `ATTENTION_REQUIRED`로 표시된다. 금융 처리는 계속되므로 운영 시 이 상태를 확인하고 회로 확장을 계획해야 한다. sealed store의 평문 크기 한도는 64 MB다.

## 배포와 공개 검증

- Vault: `0xdC4e5675cD4b4E10E1D2274Abc3Fd9100c0334b6`
- Verifier: `0x3fa3A887833A3abE59D97b97AAD92f0c9A7a3dC4`
- Checkpoint: `0xDFd9188E5CC1A72a9f9D68ad65e698e51950D822`
- 공개 아티팩트: `/zk/platform-ledger-v1/manifest.json`, `deployment.json`, `verification-key.json`, `circuit.wasm`, `proving.zkey`, `LedgerVerifier.sol`
- 공개 API: `GET /api/v1/ledger-proof-status`, `GET /api/v1/ledger-proofs?after=0&limit=50`
- UI: 전략가 운용 화면의 개요, 투자자의 내 자산 화면에 체크포인트 시각·상태·검증 거래·공개 증명 링크를 표시한다.

```bash
npm run test:ledger-zk
npm run verify:ledger-zk
```

독립 검증 도구는 공개 증명만 사용한다. 저장소의 배포 주소와 검증키를 기준으로 실제 bytecode, 도메인, 서명, genesis부터의 증명/root 연속성, Groth16 증명, 각 온체인 거래 calldata와 성공 receipt·이벤트를 확인한다. 공개 TEE identity에 포함된 genesis와도 대조한다. 이 도구 자체가 하드웨어 quote의 인증서 체인을 검증하는 것은 아니다. 결과는 `docs/evidence/platform-ledger-zk.json`에 기록한다.

2026-10-06 실제 배포에서 두 체크포인트 사이 간격은 302초였고, genesis부터 9개 증명을 독립 검증했다. 자체 테스트 지갑의 실제 0.01 AUSD 입금 이후에도 체크포인트가 이어졌으며, TEE 재시작 전후 genesis·root·순서가 유지됐다. 마지막 확인 거래는 `0xbfded43782cd6b0a1b6a86d1711575b8a2fdc9e8c237d07549b5a09b36d914ce`다. 전략가·투자자 화면과 모바일에서 검증 상태와 거래 링크가 표시되고 최신 dark workspace 디자인이 유지됨을 확인했다. 추가 결과는 `docs/evidence/platform-ledger-validation.json`에 있다.

배포 시 `npm run deploy:ledger-zk`는 `.env`의 기존 Monad 테스트넷 배포 키를 사용하며 중단 후 같은 트랜잭션 journal로 이어간다. 먼저 Vercel에 아티팩트를 배포하고 기존 Phala CVM을 `node scripts/deploy-platform-worker.mjs`로 갱신한다. 기존 Vault를 대체하지 않는다. 증명 파일과 검증키 hash는 TEE manifest에 고정하며, 다른 회로/키를 기존 root에 조용히 연결하지 않는다.

워커 부트스트랩은 48 KB 이하의 환경변수 청크로 포장해 Linux 단일 실행 인자 한도를 넘지 않는다. 실패한 업데이트로 기존 HTTP 워커가 내려갔다면, 같은 Vault에서 앞서 확보한 `reusedIdentity: true`의 로컬 client manifest를 `--resume-manifest=.data/platform-tee-<timestamp>/client.json`으로 지정해 같은 TEE identity를 복구할 수 있다. 새 identity나 genesis를 자동 발급하지 않는다. 로그 공개는 켜지 않는다. 온체인 기록에는 기존 운용자 지갑의 테스트 MON 잔액이 계속 필요하다.

## 설정의 출처와 한계

Circom 회로의 공개 phase 1은 [snarkjs 공식 안내](https://github.com/iden3/snarkjs)에 실린 `powersOfTau28_hez_final_16.ptau`이며 다운로드의 Blake2b hash를 확인했다. 이 배포의 phase 2는 단일 참여자 테스트넷 설정이다. 실제 운영에는 검토된 회로와 다자 ceremony가 필요하다. 새로운 키를 만들 때는 별도 verifier와 명시적인 장부 마이그레이션이 필요하다. 배포된 키를 개발 빌드로 덮어쓰지 않는다.

회로 원본과 생성된 제약식, 검증키와 설정 hash, 전체 공개 아티팩트를 저장소에 제공한다. 제약식 작성은 [Circom 공식 문서](https://docs.circom.io/circom-language/constraint-generation/)를 따른다. `npm run build:ledger-zk`는 원본 변경과 기존 키의 불일치를 거절하며 이미 배포된 키를 임의로 재생성하지 않는다.
