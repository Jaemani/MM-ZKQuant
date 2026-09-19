# 실제 환경 PoC 후보와 통과 기준

조사일: 2026-09-19. 공식 문서 및 코드 검토 결과이며 배포·계약 코드 조회·현재 풀 유동성·실거래를 수행한 결과는 아니다.

## 권장 범위

실제 TEE 하나, 공동 Vault 하나, 전략 둘, 투자자 둘, 현물 거래쌍 하나로 시작한다. 투자·매수·매도·정산·환매 및 재시작 복구를 검증한다. 전략 수익성은 프로토콜 정확성의 통과 기준이 아니다. 숏은 실제 차입·청산·손실 격리 설계를 별도 검증하기 전 활성화하지 않는다.

TEE 후보 상세: [TEE 조사](research-tee-candidates.md).

## DEX 후보

| 후보 | 적합한 검증 | 선택 판단 |
| --- | --- | --- |
| Uniswap v3 on Monad mainnet | 기존 외부 계약에 대한 단일 풀 현물 교환 | 첫 어댑터 권장. 메인넷 고정 블록 fork로 먼저 검증하고 소액 실제 거래로 이어간다. fork는 실제 네트워크 체결 증거가 아니다. |
| PancakeSwap v3 on Monad mainnet | 같은 현물 경로의 대안 | 거래쌍별 실제 유동성·견적을 비교한 뒤 선택. 문서 등재로 유동성을 가정하지 않는다. |
| Kuru 직접 연동 / Kuru Flow | 주문장 또는 다중 거래소 경로 | Monad 네이티브 확장 후보. 직접 주문장은 부분 체결·취소·예치금 귀속이 추가된다. Flow는 외부 견적 API와 calldata 검증 경계가 추가된다. |
| Monad 테스트넷 공유 Uniswap v4 인프라 | 실자금 없이 퍼블릭 체인 계약 통합 검증 | 테스트 풀 조성 가능. 공식 레지스트리는 Uniswap 공식 배포가 아니라고 명시한다. 독립 시장 유동성·상용 체결 품질 검증으로 해석하지 않는다. |

근거:
- [Monad 공식 mainnet 프로토콜 레지스트리](https://github.com/monad-crypto/protocols/blob/main/protocols-mainnet.json): Uniswap, PancakeSwap, Kuru의 계약 주소 등재.
- [Monad 공식 testnet 프로토콜 레지스트리](https://github.com/monad-crypto/protocols/blob/main/protocols-testnet.json): Kuru 주소 및 비공식 Uniswap v4 공유 인프라 등재. 현재 동작 여부는 별도 확인 필요.
- [테스트넷 v4 풀 전체 실행 가이드](https://docs.monad.xyz/guides/uniswap-v4-hooks/pool-lifecycle): 테스트 토큰·유동성·swap·회수·승인 철회 절차.
- [Kuru Flow 통합 가이드](https://docs.monad.xyz/guides/kuru-flow): mainnet, JWT, 견적 API, transaction calldata, 6/18 decimals 차이.

## TEE·DEX 외 필수 검증

| 영역 | 실패를 만들어 확인할 내용 | 통과 기준 |
| --- | --- | --- |
| 승인과 자금 권한 | 승인된 주문의 수령자·토큰·금액·라우터 변조, 운영자 직접 출금 | 변조·우회 거절; chainId, Vault, nonce, deadline, minOut, 코드/키 정책에 승인 결속 |
| 전략 격리 | A만 거래·환매, B 잔액 부족, 동시 요청 | A의 비용·손실을 B에 전가하지 않음; 토큰 수량과 권리가 대사됨 |
| 외부 담보 격리 | 공동 주소의 부채/청산이 타 전략 담보를 소모 | 외부 프로토콜에서 격리를 강제하지 못하면 숏 활성화 금지. 내부 장부 분리만으로 격리 주장 불가 |
| 가격·지분 발행 | 오래된 가격, 조작된 풀 가격, 예치 준비 이후 가격 급변 | 공정한 발행 시점·가격 정책, stale/deviation 거절, 다른 투자자 권리 탈취 불가 |
| 토큰 단위·비용 | 6/8/18 decimals, 소액·반올림, 수수료 중복 반영 | 실제 잔액과 원시 정수 단위 일치; 가스 부담·잔여액 귀속 명시 |
| 체결 제약 | 가격 급변·minOut 미달·잘못된 recipient·allowance | 허용한 경로만 실행, 결과가 Vault에 귀속, 초과 소비 방지 |
| 거래/장부 원자성 | 전송 직후·확정 직후·장부 저장 직전 강제 종료 | RPC 재조회 후 정확히 한 번 반영; 미확정 상태에서 지분/권리 확정 금지 |
| TEE 저장·복구 | 옛 암호화 장부로 롤백, TEE 복제 두 개, 키 교체 | 오래된 상태·동시 서명 차단; 상태 버전·외부 기준점·키 폐기 정책 검증 |
| 비밀성 | 호스트 로그·APM·백업·TLS 종단·견적 API에서 원문 수집 | 민감 원문이 승인된 보호 경계 밖에 노출되지 않음; 공개 시각·수량의 추론 가능성 별도 기록 |
| 가용성과 환매 | TEE·RPC 중단, 실행자 실종, 가격 소스 중단 | 안전 중단과 재개 가능; 영구 키 손실 시 자금 회수 정책은 실자금 확대 전 필수 |
| 전략 입력 의미 | 같은 입력 재실행, 오래된 신호, 상반된 신호 | alpha→목표→주문 규칙의 버전·입력 시점·중복 정책 재현 가능 |

현재 코드 근거:
- `src/sleeves/runtime.js`: 일반 파일 저장, fixture 토큰/venue 배포, reserve 비율 평가, 단일 프로세스 큐, pending 복구, 공개 catalog의 전략별 units/equity. 외부 DEX/TEE 배포만으로 이 경계가 해결되지 않는다.
- `src/sleeves/ledger.js`: SCALE=10^6, 고정 자산 목록, 전략별 장부/보수/대사. 실제 토큰별 decimals 변환과 시장가격 검증이 필요하다.
- `contracts/sleeves/OmnibusVault.sol`: immutable operator/venue, onlyOperator 출금·실행. TEE 승인 우회 경로 제거를 위해 새 계약 설계·배포 필요.

## 검증 산출물

각 시나리오는 입력 해시, 코드 측정값과 키 결속 증거, TEE 승인, 온체인 거래 영수증, 전후 자산/전략 상태, 독립 대사 결과를 한 기록으로 묶는다. 민감 원문은 공개 검증 묶음에서 제외한다. 정상 흐름 하나뿐 아니라 변조·중복·재시작·롤백 실패 사례를 포함한다.

최종 관문은 운영자가 TEE 밖에서 임의의 주문/출금을 만들 수 없는지, 승인된 거래가 해당 전략에만 정확히 반영되는지, 중단 후 재개해도 자금과 권리가 보존되는지다.
