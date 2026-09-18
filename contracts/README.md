# Epoch commitment registry

이 문서는 기존 commitment-only 계약의 실행 안내다. 예치·지분·롱/숏 체결·차입 상환·보상·환매가 포함된 후속 계약은 [pilot/PilotFund.sol](pilot/PilotFund.sol), 실행 순서는 [Pilot runbook](../docs/pilot/runbook.md), 실제 배포·인수 결과는 [최신 증거](../docs/evidence/pilot-readiness.md)를 따른다.

이 계약은 epoch의 제출 root와 policy/roster/weights 등을 묶은 manifestHash만 기록한다. 자금 수령·vault·거래·reward 지급 기능은 없다. Merkle proof의 위치 기반 SHA-256 검증은 offchain verifier가 담당한다.

현재 제공 범위는 Solidity 계약, 실제 EVM bytecode를 실행하는 로컬 harness, Monad testnet 배포 준비 도구다. 설정 예제의 주소와 tx는 null이며 실제 testnet 배포를 의미하지 않는다.

## 로컬 검증

루트에서 의존성을 설치한 뒤:

~~~bash
rtk proxy node --test tests/contracts.test.js
rtk npm run chain:demo
~~~

chain-demo는 @ethereumjs/vm에 서명된 transaction을 실행하고 constructor→anchor→getCommitment를 검증한다. block 시각은 합성값이고 RPC/외부 네트워크를 사용하지 않는다. 체인 ID는 31337이며 ephemeral local state다. fixture 실행은 SYNTHETIC_FIXTURE, 실제 서버 manifest 입력은 SUPPLIED_MANIFEST로 표시된다.

앱에서 봉인한 epoch manifest를 GET /api/epochs/:id/manifest?workspace=demo로 저장한 뒤:

~~~bash
rtk proxy node scripts/chain-demo.mjs --manifest /absolute/path/epoch-manifest.json --output /absolute/path/local-anchor.json
~~~

서버 기본 API 주소는 http://127.0.0.1:8790이다. full manifest가 있으면 canonical SHA-256과 epochId/submissionRoot 일치를 anchor 전에 검사한다. tree proof 자체와 provider signature는 별도 receipt verifier로 확인한다. 로컬 transaction hash는 Monad explorer에서 조회할 수 없다.

ABI와 bytecode만 내보내려면:

~~~bash
rtk proxy node scripts/chain-demo.mjs --compile-only --output /absolute/path/registry-artifact.json
~~~

compiler version과 source SHA-256을 artifact와 evidence에 함께 보존한다. EVM target은 shanghai다. package lock을 사용해 재현하며 solc의 tmp dependency는 보안 수정 버전으로 scoped override되어 있다.

## Monad testnet 배포 준비

[설정 예제](monad-testnet.config.example.json)의 예상 chainId는 10143이다. 작업 시 [Monad 공식 문서](https://docs.monad.xyz/)에서 사용 네트워크와 RPC를 확인하고 testnet 전용 계정에 faucet gas만 준비한다. 필요한 환경 변수는 MONAD_TESTNET_RPC_URL, MONAD_TESTNET_PRIVATE_KEY이며 기존 계약을 이어서 쓸 때만 REGISTRY_ADDRESS를 설정한다. 이 파일과 evidence에 private key를 넣지 않는다.

먼저 network 접근이나 broadcast 없이 manifest와 compiler 입력만 확인한다:

~~~bash
rtk proxy node contracts/deploy-testnet.mjs --manifest /absolute/path/epoch-manifest.json
~~~

준비된 계정과 RPC로 실제 testnet deployment/anchor를 실행할 때만 다음 명령을 쓴다:

~~~bash
rtk proxy node contracts/deploy-testnet.mjs --manifest /absolute/path/epoch-manifest.json --broadcast --output /absolute/path/monad-testnet-anchor.json
~~~

--broadcast가 없으면 transaction을 전송하지 않는다. script는 RPC chainId가 10143인지 확인하고 다른 네트워크에서는 중단한다. 신규 contract의 publisher는 해당 signer이며 변경 불가다. deployment hash와 예상 주소를 receipt 대기 전에 evidence에 저장한다. 이후 anchor hash·readback·block/time을 기록한다.

지금 저장소의 testnet 실행기는 준비된 도구이며 실제 RPC/faucet/account로 배포·검증한 증거는 아니다. 외부 실행 전 local tests를 통과시키고 실제 실행 결과를 별도로 보존한다.

## 중단·재시도·검증

1. transaction 전송 뒤 응답이 불확실하면 evidence의 deployment/anchor hash를 먼저 조회한다. 바로 새 계약을 다시 배포하지 않는다.
2. 이미 배포된 주소는 REGISTRY_ADDRESS로 지정하고 새 evidence 경로로 재개한다. signer가 publisher인지 확인한다.
3. 같은 epochKey에 같은 root/manifestHash가 이미 있으면 ALREADY_ANCHORED로 처리하고 추가 anchor를 보내지 않는다. 다른 값이면 중단한다.
4. client에서 기다린 receipt와 별도로 testnet의 확정 상태·chainId·배포 bytecode/source·publisher를 확인한다. 앱의 anchor status를 갱신하는 자동 연동은 후속 작업이다.
5. outcome 시작 전 publication 보장을 평가하려면 실제 확정시각을 startAt와 비교한다. 늦은 anchor는 제출 시점의 독립 증거가 아니다. 서버 roster의 완전성도 별도로 확인한다.

publisher key를 잃으면 이 계약을 갱신할 수 없다. 잘못된 root를 기록해도 해당 epoch를 덮어쓸 수 없다. 새 registry/policy version으로 이관하고 기존 주소와 실패 사유를 기록한다. root를 고쳐서 과거 epoch가 처음부터 올바르게 기록된 것처럼 처리하지 않는다.
