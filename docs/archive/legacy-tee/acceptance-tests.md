# 인수 시험 — 실행 절차와 완료 증거

작성: 2026-09-17 · **모든 T01–T36의 현재 상태: NOT_RUN. 이 문서는 앞으로 실행할 시험 명세다.**

[요구사항](requirements.md)과 [작업 계획](three-week-execution-plan.md)을 함께 사용한다. 명시된 수치 기준은 계획 목표다. mock을 이용한 개발 시험은 허용하지만 실제 TEE·실제 ZK·실시간 관측의 인수 증거로 대체하지 못한다.

## 공통 시험 규칙

환경 코드는 L=로컬 fixture, H=실제 TEE, X=실제 외부 데이터 연결, Z=실제 ZK proof, W=실제 wall-clock 연속 실행이다. 각 시험은 지정 환경 전체에서 실행한다. H 없이 L만 통과한 시험은 H 부분이 미완료다.

모든 시험 결과는 `evidence/<build-id>/<test-id>/<attempt>/` 아래 다음을 남긴다. 경로는 구현 시 생성할 제안 규격이며 현재 파일이 존재한다는 뜻이 아니다.

```text
result.json
  test_id, requirement_ids, status(PASS/FAIL/BLOCKED), actual_environment
  git_commit_or_source_digest, dependency_lock_digest, package_id
  runner_image_measurement, sdk_and_verifier_versions
  started_at, finished_at, exact_command, random_seed
  fixture_hashes, assertion_results, resource_metrics, cost
  artifact_paths_and_hashes, limitations, reviewer
```

- 서명·attestation·proof·검증 로그·선택 snapshot·필요한 실패 로그를 연결한다. 비밀 witness는 공개 증거 bundle에 넣지 않는다. private 증거와 공개 redacted 증거를 분리한다.
- FAIL은 코드 문제, BLOCKED는 인프라·권한 등으로 시험하지 못한 상태다. timeout·skip·mock 실행을 PASS로 바꾸지 않는다.
- 전용 verifier process가 실제 출력물을 검사한다. 생산 코드의 동일 함수를 재호출한 값만 정답으로 삼지 않고 손계산 fixture와 독립 reference를 사용한다.
- benchmark는 지정 instance/버전·크기·반복 수를 기록한다. 목표를 변경하면 기존 결과를 소급 PASS로 바꾸지 않는다.
- 일부 위협의 거부를 보인다고 모든 공격에 안전하다는 의미는 아니다. 각 시험은 아래 열거한 경계만 확인한다.

## 등록·데이터 시험

### T01 — 패키지 commitment와 버전

- 요구사항: R01 · 환경: L,H
- 준비/실행: 기준 package를 두 번 인코딩하고 code, lockfile, runtime, parameter, model, data rule, schedule, execution policy를 각각 하나씩 변경한다. salt 고정 fixture와 새 salt도 분리 시험한다. 등록본과 다른 암호화 package를 전달한다.
- 기대: 고정 fixture encoding/hash 일치; 내용이나 salt 변경 시 commitment 변경; 기존 버전 덮어쓰기와 payload 불일치 거부. TEE receipt에는 실제 적재 package ID가 들어간다.
- 증거: canonical byte test vector, 각 mutation의 예상·실제 hash, 등록 응답, H receipt.

### T02 — 7개 결정 함수 수용과 재현성

- 요구사항: R02 · 환경: L,H
- 준비/실행: 기존 7종에 각각 진입·비진입·데이터 부족 입력을 제공한다. 같은 snapshot/state를 10회 실행하고 process restart 후 재실행한다. 기존 저장 결정 372건도 원본과 adapted interface 양쪽에서 비교한다.
- 기대: 의미상 decision/state가 일치한다. 서명 nonce·run ID·실제 처리 시각은 비교에서 분리한다. 차이가 있으면 이유를 기록하고 원본과 동등하다고 표시하지 않는다. 7종 모두 live 연결되었다는 의미는 아니다.
- 증거: 전략별 21개 기본 case 결과, replay diff, package/model/runtime 버전, migration report.

### T03 — 비밀 업로드와 전달

- 요구사항: R03 · 환경: L,H
- 준비/실행: code·credential·dataset에 고유 canary를 넣는다. 승인 image와 잘못된 image/key 각각으로 업로드를 시도한다. gateway·object store·process 로그·host packet capture를 검사한다. 재시작 후 정한 키 복구 경로를 실행한다.
- 기대: 올바른 attestation 이후에만 암호화 전송; host에 평문 비밀이 없음; ciphertext 변조 거부. 재시작 후 해독은 승인한 경로에서만 가능하다. 이 검사는 RAM/side-channel 전체 공격 분석이 아니다.
- 증거: redacted 전송 경로, canary scan 결과, 거부 로그, key lifecycle 절차. 실제 비밀을 로그에 남겨 시험하지 않는다.

### T04 — 데이터 시간·단위·schema

- 요구사항: R04 · 환경: L,H
- 준비/실행: cutoff 직전/정각/직후 입력, max-age 경계/1ms 초과, event time이 미래인 입력, wrong unit/source/schema, NaN/Infinity, 없는 필드를 각각 보낸다. cutoff 포함 여부는 policy fixture로 고정한다.
- 기대: 각 사례가 명시한 ACCEPT/REJECT/INPUT_BLOCKED로 귀결된다. 인증 없이 source 문자열만 맞춘 요청이 인증된 출처로 승격되지 않는다.
- 증거: case별 선택 snapshot, reason code, policy ID, raw hash.

### T05 — revision·순서·선택 편향

- 요구사항: R04 · 환경: L,H
- 준비/실행: seq 1,2,2,4,3과 같은 event의 revision 0,1을 여러 도착 순서로 전달한다. cutoff 이후 revision 2를 추가하고, 호출자가 유리한 이전 revision을 지정해 재실행을 요청한다.
- 기대: 중복은 한 번 반영, gap은 정책에 따라 block/buffer, cutoff 이후 입력은 다음 slot에만 사용. canonical 로그가 같으면 선택 결과가 같으며 임의 override를 거부한다. 공급자가 아예 보내지 않은 데이터의 존재까지 알아내는 시험은 아니다.
- 증거: ingress log와 선택 이유, canonical snapshot hash, gap 및 late 처리 결과.

### T06 — 실제 외부 API와 HTTPS 경계

- 요구사항: R05 · 환경: H,X
- 준비/실행: TEE에서 Binance 가격·settled funding 및 Alternative.me를 수집한다. host는 forwarding만 한다. 잘못된 인증서/hostname, plaintext 응답 주입, timeout, rate limit을 별도 test endpoint로 주입한다. 실제 공급자를 공격하지 않는다.
- 기대: 실제 응답의 request/raw hash·관측 시점이 기록되고 계산에 연결된다. TLS 인증 실패·plaintext 교체를 거부하고 장애는 INPUT_BLOCKED/재시도 한도로 귀결된다.
- 증거: 실제 공급자 request metadata·응답 hash·TEE receipt, TLS 종료 위치 설명, fault endpoint 결과. 접근 제한으로 실제 공급자를 호출 못 하면 해당 부분은 BLOCKED다.

### T07 — 실시간 커스텀 발행자

- 요구사항: R05 · 환경: L,H,W
- 준비/실행: 로컬 publisher가 실제 30분 동안 1 event/sec로 서명 이벤트 1,800개를 발행한다. valid/wrong key, 변조 payload, sequence replay, 재연결을 섞은 별도 phase도 실행한다. publisher 중단은 T20/T34에서 다룬다.
- 기대: 정상 이벤트는 순서 정책대로 수용, forged/replayed 이벤트 거부, ACK 이후 retry로 중복 반영하지 않음. 출처 등급은 publisher_asserted이고 TEE 생성 인증이 아니다.
- 증거: publisher manifest/key ID, 송신·수신 sequence 대조, 실제 경과 시간, 입력→결정 연결.

### T08 — 사용자 파일 입력

- 요구사항: R05 · 환경: L,H
- 준비/실행: 같은 dataset의 CSV/Parquet 지원 형식을 고정하고 정상 파일, schema 불일치, oversize, 잘린 파일, hash 불일치 파일을 올린다. 구현 형식은 최소 하나이며 다른 형식은 미지원으로 명시한다.
- 기대: 등록한 schema의 파일을 받고 잘못된 파일을 명시적으로 거부한다. 사용자 임의 값을 넣은 유효 파일은 수용할 수 있지만 사실 검증 완료로 표시하지 않는다.
- 증거: file hash, schema/version, ingest 결과, provenance 표시.

### T09 — 커스텀 변환 실행과 외부 score 구분

- 요구사항: R06 · 환경: L,H
- 준비/실행: 원입력 [10,20,30]에서 등록한 window=3 rolling mean 20을 생성한다. 생성 코드/parameter/input을 각각 바꾼다. 숫자 20을 외부 publisher가 직접 보내는 경우도 실행한다.
- 기대: 내부 계산은 해당 input/transform commitment에 연결; 변경을 검출; 외부 20은 내부 변환 인증이 아님. stateful 변환의 restart 후 출력 일치. 모델 지원을 주장하려면 별도 고정 CPU 모델 fixture를 추가한다.
- 증거: 손계산 정답, raw→feature→decision 연결, provenance 차이, restart 결과.

### T10 — point-in-time 근거와 수정본

- 요구사항: R07 · 환경: L,H
- 준비/실행: 내용은 같고 available_at만 사용자가 작성한 archive와 이전 forward 관측 근거를 가진 입력을 비교한다. 10:00 결정 뒤 11:00에 과거 값 revision을 발행한다. host clock도 뒤로 이동시킨다.
- 기대: arbitrary timestamp를 당시 가용성 증거로 인정하지 않는다. 11:00 수정본은 10:00 snapshot을 바꾸지 않음. clock 변경으로 이미 확정된 cutoff/sequence를 되돌리지 못함. scheduler/로그 authority 신뢰를 리포트에 표시한다.
- 증거: provenance/time evidence 분류, 전후 snapshot hash, clock fault 결과.

## 실행·회계 시험

### T11 — 미래 입력 차단

- 요구사항: R08 · 환경: L,H
- 준비/실행: 같은 과거 prefix에 상반된 미래 가격 suffix를 붙인 두 archive를 준비한다. cutoff 이전 결정 비교, strategy에서 미래 index·전체 archive 경로·외부 HTTP 접근을 시도한다.
- 기대: cutoff 이전 출력 동일; 허용 snapshot 외 데이터 접근 거부. fixture가 미리 아는 미래를 코드에 하드코딩한 행위의 자동 탐지는 범위 밖이다.
- 증거: prefix equality 결과, 접근 거부 로그, sandbox policy.

### T12 — 결정 실패와 자원 한도

- 요구사항: R08 · 환경: L,H
- 준비/실행: 예외, 무한 루프, 메모리 초과, malformed decision, 비결정적 wall-clock/난수 접근을 하는 시험 전략을 실행한다.
- 기대: 오류/timeout의 terminal record가 생기고 주문은 생성되지 않는다. 주입한 시간·seed 사용 규칙을 지키거나 해당 API를 거부한다. 오류 후 다음 정상 작업이 실행된다.
- 증거: 종료 코드, limit 설정, failure receipt, 후속 정상 작업 결과.

### T13 — 손계산 회계와 체결 시점

- 요구사항: R09 · 환경: L,H
- 준비/실행: cash=1000, spot 1개 매수, price=100, slippage=100bps, fee=100bps, 수량 precision=정수인 fixture를 사용한다. 매수가 101, fee 1.01, cash 897.99, mid mark=100일 때 NAV 997.99를 독립 정답으로 둔다. decision 이전 open과 이후 open이 다른 bar도 시험한다.
- 기대: 고정 소수점으로 정답 일치. 이후 적격 bar만 fill에 사용. 동일 가격 다음 bar에서 전량 매도 시 가격 99, fee 0.99, 최종 cash/NAV 996.00. 무거래·최소수량·cash 부족도 정책대로 처리한다.
- 증거: order/fill/cash/position/NAV ledger, 독립 계산표, eligible bar timestamp.

### T14 — 입력 장애 중 포지션과 NAV

- 요구사항: R09 · 환경: L,H
- 준비/실행: 자산 보유 뒤 signal feed만 중단하고 mark price를 하락시킨다. 다음에는 mark feed도 중단한다.
- 기대: signal 차단 중에도 기존 포지션 손실 반영; mark까지 없으면 NAV invalid/unavailable. 현금 전환·0 수익률로 채우지 않음. 결측 NAV 기간은 완전한 ZK 기록으로 승인하지 않는다.
- 증거: 각 단계 잔고·mark·NAV validity, record rejection.

### T15 — target·no-change·체결·지원 상품

- 요구사항: R10 · 환경: L,H
- 준비/실행: SET_TARGET(0), NO_CHANGE, DATA_BLOCKED, 가격 변동 후 같은 50% target, pending order, unsupported perp target을 전달한다. fill 전·후 다음 전략 입력을 확인한다.
- 기대: 각각 청산 intent/새 주문 없음/차단으로 구별; 동일 target도 필요하면 rebalance; 잔고는 fill 후 갱신. pending 주문 retry로 중복 주문이 생기지 않음. carry는 decision-only 가능, spot execution 전체는 명시적으로 거부.
- 증거: 단계별 decision/intent/fill/state chain과 거부 code.

## 인증·운영 이력 시험

### T16 — 실제 TEE attestation과 키 결합

- 요구사항: R11 · 환경: H
- 준비/실행: 실제 enclave에서 키 생성→challenge attestation→사용자 verifier 검사→결과 서명 확인을 수행한다. 재시작/rotation 후 새 session도 확인한다.
- 기대: 공급자 trust chain, 승인 measurement, key binding, freshness 통과. 서로 다른 세션의 key를 바꿔 끼우면 실패. 일반 container 응답은 수용하지 않음.
- 증거: 실제 attestation 원본, 공개 key, nonce binding, image digest/measurement, verifier 로그.

### T17 — attestation 거부 사례

- 요구사항: R11 · 환경: L,H
- 준비/실행: 잘못된 measurement, chain/signature 변조, old challenge, 허용 안 된 key, 공급자 SDK의 debug indicator를 갖는 개발 image를 제출한다. 키 rotation 뒤 과거 bundle 검증도 시험한다.
- 기대: 신규 실행 인증에서 모두 거부. 역사적 bundle은 문서화된 validity/policy로 판단하며 과거 키라는 이유만으로 무조건 신규 실행에 재사용하지 못함. verifier가 지원하지 못하는 보안 조건은 fail-closed.
- 증거: case별 정확한 실패 사유, allowlist 및 trust-root 버전.

### T18 — receipt 모든 결합 필드 변조

- 요구사항: R12 · 환경: L,H
- 준비/실행: 유효 receipt의 run/epoch/package/input/state/decision/fill/NAV/outcome를 각각 변조하고, 다른 run의 유효 서명 결과와 조합한다. 인증된 STRATEGY_ERROR도 제출한다.
- 기대: 변조·mix-and-match 거부; failure receipt는 인증 유효, 실행 실패로 분리. strategy가 선택한 임의 message에 대한 signing 요청 거부.
- 증거: mutation matrix, signature verifier 결과, 실행과 인증 상태 분리 화면/JSON.

### T19 — 승인 전략 실행 격리

- 요구사항: R13 · 환경: H
- 준비/실행: strategy에서 supervisor key 파일/메모리 접근 경로, 다른 job 파일, raw archive, 외부 socket, signing IPC 임의 호출을 시도한다. 시험은 통제된 fixture에서 실행한다.
- 기대: 접근 실패·감사 로그; strategy가 arbitrary receipt 서명을 획득하지 못함; 후속 정상 job 동작. 허용한 동작과 격리 한계를 문서화한다.
- 증거: UID/process/IPC/network policy, 공격 fixture 결과, canary leakage scan. 전면적 보안 감사 대체가 아니다.

### T20 — 예정 실행 누락과 HOLD 기록

- 요구사항: R14 · 환경: L,H,W
- 준비/실행: 5분 schedule에서 정상/NO_CHANGE/input outage/strategy error/timeout/server off/result withheld/late result를 각각 만든다. scheduler 재시작 뒤 사전 schedule에서 slot을 재구성한다.
- 기대: 각 slot에 canonical terminal outcome; late result로 과거 MISSED를 성공으로 덮지 않음. proof 미제출과 전략 미실행은 다르게 표시. 서버가 꺼진 동안 강제로 실행했다는 표시는 없음.
- 증거: 예상 slot 목록과 실제 상태 join 결과, 재시작 전후 이력, late attempt.

### T21 — crash와 중복 요청

- 요구사항: R15 · 환경: L,H
- 준비/실행: snapshot 저장 후, decision 후, paper fill 계산 후, canonical commit 후, 응답 전의 각 경계에서 process를 중단한다. 동일 idempotency key로 10회 재시도한다. proof job만 10회 재시도한다.
- 기대: 해당 slot의 canonical 잔고·fill 반영 한 번, orphan attempt는 구분, retry 결과 연결. proof retry는 거래 횟수를 바꾸지 않음.
- 증거: crash matrix, before/after ledger, unique-key 충돌 결과, reconcile 로그.

### T22 — rollback와 fork

- 요구사항: R15 · 환경: L,H
- 준비/실행: state S1에서 S2를 승인한 뒤 enclave storage를 S1로 복원한다. 같은 이전 head에서 다른 두 receipt를 동시에 제출한다.
- 기대: 외부 canonical head 기준으로 오래된 결과를 거부하고 fork 중 하나만 원자적으로 수용. 외부 store까지 rollback한 경우를 보호한다고 주장하지 않음.
- 증거: checkpoint version, compare-and-swap 결과, fork rejection, 남는 신뢰 가정.

### T23 — 중단과 버전 교체

- 요구사항: R16 · 환경: L,H
- 준비/실행: V1 run을 종료하고 V2를 다음 activation epoch로 등록한다. 과거 slot 삭제, V1 state를 V2에 무단 연결, 종료 후 늦은 V1 결과를 제출한다.
- 기대: 별도 run/version으로 유지, 무단 state 연결/과거 삭제 거부, 종료 사유 공개. 무중단 상태 migration은 지원하지 않는다고 응답.
- 증거: version history, schedule 경계, 거부 결과.

## 비공개 기록·ZK 시험

### T24 — NAV 기록 완전성과 canonical root

- 요구사항: R17 · 환경: L,H
- 준비/실행: 사전 지정 24시간/1시간 간격/25개 endpoint-inclusive NAV를 만든다. 한 관측 삭제, 순서 교체, favorable subwindow, 다른 account/package, missing mark를 각각 제출한다.
- 기대: 유효 기록만 인증; 결측·다른 기간은 완전한 expected root로 승인되지 않음. record commitment에 period/count/interval/identity/salt가 결합됨.
- 증거: record encoding vectors, TEE 인증 root, 거부 사례, canonical root 조회 근거.

### T25 — MDD 정수 계산과 실제 proof

- 요구사항: R18 · 환경: L,Z
- 준비/실행: 독립 reference와 zkVM guest를 비교하고, 아래 네 fixture는 각각 실제 ZK proof로 검증한다. (1) [100,120,90,110], limit=2500 → true; (2) 같은 series, 2499 → false; (3) [100,110,120], 0 → true; (4) [100,0], 9999 → false. 추가 reference/guest fixture로 zero NAV+10000 → true, flat series, n=2/256, 최대 NAV, limit 범위를 검사한다.
- 기대: 초기 peak 포함 MDD 25% 경계가 정확; risk false도 유효 proof로 발행. float 오차·rounding 완화 없음. 최소 크기와 최대 크기는 T29에서 자원 측정.
- 증거: 손계산 reference, guest 출력, 실제 proof bytes, program/proof mode, verifier 결과.

### T26 — 잘못된 witness와 산술 경계

- 요구사항: R18 · 환경: L,Z
- 준비/실행: NAV 일부·salt·length·timestamp를 바꾼 witness, 음수·초기0·10^18 초과, limit<0/>10000, n=1/257을 넣는다. 실제 proof의 result bit와 public input을 바꾼다.
- 기대: 유효 입력 범위 밖은 proof 생성 전/guest 검증에서 거부; root 불일치·거짓 public result는 verifier 거부. 범위 검사가 제거된 산술 wraparound 허용 없음.
- 증거: 경계 fixture, guest rejection, tampered-proof verifier 로그.

### T27 — proof와 인증된 기록의 연결

- 요구사항: R19 · 환경: H,Z
- 준비/실행: 정상 proof를 다른 period/account/root에 붙인다. 공격자가 만든 완전히 유효한 별도 record proof를 canonical proof로 제출한다. 인증되지 않은 원문으로 proof를 만들어 제출한다.
- 기대: cryptographic proof validity와 canonical input authenticity 모두 확인; statement/receipt mismatch 거부. 정상 risk false는 verifier 성공·조건 미충족으로 표시.
- 증거: expected/actual public inputs, receipt 검증 결과, 결합 verifier 결과.

### T28 — mock·다른 검증 프로그램 거부

- 요구사항: R19 · 환경: L,Z
- 준비/실행: mock/dev receipt, proof 모양의 JSON, 다른 program으로 만든 실제 proof, 지원하지 않는 proof version을 제출한다. 동일 statement의 올바른 실제 proof와 비교한다.
- 기대: 승인한 ZK program/mode/version만 수용. dev flag가 production verifier의 환경변수 하나로 몰래 활성화되지 않도록 별도 build/config로 분리한다.
- 증거: verifier configuration, program IDs, 각 거부 결과.

### T29 — confidential proving 경계와 비용

- 요구사항: R20 · 환경: Z 및 선택한 실제 비밀성 환경
- 준비/실행: n=2/64/256을 고정 hardware에서 각 3회 실제 prove/verify한다. 비밀 NAV canary의 전송·로그·저장 경로를 검사하고 선택한 prover 경계 밖 평문 노출을 확인한다.
- 기대: n=256에서 각 run ≤30분, 확정한 메모리·비용 budget 이내. confidential 완료라면 일반 host/외부 prover에 witness 노출 없음. private prover 대신 보통 cloud prover를 썼으면 해당 등급은 실패다.
- 증거: proof mode·prover 위치·hardware/SDK, 각 latency/peak RAM/비용, redacted trace. TEE 키 생성만으로 prover 기밀성을 충족했다고 세지 않는다.

## 사용자 경로·성능·통합 시험

### T30 — API·접근 제어·결과 표시

- 요구사항: R21 · 환경: L,H 및 Z 확장 시 Z
- 준비/실행: owner A/B를 만들고 등록→backtest→forward 시작/중단→receipt 조회를 한다. 다른 owner private artifact 접근·변경을 시도한다. synthetic/PAPER, failure receipt, risk false, unavailable proof를 표시한다.
- 기대: 권한 없는 읽기/쓰기 거부; 코드·secret·private NAV 비공개. 실행 성공, 데이터 등급, 인증 유효, risk 조건, proof 상태가 서로 혼동되지 않는다.
- 증거: API 응답, 접근 제어 matrix, 대표 화면 capture. UI가 없어 CLI로 축소하면 공식 scope 변경을 남긴다.

### T31 — 독립 verifier 전달

- 요구사항: R22 · 환경: L, 실제 H 증거 및 확장 시 Z 증거
- 준비/실행: 새 환경에 export bundle과 공개 verifier만 전달한다. 플랫폼 인증 성공 API 접근을 차단하고 검증한다. byte 하나를 바꾼 bundle도 실행한다.
- 기대: 정상 bundle 검증, 변조 거부, private strategy/witness/signing secret 불필요. 내보낸 canonical root의 registry 신뢰와 freshness 한계를 문서에서 확인 가능.
- 증거: 새 환경 설치·실행 명령, dependency versions, verifier stdout/exit code, bundle hash.

### T32 — 실제 bounded workload 성능

- 요구사항: R23 · 환경: H,X 및 확장 시 Z
- 준비/실행: manifest에 instance/CPU/RAM/예산을 고정한다. 2 assets×각10,000 bars backtest를 3회, 고정 snapshot decision을 warm-up 뒤 100회 측정한다. 실제 API latency와 TEE 내부 compute는 분리한다.
- 기대: backtest 각 ≤10분, decision 내부 p95≤10초, 고정 resource/cost 이내. n=256 proof 결과는 T29를 참조하며 다시 증명할 필요는 없음.
- 증거: workload/source/instance manifests, 원 측정값, percentile 계산, 성능 제한. ML·수백 자산에 대한 추정으로 확장하지 않음.

### T33 — 크기·rate·queue 제한

- 요구사항: R23 · 환경: L,H
- 준비/실행: event 64 KiB 경계와 1byte 초과, 지속1 event/sec, limit 초과 burst, 느린 소비자, queue full, job 과다 제출, 설정된 cloud budget 초과 시도를 시험한다.
- 기대: boundary 수용/초과 거부 또는 문서화된 backpressure; accepted event의 조용한 손실 없음; 메모리 무제한 성장·무제한 instance 생성 없음. 부하 해제 후 정상 처리 복구.
- 증거: queue depth/RAM/rate/error 시계열, resource creation 차단 결과, 복구 시간.

### T34 — 연결된 장애 시나리오

- 요구사항: R24 · 환경: H,X,W 및 확장 시 Z
- 준비/실행: 실제 pipeline에서 publisher 정지, host restart, 외부 API timeout, proof worker 정지를 순서대로 주입한다. 15분 안에 상태가 화면/CLI에 반영되는지와 복구 runbook을 확인한다.
- 기대: input·execution·proof 장애가 분리됨; canonical slot 누락 없음; proof 장애가 paper fill 중복을 만들지 않음. 자동 복구 불가능한 경우 원인과 필요한 조치가 남는다.
- 증거: 주입 시각/해제 시각, alert latency, ledger diff, 복구 절차. 상용 가용성 증거로 확대하지 않음.

### T35 — 세 경로 end-to-end

- 요구사항: R24 · 환경: H,X 및 확장 시 Z
- 준비/실행: (1) 실제 API→TEE feature/decision→paper ledger, (2) 파일→backtest, (3) realtime signed custom raw input→TEE transform→decision을 실행한다. 각 경로에서 receipt/export 검증, 적격 NAV 기간에서 실제 proof를 검증한다.
- 기대: 각 결과가 실제 사용한 package/input/state까지 이어짐. 경로별 데이터 보장 등급이 정확. 공개 입력을 쓰더라도 private artifact와 witness 보호가 유지됨.
- 증거: 세 경로의 전체 artifact chain, independent verification, 소요시간. 하루치 NAV proof를 위해 충분한 시간이 없으면 fixture proof와 forward proof를 구분한다.

### T36 — 실제 72시간 paper 운영

- 요구사항: R24 · 환경: H,X,W 및 확장 시 Z
- 준비/실행: 최종 release candidate로 72시간 실행한다. 실제 공개 feed 두 전략과 custom5분 전략을 포함한다. 주입 장애의 대상·기간·예상 실패 slot은 시작 전 선언한다. endpoint를 포함하는 24시간 window 3개의 hourly NAV로 ZK 확장 시험을 수행한다.
- 기대: custom864 slot 전부 canonical outcome; 중복 회계0·묵살된 누락0. 비주입 구간 custom 성공률≥99%이며 전체 성공률도 공개. 실제 공개 feed는 별도 성공/차단/실패율을 모두 공개하고 최소 각 경로의 성공 실행·정상 복구가 있어야 함. 완전한 세 NAV window와 실제 proof 필요; NAV 결측 window는 실패로 남기고 완전한 관측 기간을 추가 확보한다.
- 증거: 실제 UTC 시작·종료, schedule→outcome 대조표, 모든 실패 사유, provider별 수신 통계, 메모리/비용 추이, 세 period roots/proofs, 최종 verifier 보고서.
- 판정: 기간 단축·가속 replay·mock TEE는 불합격. 핵심 코드 변경·오류로 재시작하면 3주 납기에 실패할 수 있으며 이 사실을 숨기지 않는다.

## 출시 판정

CORE는 R01–R17/R21–R24에 연결된 시험 전부, CORE+ZK는 T01–T36 전부가 지정 환경에서 통과해야 한다. CORE의 T30–T36에서 ZK 관련 절만 제외할 수 있다. 한 시험의 여러 case 중 일부만 통과하면 전체 PASS로 보고하지 않는다.

권한·유료 공급자·TEE 할당량 때문에 BLOCKED인 항목도 완료가 아니다. 제한을 바꾸어 성공시킬 때는 요구사항 버전·제외한 보장·변경 이유를 먼저 기록하고 새 범위로 판정한다. 시험 보고서의 제목에 `CORE` 또는 `CORE+ZK`, `BACKTEST/PAPER`, 실제 version을 명시한다.
