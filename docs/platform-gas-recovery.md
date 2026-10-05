# 실행 가스 예산 오류 복구

`TEE_GAS_BUDGET`는 트랜잭션 gasLimit이나 투자자의 AUSD 잔액 부족이 아니다. 기존 플랫폼 worker가 durable journal의 과거 지출 `spent`와 다음 거래의 최대 비용 `gasLimit * maxFeePerGas`를 합산하고, 고정된 누적 예산 3 MON과 비교하여 실행을 차단했다. 지갑을 충전하거나 CVM을 다시 시작해도 봉인된 journal의 지출 이력은 남으므로 이 제한이 풀리지 않는다.

플랫폼 worker는 이 누적 실험 예산을 사용하지 않는다. 각 신규 트랜잭션을 서명하기 전에 실행 지갑의 현재 MON 잔액이 최대 가스비와 전송 value를 모두 감당하는지 확인한다. 잔액은 [ethers Provider.getBalance](https://docs.ethers.org/v6/api/providers/#Provider-getBalance)로 조회한다. 과거 가스 지출·nonce·확정 거래·서명 바이트·전략 장부를 삭제하거나 초기화하지 않는다. 별도의 실험 runner가 명시한 누적 예산은 그대로 유지한다.

실제 MON 부족은 `OPERATOR_GAS_INSUFFICIENT`로 표시하며 해당 요청을 기존 단계와 ID로 유지한다. 실행 지갑을 충전하면 주문 유효 시간 안에서 다음 worker tick에 재개된다. 만료된 요청의 새 거래는 제출하지 않는다. 이미 서명된 거래는 이전과 동일한 journal에서 결과를 대조하며, 확정된 장부 효과는 한 번만 적용한다. 과거 `FAILED` 요청은 임의로 되살리지 않는다. 전략가는 수정 반영 후 기존 요청의 실제 체결과 상태를 확인하고 필요하면 새 목표를 제출한다.

## 반영

가스 수정 패치는 공유 계정 패치 적용 여부와 관계없이 현재 main 코드 또는 공유 계정 작업 코드에 적용할 수 있다. 이전 오류의 이력 문구 자체를 지우는 변경은 아니다. 실제 오류 해결 여부는 **수정된 worker의 반영과 새 요청 실행**으로 확인한다.

```sh
git apply ~/Downloads/veilvest-gas-fix.patch
npm_config_cache="$(mktemp -d)" npm_config_yes=true node scripts/deploy-platform-worker.mjs
```

기존 CVM, operator 정체성과 Vault를 재사용한다. 새 Vault 배포, 관리자 개인키 추출, journal 삭제 또는 원래 자금의 강제 청산은 하지 않는다. 수정된 배포 명령은 Phala 업데이트 후 `scripts/verify-platform-gas.mjs`를 실행하여 가스 관련 runtime source hash, operator 주소·암호화 공개키, 플랫폼과 TEE의 Vault 일치, 실행 연결과 실제 MON 잔액을 확인한다. 이 검사는 기존 attestation endpoint가 제공하는 manifest와 공개 설정을 대조하는 읽기 전용 확인이며, quote의 암호학적 검증을 새로 구현하지 않는다.

기존 worker만 반영한 경우 `runtime update missing` 검사가 실패한다. CLI 배포가 끝나도 이 검증이나 실제 새 주문의 실행이 확인되기 전에는 운영 오류가 해결됐다고 판단하지 않는다. `operatorFunded: true`는 잔액이 0보다 크다는 의미이며 모든 주문의 가스비를 감당한다는 뜻은 아니다.

실제 가스 지갑은 Vault가 아닌 TEE operator `0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7`다. 충전이 필요하면 **Monad testnet MON**을 이 주소에 보내야 한다. AUSD 입금은 가스 충전이 아니다.

## 검증 상태

누적 예산 초과 후 실행 지속, 명시한 실험 예산 유지, 최대 수수료·value 잔액 확인, 충전 후 동일 요청 재개, 확정된 단계 중복 방지, 만료 후 새 전송 금지 및 과거 실패 요청 보존을 검증했다. 기존 정산과 공유 계정 회귀 검증도 통과했다.

외부 통신 제한 해제 후 기존 Phala CVM을 업데이트했다. 기존 operator·암호화 공개키·Vault와 가스 관련 runtime hash 일치를 확인했고, 테스트넷 전용 전략의 120 AUSD 입금·주문·포지션 종료·예정 정산 지급이 성공했다. 지급액 119.993759 AUSD를 실제 ERC20 영수증과 대조했으며 잔여 지분과 대기 현금은 0이다. Vercel 프로덕션에도 갱신된 가스 부족 안내를 반영하고 실제 배포된 JavaScript에서 확인했다. 세부 확인 기록은 [배포 검증 기록](evidence/platform-gas-recovery.json)에 보관한다. 비공개 테스트 지갑과 전략별 장부는 `.data`에만 남긴다.
