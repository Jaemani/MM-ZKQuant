# Metropolis protocol foundations — draft v0.1

새 명세의 독립 구현 경로다. 기존 `src/`, `circuits/book-transition.circom`, `contracts/integration/`의 현물 실험과 연결하지 않았다. 운영 키·자금·네트워크 호출이 없다.

## 실행

Node 22.23 이상과 Rust stable/Cargo가 필요하다. 저장소 루트에서:

```sh
npm ci
npm run typecheck:protocol
npm run test:protocol
npm run test:reference
npm run verify:protocol
```

첫 Cargo 실행은 Cargo.lock의 의존성을 내려받는다. Rust와 TypeScript는 각각 독립 schema/Keccak/Poseidon 구현으로 고정 JSON의 기대값을 비교한다. `generate-protocol-vectors.mjs`는 명세 버전 변경 시에만 명시적으로 실행하며, 검사 과정은 기대값을 재생성하지 않는다. 기대값은 최초 TypeScript 생성 후 독립 Rust 구현으로 대조했다. 제3자 인증 벡터는 아니다.

## 현재 범위

| 구성 | 구현 | 한계 |
|---|---|---|
| `ts/encoding.mts`, `reference/src/lib.rs` | scalar 범위·signed field·bytes32 마스킹·18 domain·§4의 명시된 해시 식·intent/note 조합 | EdDSA/HPKE/committee 암호화·membership·상태 전이 증명 없음 |
| `ts/model.mts`, `reference/src/model.rs` | IOC delta, 축소 여부, Custody 인출량, 비례 축소 반올림, 단위 변환을 포함한 레버리지 계산 | 전체 note reducer·NAV·시리즈 HWM·출금 정산 모델 아님 |
| `ts/model.mts` | 실제 결과 확인 전 진행 거절·fallback 축소 완료 판정 후보, PRIVATE_ONLY/ALLOW_PUBLIC 라우팅 결정 | 실제 Gate 증거 인증·RPC 전송 아님. 인증 index는 호출자가 이미 검증했다는 가정 |
| `vectors/draft-v0.1.json` | 정상·거절 302개 고정 벡터 | Circom·Solidity 미대조. M1 미완료 |
| `tests/protocol-v1/` | 부분체결 위험 과소계상·동일 seq 혼합·잔액 귀속 모호성 반례, 정수 경계/축소 속성 | 명세 반례이지 완성 회로 exploit proof가 아님 |

모든 외부 정수 입력은 bigint 또는 정규 십진 문자열을 쓴다. JS number/float·선행 0·`-0`·field modulus 이상의 hash는 거절한다. signed amount는 128비트 **크기**를 가지므로 Rust i128 대신 BigInt를 쓴다. bytes32는 field 나머지가 아니라 하위 253비트다. 가격/lot/담보 변환은 `quoteNumerator / quoteDenominator`로 명시하며 위험 notional은 올림한다. 이는 원문의 '보수적 반올림'을 구현한 참조 선택이며 회계 전체의 확정 rounding 정책을 대체하지 않는다.

해시의 빈칸에 대한 현재 타입 가정: totalShares는 amount, unitNav는 price, fundingIndex는 amount, market은 u64로 인코딩한다. Gate의 uint32 market 제한 및 각 값의 의미 범위·단위는 별도 확정해야 한다. direct hash API는 배열의 필드형과 순서만 검증한다. Product 권한, mask/count의 의미, solvency를 증명하지 않는다.

제품 명세의 온체인 자금 보호는 아직 이 디렉터리에 구현되지 않았다. [명세 검토](../docs/spec-review-2026-09-23.md)와 [작업 분배](../docs/team-status.md)가 다음 단계의 기준이다.

검사 기록은 [두 언어 conformance](../docs/evidence/protocol-v0.1-conformance.json)에 코드·벡터 SHA-256과 함께 남긴다. `npm run verify:protocol -- --write-evidence`로 갱신할 수 있다. 외부 기본 호환은 `npm run probe:perpl`로 공개 테스트넷에 **읽기 호출만** 보내 재현한다. [기록](../docs/evidence/perpl-readonly.json)의 block·코드 해시는 해당 시점 관측값이며, 현재도 동일 버전이거나 M0가 완료됐다는 보장은 아니다.
