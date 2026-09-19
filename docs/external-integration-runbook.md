# 외부 DEX·TEE 검증 실행 기록과 다음 단계

## 지금 확인한 결과

`docs/evidence/external-fork.json` 및 `external-fork-verification.json`에 실행 결과를 저장한다. 이 파일은 **Monad 메인넷 상태를 가져온 로컬 Anvil fork**의 증거다. 메인넷에 거래를 보낸 것이 아니며 승인 키는 이 시험에 한해 임시 소프트웨어 키다. 실제 TEE 완료로 계산하지 않는다.

- Uniswap v3 WMON/USDC 0.05% 풀·Router·Quoter의 실제 배포 코드를 fork에서 사용.
- 로컬 fork의 MON을 WMON으로 감싼 뒤 실제 Router로 USDC를 교환하여 시험 자금을 마련. USDC 저장소 조작이나 기존 보유자 사칭 없음.
- 2개 전략 예치·배정 → A만 25% 현물 매수 → A 전량 매도 → B와 A 각각 환매.
- 6개 서명 상태 전이, 준비 거래를 포함한 15개 거래. B의 원래 현금 권리 보존, 최종 Vault 자산·잔여 Router 승인 0 확인.
- 별도 검증기가 RPC 영수증, fork 블록 해시, EIP-712 서명, 코드 해시, 순서·checkpoint를 다시 대조.
- 16개 의미 있는 거절·복구·격리 검사. 이전 장부 복원과 체결 후 저장 실패를 포함.

재현:

```sh
rtk npm ci
rtk npm run prove:external
rtk npm run test:integration
```

`prove:external`은 사용 가능한 로컬 포트에 Anvil을 띄우고 종료 시 닫는다. 실행 시작 시 원격 블록을 고정한다. `MM_FORK_BLOCK`으로 특정 블록을 선택할 수 있으며 RPC에 그 시점의 상태가 남아 있어야 한다. 외부 RPC는 읽기 전용으로 사용하고, 송신은 loopback Anvil 및 chainId 31337 검사 후에만 한다. 테스트용 실행 가스 상한은 거래당 1,000,000이며 실제 배포 시에는 추정치와 비용 한도를 별도로 검증해야 한다.

## 기존 MVP와 관계

새 외부 검증 경로는 `contracts/integration/ApprovedVault.sol`과 `src/integration/`에 있다. 기존 대시보드·SleeveVenue 테스트·오래된 테스트넷 자금은 수정하지 않았다. 기존 코드 전체를 새 TEE 경로로 이관했다는 뜻이 아니다.

실험 범위는 현물 한 쌍, 전략 둘, 성과 보수 0이다. 입력은 제공자가 서명한 목표 비중 25% 또는 0%다. 실행기가 주문 수량을 계산하므로 단순한 목표→주문 경로는 있다. 포지션이 있는 전략의 신규 배정·환매는 거절한다. 이 제한으로 이번 실험에서 조작 가능한 가격으로 지분을 발행하지 않는다. 일반적인 alpha 해석, 포지션 보유 중 신규 투자·환매, 숏·청산·성과보수 검증은 완료하지 않았다.

## Vault가 강제하는 것

운영자의 직접 출금이나 임의 calldata 호출이 없다. 지정한 승인 키, 거래소, 토큰 쌍, 수수료 tier, 정책 hash를 배포 시 고정한다. EIP-712 승인에 chainId·Vault·정책·순서·이전 checkpoint·요청 식별자·입력 commitment·금액·minOut·수령자·만료를 묶는다. 실제 잔액 변화로 체결 수량을 기록하고 Router 잔여 승인을 지운다.

미배정 예치는 1시간 후 원래 투자자가 회수할 수 있다. 이미 배정된 자산은 승인 키가 필요하다. 키 영구 분실·서비스 영구 중단에 대한 탈출 경로는 아직 없다. 따라서 실자금 규모 확대 전에는 키 교체·복구 정책과 별도 검토가 필요하다.

## TEE 배포 준비

`deploy/tee/Dockerfile`은 amd64 이미지다. 기반 이미지 digest와 npm lockfile을 고정한다. Dockerfile별 allowlist 및 루트 .dockerignore로 기존 데이터·키·환경 파일을 빌드에 포함하지 않는다. 로컬 이미지 빌드는 확인했지만 registry 게시·Phala 배포는 아직 하지 않았다.

```sh
rtk proxy docker build --platform linux/amd64 -f deploy/tee/Dockerfile -t mm-confidential-poc:local .
rtk proxy node scripts/prepare-tee-config.mjs
```

준비 스크립트는 `.data/integration-live/`에 별도 PoC 지갑과 배포 예정 주소·정책을 만든다. 개인키는 출력하거나 Git에 넣지 않는다. 가스나 자산을 전송하지 않는다. deployer의 예정 nonce를 다른 거래에서 소비하면 Vault 주소가 달라지므로 설정 재검토가 필요하다.

실제 배포 순서:

1. Phala 계정/워크스페이스 및 사용할 비용 한도 확인. 현재 계정 여부 답변 대기.
2. 비공개 소스의 이미지가 허용된 registry에서 읽히도록 설정. 임의로 이미지를 공개하지 않는다. Compose에는 게시된 이미지의 `@sha256` digest를 사용.
3. `runtime.json`을 Phala의 암호화 환경변수 `MM_TEE_CONFIG_JSON`으로 전달. 지갑 개인키는 CVM에 넣지 않음.
4. dstack socket을 연결하고 서버를 시작. 승인·입력 암호화·장부 저장 키를 별도 경로로 파생. simulator 환경변수나 하드웨어 소켓 부재를 정상 TEE로 대체하지 않음.
5. 이미지/Compose·OS·KMS 정책을 독립 검토하여 `expected-attestation.json`의 측정값을 채움. endpoint가 준 값을 자동으로 신뢰해 채우지 않음. 현재 null 측정값은 검증 실패가 정상.
6. fresh nonce에 묶인 증명을 검증하고, 증명에 결속된 승인 키로 새 Vault 배포를 준비. 계약은 TDX 자체를 검증하지 않으며 **초기 키 등록의 증명 검증은 외부 배포 절차의 신뢰 경계**다.
7. 사용자가 지정한 실제 자금/가스 상한과 지갑 준비 후 배포·예치·체결·환매를 수행. 현재 mainnet broadcast 스크립트나 자동 입금은 활성화하지 않음.

```sh
rtk npm run verify:tee -- https://CVM-ENDPOINT .data/integration-live/expected-attestation.json
```

서명 envelope 경로를 세 번째 인자로 전달하면 검증된 암호화 키로 요청을 보내고, 응답을 로컬 권한 0600 파일로 저장한다. 명령 응답은 승인 패키지이며 자동으로 온체인에 송신하지 않는다.

## TEE 검증의 정확한 범위

현재 verifier는 Phala HTTPS API에 Intel DCAP 서명·collateral 검증을 의존한다. 반환된 quote checksum을 원문과 대조하고, 코드/설정/키/nonce binding, TDX 종류, debug 비활성, MRTD·RTMR0~3 pin을 검사한다. 로컬 합성 응답 단위 테스트는 이 입장 정책만 검증하며 하드웨어 증거가 아니다.

독립적인 Intel DCAP verifier, KMS 자체 attestation과 upgrade governance의 완전한 감사, 원격 RPC에 대한 검증된 상태 증명은 아직 없다. 공개 네트워크 실행기는 `finalized` 기준으로 확인하되 설정된 RPC를 신뢰한다. 암호화된 디스크는 기밀성과 변조 방지를 제공하고, 체인 checkpoint는 과거 상태에서의 진행을 막는다. 경쟁 인스턴스나 잃어버린 pending 로그를 자동 합병하지 않고 중단한다.

현재 서비스에서 `VIEW`는 서명자 자신의 지분 또는 제공자가 소유한 전략의 상태만 암호화해서 반환한다. 장부 salt·다른 투자자의 주소 목록·개인키를 응답하지 않는다. 공개 온체인 거래의 시각·수량에서 발생하는 추론은 TEE로 제거되지 않는다.
