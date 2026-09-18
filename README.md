# MM-ZKQuant · Alpha Fund Pilot

TEE를 제외한 제품 흐름을 구현 중입니다. 새 **Pilot evidence** 경로는 서명 제출 → 사전 commitment → 공개 가격 관측 → 테스트 자산의 예치·지분 → 롱/숏 실제 EVM 체결 → 상환·평가 → 이익 한도 보상 → 환매를 연결합니다.

**로컬 구현 검증과 공개 테스트넷 최종 인수는 구분합니다.** 로컬 EVM에서는 실제 ERC-20 잔고·대차·AMM·지급이 이동하고, 가격 원자료는 Kraken에서 수집합니다. 외부 Monad 거래와 독립 운영자 3명의 참여가 확인돼야 최종 gate를 통과합니다. 최신 숫자·잔액·판정은 [자동 재현 보고서](docs/evidence/pilot-readiness.md)를 보세요.

- [실행·가스 준비·제공자 온보딩·중단 복구](docs/pilot/runbook.md)
- [개발명세·정책·API·담당 경계](docs/pilot/development-spec.md)
- [원본 범위와 이전 프로토타입의 문제](docs/mvp-readiness.md)

새 정책은 승인된 **운영자 단위**로 키를 묶고 동일 신호를 중복 제거하며, actor Shapley와 실제 실현 이익의 high-water mark를 함께 사용합니다. 같은 운영자의 복제와 상반 신호 반례를 검사합니다. 숨겨진 소유 관계는 등록 검토가 필요하며 운영자는 TEE 없이 입력을 볼 수 있습니다.

기존 Overview/Epochs/Providers의 PAPER v1은 과거 프로토타입 비교용으로 보존했습니다. 테스트 토큰은 실물 교환권이 없고, 직접 공급한 테스트 AMM 유동성은 production venue의 유동성 증거가 아닙니다.

현재 공개 테스트넷에서는 계약 배포·유동성 공급·예치까지 확인했으며, 실제 제공자의 운용은 아직 진행하지 않았습니다. 새 Pilot은 회차마다 포지션을 전부 청산합니다. 지속적인 포지션 재조정, 주문 분할·다중 거래소 연결, 별도의 상관관계 기반 비중 조정은 미구현이며, 참여자 등록만으로 원래 구상 전체가 완성되는 상태는 아닙니다. TEE 자리는 일반 운영 서버가 맡고, 새 제출 경로는 명령줄 도구 중심입니다.

## 실행

Node.js 22.13 이상이 필요합니다. Node 22의 `node:sqlite` 실험 기능 안내는 정상입니다.

```bash
rtk npm ci
rtk npm run dev
```

- 개발 화면: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:8790>
- 빌드 화면: `rtk npm run build` 후 `rtk npm start` → <http://127.0.0.1:8790>
- 검증: `rtk npm test`
- MVP 근거 재현: `rtk npm run prove:mvp`
- 제품 완료 gate: `rtk npm run prove:mvp -- --strict` — 제품 조건 미충족 시 종료 코드 `2`
- 새 계약의 로컬 운용: `rtk npm run pilot:local`
- 공개 가격 수집: `rtk npm run pilot:market`
- 이전 commitment-only 계약: `rtk npm run chain:demo`

서버는 `127.0.0.1`에만 바인딩합니다. 이 버전은 로컬 단일 운영자 검토용이며 인터넷에 공개하는 배포 구성이 아닙니다. 기본 포트 8790을 바꾸려면 `PORT`와 Vite proxy를 함께 변경합니다. `ALPHA_DATA_DIR`로 별도의 검토 장부를 사용할 수 있습니다.

## 기존 PAPER v1 검토 순서 (Pilot 인수와 별도)

1. **Overview → 데모 Epoch 실행**: 10개 합성 provider의 서명·암호화 제출, root 생성, netting, 분할 모의 주문, 평가가 한 번에 진행됩니다. 여러 번 실행하면 성과 곡선과 다음 weight의 변화를 확인할 수 있습니다. 매 4번째 자동 epoch에는 의도적인 미제출 fixture가 있습니다.
2. **Providers → 등록**: 브라우저에서 Ed25519 키를 생성합니다. 새 epoch를 열고 BTC/ETH/MON/SOL vector를 직접 제출합니다. 이미 열린 epoch의 roster에는 나중에 등록한 provider를 추가하지 않습니다.
3. **Epochs → 마감·실행 → 평가**: 자동 provider는 수동 epoch에 자동 제출하지 않습니다. 제출자가 3명 미만이면 합성 거래를 중단하고 기존 모의 노출을 유지합니다. 미제출 기록과 개인 shadow 청산 비용을 확인합니다.
4. **접수증 다운로드**: 마감 전에는 서버 접수증, 마감 후에는 Merkle 포함 증명을 받습니다. 공개 manifest도 별도로 내보낼 수 있습니다.
5. **Paper vault**: epoch가 종료된 상태에서 가상 입금·환매를 해 봅니다. 지분 가격은 입출금만으로 바뀌지 않습니다. 자금 이동은 synthetic exposure의 비례 증감 가정이며 실제 투자자 자금 장부가 아닙니다.
6. **Forward sandbox**: demo와 독립된 workspace입니다. 제출 60초·평가 60초의 실제 시간을 기다리고 기준가·종가를 입력합니다. 입력 가격은 `USER_ASSERTED`이고 독립 가격 feed가 아닙니다. 수동 검토용으로 시간을 짧게 둔 것이며 초단기 투자 성과를 입증하지 않습니다.

## 요구사항과 작업 배분

| 문서 | 용도 |
|---|---|
| [요구사항](docs/requirements.md) | 제품 범위, R01–R20, 보장과 보장하지 않는 것 |
| [개발명세](docs/development-spec.md) | 객체·상태·API·서명/hash 계약·평가 공식·회계 |
| [5명 작업 분배 및 실행 계획](docs/three-week-execution-plan.md) | A–E 역할, ticket별 선행 작업·산출물·완료 조건, 후속 단계 |
| [인수 시험](docs/acceptance-tests.md) | 정상·실패·변조·시간 경계·재시작·화면 검증 기준 |
| [검증 기록](docs/mvp-validation.md) | 이번 구현에서 실제 수행한 검증과 남은 범위 |
| [MVP 준비도 판정](docs/mvp-readiness.md) | 원본 제품 범위와 현재 증거 비교, 미충족 gate 및 재현 방법 |
| [도메인 용어](CONTEXT.md) | Alpha Provider, Shadow Book, Contribution, Credential |
| [계약 실행 안내](contracts/README.md) | 로컬 bytecode 배포·anchor, Monad 연결 전 단계 |

이전 TEE 전략 실행 문서는 [archive/legacy-tee](docs/archive/legacy-tee/)에 원문을 보존했습니다. 현재 요구사항 문서는 프로토타입 구현 계약이며 원본에서 합의한 alpha fund 범위보다 우선하지 않습니다. 기존 `research/`는 과거 연구 근거로 남아 있으며 현재 구현의 기능 목록은 아닙니다.

## 기존 PAPER v1 SDK와 독립 영수증 검증

브라우저 대신 로컬 모델의 출력 vector를 제출할 수 있습니다. 서버가 실행 중이고 열린 epoch가 없어야 첫 등록 후 새 epoch를 만들 수 있습니다.

```bash
rtk node scripts/provider-demo.mjs --workspace demo --name 'SDK Review' --vector '[7000,-2000,1000,0]'
```

키와 provider identity는 `.data/provider-demo.json`에 생성됩니다. 이 파일은 비공개로 보관합니다. 대시보드에서 해당 epoch를 마감한 뒤:

```bash
rtk node scripts/provider-demo.mjs --workspace demo --fetch-receipt --out .data/receipt.json
rtk curl -fsS http://127.0.0.1:8790/api/verification-key -o .data/trusted-server-key.json
rtk npm run verify:receipt -- .data/receipt.json --public-key .data/trusted-server-key.json
```

검증기는 receipt에 들어 있는 아무 키나 자동 신뢰하지 않습니다. 위 키는 알려진 로컬 서버에서 별도로 저장한 것으로, 외부 인증기관이나 TEE attestation으로 보증된 키가 아닙니다. signature·leaf/proof·manifest 검증이 통과해도 `independentlyTimestamped=false`입니다.

API 요청을 직접 만들 때 POST는 JSON과 `X-Local-Client: mm-alpha-sdk` 헤더를 사용합니다. 브라우저에서는 같은 origin만 허용합니다. 이 제한은 로컬 접근 통제이며 운영자 로그인·멀티테넌트 인증을 대체하지 않습니다.

## 코드 위치

```text
src/shared/protocol.js   공통 canonical JSON / universe
src/server/crypto.js     Ed25519, hybrid encryption, Merkle / receipt
src/server/store.js      SQLite 원자적 저장, 로컬 키 보존
src/server/service.js    roster, epoch, private/public DTO, 회계
src/server/http.js       localhost HTTP / 정적 화면
src/core/engine.js       순수 risk / execution / shadow / LOO 계산
src/web/                React dashboard
contracts/              immutable epoch commitment registry
scripts/                SDK, verifier, 로컬 EVM 실행
tests/                  protocol / engine / service / HTTP / contract
```

제출 및 개인 shadow 노출은 암호문으로 저장하고 키는 `.data/operator-keys.json`에 별도 보관합니다. **DB와 키를 모두 가진 운영자는 원문을 볼 수 있습니다.** 공개 결과는 개별 vector·nonce·개인 키를 포함하지 않지만 합성 포트폴리오와 공개 credential은 노출됩니다. 가중치 제한과 최소 인원은 완전한 익명성을 보장하지 않습니다.

기존 PAPER v1의 보상은 미지급 credit preview이고, contribution은 고정된 한 epoch leave-one-out 비교입니다. 새 Pilot v2의 actor Shapley·실현 이익 한도 토큰 지급과 구분합니다. 기여도 합계를 실제 펀드 PnL의 분배로 해석하지 않습니다. Sharpe는 계산하지 않으며 IC가 정의되지 않는 경우 `—`로 표시합니다.
