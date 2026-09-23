# 독립 기술 심사 평가 · 2026-09-23

평가 대상은 commit `5178cf8527ef6aa3a62500e46e2842803628eb0e`의 저장소와 보관된 실행 증거다. 개발자의 이전 완료 설명을 점수 근거로 삼지 않고 코드·검사 기록을 직접 확인했다. 현재 주력 제출안인 **Perpl 기반 Confidential Trade Intent Execution**과 이전 현물 실험을 구분했다. 보관된 체인·TEE 기록을 이번 평가에서 다시 실시간 검증하지는 않았다.

평가 기준은 사용자가 제공한 Onchain Finance & Trading 상세 안내다. 공식 배점은 Technical Execution 20, Design & Craft 20, Originality & Track Insight 15, Founder & Market Readiness 25, Traction & Path Forward 20이다. 아래 점수는 심사 결과나 수상 확률이 아닌, **지금 확인 가능한 제출 증거에 대한 심사위원 역할의 자체 추정**이다.

## 판단

**기술 연구로는 실체가 있지만, 현재 새 프로토콜은 거래 제품의 end-to-end 심사 기준을 충족했다는 증거가 없다.** 기술이 어려워서 감점하는 것이 아니다. 투자자의 돈을 특정 운용자에게 맡긴 뒤, 허가된 거래만 실행하고 실제 체결을 그 투자자의 손익으로 돌려준다는 핵심 약속이 하나의 실행으로 이어지지 않았다.

가장 설득력 있는 기존 성과는 현물 포크에서 proof를 검증한 뒤 실제 venue 코드를 호출하고, 실제 수령액에 묶인 정산 proof로 두 장부를 갱신한 실험이다. 실제 TDX에서 암호화한 합성 witness를 처리해 proof를 만든 별도 실험도 있다. 두 실험을 연결해 **“TEE가 Perpl을 운용하고 검증된 투자자 출금까지 완료했다”**고 말하면 증거 범위를 넘는다.

| 공식 항목 | 현재 추정 | 가능한 범위 | 판단 근거 |
|---|---:|---:|---|
| Technical Execution /20 | 8 | 6–10 | 실제 현물 proof/계약/TEE 실험과 새 계산 코드는 확인된다. 새 Perpl 실행·정산·출금 경로는 없다. |
| Design & Craft /20 | 5 | 3–7 | 설계 검토 화면과 상태 조회 코드는 있다. 새 제품의 위험·체결·출금 상태를 사용자에게 일관되게 보여주는 증거가 없다. 실제 화면 사용성 테스트는 수행하지 않아 범위가 넓다. |
| Originality & Track Insight /15 | 10 | 8–12 | 비공개 목표 실행과 Product별 귀속을 분리하는 문제 선택은 의미 있다. TEE+ZK 조합 자체보다 어떤 복제·귀속 문제를 해결했는지와 Monad 속도가 왜 필수인지 실증이 필요하다. |
| Founder & Market Readiness /25 | 6 | 4–9 | 역할·단계·외부 제약을 구체적으로 이해한 문서는 있다. 특정 첫 운용자/투자자의 인터뷰, 약정, 도입 의사 등 검증 가능한 근거는 이번 자료에서 확인하지 못했다. |
| Traction & Path Forward /20 | 5 | 3–7 | 개발자가 실행한 거래·시험 증거와 작업 계획은 있다. 새 경로의 테스트 거래, 외부 사용, 거래량·유동성 파트너의 구체적 증거는 확인하지 못했다. |
| **합계 /100** | **34** | **24–45** | 현재 저장소의 증거만으로 평가한 범위다. 팀 내부의 미제공 실적은 부재로 단정하지 않는다. |

기술 배점은 20%다. 코드 검사를 더 많이 통과하는 것만으로 고객·사용성·시장 준비도를 포함한 나머지 80%를 대체할 수 없다. 공식 합격선은 제공되지 않았으므로 “몇 점이면 통과”라고 판단하지 않는다.

## 실제로 보여줄 수 있는 것과 한계

| 시연·증거 | 인정할 수 있는 주장 | 인정할 수 없는 주장 | 직접 확인 근거 |
|---|---|---|---|
| Rust/TypeScript 인코딩·계산 | 같은 필드·해시·계산을 두 구현에서 대조했다. 이번 평가에서도 새 JS 경로 311개가 통과했다. | circuit soundness, 현재 키의 권한, Product 손익 귀속, 실제 체결 성공 | `protocol/README.md:17`, `protocol/README.md:23`, `docs/evidence/protocol-v0.1-conformance.json:2` |
| 부분체결·귀속 반례 | draft가 잘못된 위험 판단이나 모호한 귀속을 허용할 수 있음을 구체적 숫자로 보여준다. | 해당 문제가 구현·회로에서 해결됐다. | `tests/protocol-v1/model.test.mjs:31`, `tests/protocol-v1/model.test.mjs:45` |
| Perpl 공개 RPC 조회 | 버전·코드·잔액 한도·기본 암호 연산을 조회했다. | 우리 계약이 Perpl 계정을 소유하고 실제 IOC 주문·출금을 수행했다. | `docs/research/2026-09-23-perpl-monad-m0.md:40`, `docs/research/2026-09-23-perpl-monad-m0.md:137` |
| 과거 현물 ZK 포크 | 로컬 fork에서 허가 proof→현물 거래→실제 수령액 결합 정산이 연결된다. 변조·재생·타 장부 이전을 거절한 기록이 있다. | Monad 공개 네트워크의 새 프로토콜 실행, 투자자 지분/출금 proof, Perpl 파생상품 회계 | `contracts/integration/ZkBookVault.sol:39`, `contracts/integration/ZkBookVault.sol:65`, `contracts/integration/ZkBookVault.sol:86`, `docs/evidence/zk-book-fork.json:2` |
| 과거 Monad testnet omnibus | 테스트 토큰과 직접 배포한 venue로 온체인 동작을 실행한 기록이다. | 독립된 외부 DEX/Perpl 통합 또는 TEE/ZK 운용 | `docs/evidence/omnibus-testnet.json:1137` |
| 과거 TDX 증명 생성 | Phala DCAP 경로에서 hardware quote를 검증하고 합성 witness의 proof를 만들었다는 보관 증거다. | 운영 measurement 등록 완료, 실제 전략→거래 연결, 새 TradeCircuit 300ms, 복구·key rollback 방어 | `docs/evidence/tee-hardware-probe.json:3`, `docs/evidence/tee-hardware-probe.json:82`, `docs/evidence/tee-hardware-probe.json:85` |
| 기존 화면 | 테스트 명령·장부 조회용 워크벤치다. 코드가 TEE 미연결을 표시한다. | 새 Perpl 프로토콜의 live product | `src/web/DomainWorkbench.jsx:79`, `src/web/DomainWorkbench.jsx:84`, `README.md:55` |

현물 계약은 생성자에서 chain ID 31337만 허용하고 투자자 출금이 없다고 명시한다(`contracts/integration/ZkBookVault.sol:10`, `:39`). 이는 기존 실험을 안전하게 제한한 장점이며, 동시에 해당 계약을 그대로 제출용 Monad 제품이라고 주장할 수 없는 직접 근거다.

## 자금 보호·회계·프라이버시의 증거 수준

1. **보호 규칙의 계산과 강제 집행을 구분해야 한다.** `withinLeverage`는 정수·시장 단위를 명시하고 보수적으로 계산한다(`protocol/ts/model.mts:35`). 그러나 이 함수를 호출했다는 사실을 새 Gate가 검증하는 회로는 아직 없다. `reconcileSlot`의 evidenceIndex는 호출자가 넣는 값이며, 함수 자체가 Gate 증거를 암호학적으로 검증하지 않는다(`protocol/ts/model.mts:48`).
2. **실제 체결 수량이 다음 위험 판단을 결정한다.** 100 중 10만 팔았는데 장부가 0으로 기록되면 실제 90의 위험이 사라진 것처럼 보인다. 이어서 다른 시장 20을 사면 장부상 20, 실제 110이다. 현재 반례 테스트 통과는 이 오류를 발견했다는 의미다. 해결 완료의 의미가 아니다(`tests/protocol-v1/model.test.mjs:31`).
3. **합계 보존만으로 투자자 자산이 보호되지 않는다.** A=20/B=30에서 free balance가 80이 되면 A=50/B=30과 A=20/B=60이 모두 합계는 맞는다. 어느 Product의 수익인지 인증해야 한다(`tests/protocol-v1/model.test.mjs:45`). 슬롯 공유를 유지하려면 외부 funding·청산·담보 반환의 귀속 입력을 실제 venue에서 확보해야 한다.
4. **서명과 회로를 만들기 전 schema 수정이 필요하다.** 현재 유효 키/약정의 인증, 동일 intentSeq의 commitment 고정, chain/Gate 도메인, withdrawalRef와 장부의 연결, 입출금 자본 전이가 불충분하다(`docs/spec-review-2026-09-23.md:13`, `:19`, `:27`, `:41`, `:54`). 이는 완성 계약의 exploit을 발견했다는 뜻이 아니라 앞으로 구현할 명세의 차단 항목이다.
5. **TEE 성공은 완전한 기밀성 성공이 아니다.** 측정값 허용목록·운영 등록·복구는 미완료다. private submission provider도 미확정이다. 일반 RPC에 거래를 보내면 포함 전 calldata를 해당 운영자가 볼 수 있다(`docs/research/2026-09-23-perpl-monad-m0.md:95`). 정상 실행 후 포지션은 공개되며, Product 연결을 얼마나 숨기는지 통계적 재식별 시험도 없다. “모든 민감 데이터 비공개”라는 포괄적 표현은 제출에서 제외해야 한다.
6. **출금 보장은 별도 증명 대상이다.** Perpl 증거금 해제는 요청/완료가 나뉘고 전역 출금 capacity에 영향을 받는다(`docs/research/2026-09-23-perpl-monad-m0.md:46`, `:80`). 비상 exit 설계도 5/9 위원회 가용성·거래소·유동성에 의존한다. timeout 표시만으로 투자자가 돈을 되찾는다는 주장을 할 수 없다.

## 내가 심사 현장에서 물을 다섯 질문

1. “지금 제가 새 목표 수량을 입력하면, 실제 TEE에서 만든 proof로 Perpl 포지션이 변하고 그 결과가 해당 투자자의 장부와 출금액에 반영되는 한 건을 보여주세요. 어느 단계가 여전히 운영자의 수동 입력인가요?”
2. “100을 청산하라는 IOC가 10만 체결될 때, 잔여 90이 다음 proof와 위험 제한에 반드시 포함된다는 것을 어떤 온체인 값으로 보장하나요?”
3. “같은 거래 계정의 서로 다른 두 시장에서 funding·청산이 일어나면, 총잔액이 맞는 것뿐 아니라 A의 손실을 B에게 넘기지 않았다는 것을 어떻게 증명하나요?”
4. “운용 키가 폐기되거나 TEE가 모두 꺼졌을 때 제가 어떻게 출금하나요? 위원회 5명이 응답하지 않거나 Perpl 출금 한도가 소진되면 어떤 상태와 대기 조건을 보여주나요?”
5. “RPC·validator·클라우드 운영자·일반 체인 관찰자 각각에게 무엇이 보이나요? 이미 공개된 체결로 운용자를 역추적할 수 있는데 실제 첫 고객은 어떤 비밀을 보호받기 위해 이 제품을 쓰나요?”

## 가장 작은 설득력 있는 다음 데모

목표는 현재 M0–M8 전체를 3분 영상에 담는 것이 아니다. **두 Product의 자금이 섞이지 않으면서 실제 TEE 승인 거래 한 번과 출금 한 번이 이어짐을 심사위원이 새 입력으로 재현**하게 만드는 것이다. 아래는 제안 범위이며 현 명세의 변경 승인이나 이미 완료된 기능을 의미하지 않는다.

1. Monad testnet, Perpl 한 시장, 소액 테스트 담보를 사용한다. 귀속이 해결되지 않았다면 Product별 전용 account를 쓰는 제한된 시험안을 명시적으로 문서화한다. 이는 slot 공유 프라이버시의 완성 증거가 아니다.
2. Product A/B에 각각 입금하고 장부·실제 담보 합계를 표시한다. A의 목표를 심사 중 새로 생성하고, 측정값에 결합된 TEE 채널로 전송한다. UI에는 암호화 제출, proof 생성, Gate 검사, Perpl 체결, 실제 잔량, 정산을 같은 실행 ID로 연결한다.
3. 유효 proof의 실제 Perpl 주문이 explorer 영수증과 venue의 조회값으로 확인돼야 한다. B의 지분/자산은 A 거래 때문에 바뀌지 않아야 한다. 부분체결 시 요청량·실제 체결량·미체결 잔량을 각각 표시하고, 잔량을 잘못 0으로 만들면 다음 거래가 거절돼야 한다. 공개 테스트넷에서 부분체결을 제어할 수 없다면 결정적 포크 재현을 보조 증거로 분리한다.
4. 같은 proof 재생, 변조된 목표, 한도 초과 주문을 실제 Gate가 거절하는 장면을 하나 이상 보여준다. UI에서 버튼을 막는 것만으로 대체하지 않는다.
5. A를 축소한 뒤 실제 담보 회수→청구→지갑 수령까지 보인다. 비동기 release/출금 한도에 걸리면 실제 pending 상태와 재시도를 보이고 중복 지급이 불가능해야 한다. 단순히 화면 숫자를 줄이는 것은 출금이 아니다.
6. private endpoint가 없다면 PRIVATE_ONLY 요청이 실패 안전하게 대기/만료함을 보여준다. 실제 거래 데모는 명시적 ALLOW_PUBLIC 약정을 선택하고 **그 데모에서 실행 전 주문 비밀까지 보장하지 않음**을 공개한다. private 경로가 없는 상태에서 ‘완전 비공개 실제 거래’로 시연하지 않는다.
7. 측정한 proof 시간과 제출→포함 시간을 그대로 표시한다. 새 회로 p50≤300ms·전체 p50<1초는 다수 표본과 측정 구간을 제시할 때만 달성으로 표기한다. 별도 TDX 합성 입력 4,917ms를 새 회로 수치로 사용하지 않는다.

이는 최초 end-to-end 데모의 acceptance다. Forced Exit·전체 LedgerCircuit·복구가 빠져 있으면 **제한된 테스트넷 실행 데모**로 제출해야 하며 v1 전체 프로토콜 완성으로 표현하면 안 된다. 투자자 보호를 중심 가치로 내세우는 만큼 다음 추가 데모는 TEE 강제 중단 후 출금 경로다.

## 제출물과 바운티 관점

- 공개 저장소: 이번 평가에서 `gh repo view --json nameWithOwner,isPrivate,url`로 `Jaemani/MM-ZKQuant`, `isPrivate=false`를 직접 확인했다. 이 항목은 확보됐다.
- Live Product Link: 새 Perpl 제품의 공개 배포 주소·판사 접근 절차는 이번 조사에서 확인하지 못했다. 로컬 워크벤치 주소는 외부 심사위원의 live link가 아니다.
- 기술 데모 영상: 최대 3분, 실제 작동 제품을 보여야 한다. 테스트 로그나 회로 코드 설명은 보조 자료이며 요구된 제품 영상의 대체물이 아니다. 제출 가능한 영상 URL은 확인하지 못했다.
- 피치 영상: 최대 2분, 팀·문제·왜 이 팀인지가 필요하다. 로고 파일은 허용 형식·3MB 이하 조건을 확인해야 한다. 이번 평가에서는 최종 제출 자산의 존재·규격까지 확인하지 않았다.
- Perpl API 바운티는 production-ready bot/automation을 요구한다. read-only probe나 현재 참조 모델만으로 충족하지 않는다. 테스트넷 E2E를 만들더라도 운영 복구·실패 처리·모니터링이 없는 상태에서 production-ready라고 부를 수 없다.
- Perpl risk-tool 바운티는 실시간 Perpl analytics/risk/portfolio 기능을 요구한다. 기존 설계 워크벤치만으로 충족하지 않는다. 바운티를 위해 무관한 대시보드를 추가하면 핵심 데모를 더 늦출 수 있다.
- Agora 모바일 trading 바운티는 모바일·Mera 인증·AUSD·Perpl 실행을 함께 요구한다. Perpl 사용만으로 지원 요건이 충족되는 것은 아니다.

## 평가 재현 기록

- 기준 commit: `5178cf8527ef6aa3a62500e46e2842803628eb0e`.
- 실행: `rtk npm run test:protocol` → exit 0, 311 tests / 311 pass / 0 fail. 302개 벡터가 이 수에 포함된다.
- 직접 읽음: 참조 모델/테스트, 현물 ZkBookVault, 현재 화면 라우팅, README/단계표/명세 반례/M0 조사, TDX·현물 fork·omnibus·conformance JSON.
- 기존 저장 증거를 새 실행으로 오인하지 않았다. proof 생성·온체인 거래·클라우드 기동·유료 작업은 하지 않았다. 제품 화면을 실제로 조작해 사용성을 평가하지 않았으므로 Design 점수는 구현 연결과 제출 증거에 대한 잠정 판단이다.
