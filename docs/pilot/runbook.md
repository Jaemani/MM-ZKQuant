# TEE 제외 Pilot 실행 안내

현재 코드에는 예치·지분·롱/숏 체결·상환·환매·보상 계약과 공개 가격 수집, 서명 제출 클라이언트가 연결되어 있다. **공개 테스트넷 최종 인수에는 테스트 MON과 실제 독립 운영자 3명 이상의 참여가 필요하다.** 로컬 시험용 키를 독립 참여자로 표시하지 않는다.

최신 상태는 [자동 재현 보고서](../evidence/pilot-readiness.md), 정책·API는 [개발명세](development-spec.md)를 본다. 이전 PAPER 앱과 예전 결함 기록은 비교용으로 보존했다.

## 1. 지금 검토할 수 있는 실행

Node.js 22.13 이상, 저장소 루트에서 실행한다.

```bash
rtk npm ci
rtk npm test
rtk npm run prove:mvp -- --strict
rtk npm run build
rtk npm start
```

화면은 http://127.0.0.1:8790 의 **Pilot evidence**가 시작점이다. Kraken 원자료 수집, epoch별 commit/execution/payout, 실현손익과 reference attribution, 다음 weights, 전체 증거 JSON을 확인한다.

`prove:mvp`는 로컬 EVM에서 새 계약·장부를 만들고 롱 매수와 숏 차입/매도, 재매수/상환, 보상, 환매를 두 epoch 동안 실행한다. 거래 로그로 별도 회계를 재구성하고 실제 공개 가격을 수집한다. 기존 `.data/alpha.sqlite`는 사용하지 않는다. 소스와 원자료 지문을 결과에 기록한다.

- strict 종료 **0**: 외부 제품 조건까지 충족.
- strict 종료 **2**: 구현 실험은 성공했지만 외부 실행·참여자 근거가 부족.
- 종료 **1**: 실험 실패, 원자료 문제, 계산/로그 불일치. 원인을 해결하기 전 통과시키지 않는다.
- 기본 실행의 종료 0은 재현 성공만 뜻한다. 제품 판정 문자열을 함께 확인한다.

이전 프로토타입의 반례는 `rtk npm run prove:legacy -- --strict`로 별도 재현한다. 기존 LOO 정책의 약점을 지워 버리지 않고 비교 근거로 남겼다.

## 2. 테스트넷 가스 준비

전용 지갑은 `.data/testnet-pilot/wallet.json`에 0600 권한으로 저장되어 있다. 키를 채팅·증거 JSON에 넣지 않는다.

```bash
rtk npm run pilot -- init
rtk npm run pilot -- status
```

현재 생성된 주소: `0xA761529aE65a0966125C47911DEDCC7F23951D57`.

[Monad 공식 faucet](https://faucet.monad.xyz)에서 **testnet MON**을 준비한다. faucet의 로그인·자격 확인·CAPTCHA가 있으면 사용자가 완료한다. 메인넷 MON을 이 작업에 사용하지 않는다. 네트워크는 [Monad 공식 테스트넷 정보](https://docs.monad.xyz/developer-essentials/testnet)에 나온 chain ID **10143**, 기본 RPC `https://testnet-rpc.monad.xyz`다.

다른 전용 지갑을 쓸 때는 로컬 JSON에 `privateKey`, 선택적으로 `rpcUrl`을 설정하고 모든 명령에 `--config /절대/경로.json`을 붙인다. `MONAD_TESTNET_RPC_URL`로 RPC만 덮어쓸 수도 있다. 공급자의 개인 서명키와 운영자의 테스트넷 거래키는 별개다.

가스가 0이면 배포가 `TESTNET_GAS_REQUIRED`로 중단된다. 배포는 새 테스트 토큰 5개, 교환/차입 계약, 펀드 계약과 유동성·테스트 자본을 만든다. 필요한 가스는 당시 네트워크 가격에 따라 달라지며 잔액이 부족하면 동일 journal로 재개한다.

## 3. 계약 배포와 테스트 자본

```bash
rtk npm run pilot -- deploy --broadcast
```

`--broadcast`와 chain ID 10143 검사를 모두 통과해야 전송한다. 예치자는 기본 전용 지갑이며 100,000 tUSD를 예치한다. tUSD/tBTC/tETH/tMON/tSOL은 **직접 발행한 테스트 토큰**으로 실물 교환권이 없다. 교환소도 직접 배포한 constant-product 테스트 거래소다. 매수/매도와 대차는 실제 ERC-20 잔고·담보·부채를 변경하지만, 독립적인 실거래 유동성이나 경제적 수익성을 증명하지 않는다.

가격 변화는 실제 Kraken 관측에서 가져온다. 테스트 유동성의 가격을 그 관측으로 조정할 때도 reserve 값을 덮어쓰지 않고 운영자 지갑의 실제 swap을 실행하여 기록한다. 이 거래는 `beginLiquidity`/`endLiquidity`로 구분하며 독립 시장조성자의 거래라고 하지 않는다.

배포 주소는 `deployment.json`, 서명된 거래와 nonce/hash는 `transactions.json`에 보존된다. raw transaction은 공개 API로 내보내지 않는다. 가스비는 운영자의 native MON 비용으로 별도 기록되며 tUSD NAV에 숨겨서 포함하지 않는다.

## 4. 실제 제공자 온보딩

각 제공자가 자기 장치에서 자기 서명키를 생성한다. 동일 운영자의 여러 키는 같은 Economic Actor에 연결하며, 별개의 사람인 것처럼 중복 승인하지 않는다.

같은 로컬 서버에 접근할 수 있는 클라이언트:

```bash
rtk npm run pilot:provider -- enroll --name '제공자 이름' --payout 0x수취주소 --key-file /개인/경로/provider.json
```

SDK의 원격 URL은 HTTPS를 요구한다. 현재 서버는 localhost guard가 있으므로 임의의 공개 인터넷 배포가 구성됐다는 의미는 아니다. 공개 서버를 새로 열지 않고도 아래 파일 방식으로 서로 다른 장치의 서명 제출을 전달할 수 있다.

제공자 장치에서:

```bash
rtk npm run pilot:provider -- enroll --offline --name '제공자 이름' --payout 0x수취주소 --key-file /개인/경로/provider.json --output enrollment.json
```

운영자 장치에서 공개 등록 파일만 받아:

```bash
rtk npm run pilot -- ingest-enrollment --file /받은/경로/enrollment.json
rtk npm run pilot -- approve --request 등록요청ID --subject 동일운영자에항상같은식별자 --evidence /로컬/독립운영자확인기록.txt
```

확인 기록에는 누가 어떤 제공자를 소유하는지와 확인한 사람·시점을 남긴다. 코드가 독립 인간을 자동 판별하는 것은 아니다. 서명 등록과 검토 기록 digest를 roster에 묶어 책임과 변경 이력을 남긴다. 같은 소유자의 추가 키는 `pilot -- link-key --actor 운영자ID --request 등록요청ID`로 연결한다. 공개 HTTP API에는 승인 기능이 없다.

## 5. 서명 alpha → 연속 운용

서로 다른 전략의 참조 클라이언트도 포함되어 있다. `momentum`, `reversion`, `relative`는 공개 Kraken 분봉으로 계산한다. 이 셋을 운영자가 실행했다고 실제 독립 참여자 3명이 되는 것은 아니다.

각 승인된 제공자는 다음을 별도 터미널에서 실행할 수 있다:

```bash
rtk npm run pilot:provider -- watch --strategy momentum --cycles 2 --key-file /개인/경로/provider.json
```

운영자는:

```bash
rtk npm run pilot -- cycle --cycles 2 --broadcast
```

실제 제출 시간 60초와 anchor 여유, 정렬된 분봉 시작·종료를 기다린다. 필요하면 `--submission-seconds 600`처럼 제출 창을 늘린다. 모든 제공자가 제출했다는 이유로 마감이나 평가 시간을 앞당기지 않는다.

파일 방식은 `pilot -- open --submission-seconds 600 --broadcast` 후 `/api/pilot/status` 응답을 제공자에게 전달한다. 각 제공자는:

```bash
rtk npm run pilot:provider -- prepare --context public-context.json --vector '[10000,0,0,-5000]' --key-file /개인/경로/provider.json --output alpha.encrypted.json
```

운영자가 마감 전에 `pilot -- ingest-alpha --file alpha.encrypted.json`으로 접수한다. 파일을 만든 시각은 접수 시각이 아니다. 동일 epoch의 다른 vector 교체, 사칭, 미승인 키, 마감 이후 새 제출은 거부한다. 같은 서명 제출의 재전송은 같은 receipt로 귀결된다.

제공자는 alpha 원문과 공개 commitment에 각각 서명한다. 공개 commitment에는 epoch·운영자·키·정책·원문 hash만 들어간다. 최종 검증기는 최소 3명의 실제 제출 서명, 서버 접수 서명, 마감, 전체 roster의 제출/누락 leaf, Merkle proof, 온체인 root를 대조한다. 등록 서명만으로 제출했다고 판정하지 않는다. 원문 vector와 nonce는 이 공개 검증에 필요하지 않다.

단계별 실행도 가능하다: `open`, `seal`, `execute`, `settle`에 각각 `--broadcast`를 붙인다. `seal`은 cutoff 이후 start 이전, `execute`는 start 이후 end 이전, `settle`은 end 이후에만 가능하다. Kraken의 정확한 시작·종료 분봉을 사용한다. 늦게 anchor를 확정하면 취소하고 새 epoch를 연다.

## 6. 환매와 최종 판정

```bash
rtk npm run pilot -- redeem --request review-redemption-001 --broadcast
rtk npm run prove:mvp -- --strict
```

환매 request ID와 서명 거래는 재사용한다. 재시작 후 현재 shares가 0이어도 처음 보존한 환매량으로 기존 tx를 조회하므로 중복 출금을 만들지 않는다.

최종 검증기는 기록된 JSON의 PASS 값을 신뢰하지 않는다. 공개 RPC에서 receipt·block·finalized 상태를 다시 조회하고, 현재 검토 소스와 배포 constructor bytecode를 비교한다. commit/market/evaluation/next-weight hash, 실제 token transfer와 swap, 차입/상환, 지분·고점 수수료·환매를 거래 로그에서 재구성한다.

양수의 실제 지급이 없거나 독립 제공자 기록이 없으면 G1/G5를 통과시키지 않는다. 손실인 epoch에 테스트를 통과시키려고 보상을 발행하지 않는다. 더 오래 forward 관측하거나 별도 양수 epoch가 필요할 수 있다.

## 7. 중단·재시도

- 프로세스가 중단되면 같은 `.data/testnet-pilot`을 유지한다. tx는 서명한 원문과 hash를 디스크에 flush한 후 전송하므로 응답을 잃어도 새 nonce로 재전송하지 않는다.
- `command.lock`은 동시에 두 운영 명령을 실행하지 못하게 한다. crash 후 남았으면 파일의 PID에 해당하는 프로세스가 종료됐는지 확인한 뒤 그 lock만 제거한다. `transactions.json`과 키 파일은 지우지 않는다.
- 실행 전 기한을 놓쳤으면 start 이후 `pilot -- cancel --broadcast`. 제출 의무·누락 이력은 남는다.
- 실행 후 정상 end 관측 창을 놓쳤으면 `pilot -- settle --recovery --broadcast`로 최신 종료 봉에서 청산을 시도한다. 이 epoch는 예정 평가 조건에서 제외하고 제공자 보상을 0으로 둔다. 복구를 원래 기한에 성공한 운용으로 표시하지 않는다.
- 가격 급변으로 숏 부채가 담보와 펀드의 가용 현금을 넘거나 유동성이 부족하면 청산이 실패할 수 있다. 이 테스트 계약은 상용 대출시장의 자동 청산·보험·사회화 손실 체계를 제공하지 않는다. 미상환 부채를 없앤 것으로 간주하거나 환매를 허용하지 않는다. 이런 사례는 정상 인수 증거로 세지 않는다.
- 외부 가격이 누락·오류·미래·오래된 관측이면 새 체결/평가를 중단한다. 임의 가격 입력으로 대체하지 않는다.

TEE 설정은 위 경로의 선행 조건이 아니다. 운영자 복호화 권한과 offchain 평가에 대한 신뢰는 남아 있다.
