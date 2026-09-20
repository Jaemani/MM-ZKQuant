# 실제 TEE 하드웨어 실험 · 2026-09-20

**Phala의 실제 Intel TDX VM에서 암호화한 합성 장부를 받아 Groth16 증명을 생성하고, 로컬 검증기가 그 증명을 확인했습니다.** 기존 `SIMULATED` 모드 결과가 아닙니다. [공개 실행 증거](evidence/tee-hardware-probe.json)를 함께 봅니다.

## 확인한 흐름

1. 클라이언트가 새 난수 challenge를 보냅니다. TEE가 dstack에서 파생한 암호화 키의 공개키, 소스·lock·회로·proving artifact hash를 challenge와 묶어 quote를 발급합니다.
2. 클라이언트가 직접 Phala HTTPS DCAP 검증 서비스에 quote를 보내 서명/인증 결과를 확인합니다. 서비스가 반환한 signed report의 모든 필드를 원본 quote bytes와 대조합니다.
3. TDX debug 비트가 꺼졌는지, report data에 현재 challenge와 키가 포함됐는지 확인합니다. 부팅 event log를 재계산해 RTMR0–3과 대조하고, Phala 배포 화면에서 가져온 compose hash를 RTMR3 event와 signed mrconfig에 대조합니다.
4. 합성 입력을 ECDH/AES-GCM으로 암호화해 전송하고 응답도 암호화해 받습니다. 동일 입력 패킷 재전송은 409, 인증 태그 변조는 400으로 거부됐습니다.
5. 두 Book의 합성 witness와 hash로 고정한 wasm/zkey를 암호화해 보냅니다. TEE 내부에서 proof를 생성하고 반환한 proof·public signals를 로컬에서 검증했습니다.

## 환경과 결과

| 항목 | 기록 |
|---|---|
| VM | tdx.small, 1 vCPU, RAM 2GB, disk 20GB, prod9, dstack 0.5.9 |
| 앱 | mm-zk-hardware-probe |
| App ID | acd847b04dc75f074452a5f36bc15ba57e66d210 |
| CVM ID | d8b07f21-990e-4753-aa5b-1a3c5a27de61 |
| 배포 revision | rev_yq4zED3G0BBRJ |
| Phala control-plane compose hash | d9f9e3713a7c4bc06d41066beebfa98921a0b9f6d311d31582d3a72a5bfff6a5 |
| 증명 생성 | 4,917ms, 단일 합성 authorization proof |
| 프로세스 최대 RSS | 340,544KiB. 전체 VM 또는 요청 순간 메모리 측정은 아님 |
| 외부 체인 거래 | 없음. 실자금·운용 키 사용 안 함 |
| 검증 신뢰 | Phala hosted DCAP 서비스. 독립 DCAP verifier/운영 measurement 승인 아직 없음 |

이 실험은 **ZK+DEX 포크 실험과 별도**입니다. TEE가 생성한 이 proof로 DEX 거래를 실행한 것은 아닙니다. 메모리/시간 수치는 한 번의 생성 측정이며 처리량·최악 지연·장기 안정성 보장이 아닙니다.

## 팀원이 저장된 증명을 다시 확인하기

```bash
rtk npm ci
rtk npm run verify:zk
rtk proxy node scripts/verify-tee-proof-evidence.mjs
```

저장된 공개 검증키로 실제 proof를 다시 검사합니다. 새 cloud 배포나 proving setup 생성 없이 실행할 수 있습니다. 이 명령이 과거 하드웨어 서명·당시 RPC 상태까지 새로 검증하는 것은 아닙니다.

## 재현 코드

```bash
rtk npm ci
rtk npm run build:zk
rtk proxy node scripts/prepare-tee-probe.mjs
# 생성한 .data/tee-probe/compose.yaml을 Phala에 배포한 뒤:
rtk proxy node scripts/verify-tee-probe.mjs "$PROBE_ENDPOINT" "$EXPECTED_COMPOSE_HASH"
```

`EXPECTED_COMPOSE_HASH`는 배포 화면에서 독립적으로 확인한 control-plane hash입니다. 로컬 Compose 파일 SHA-256과 Phala app-compose hash는 서로 다른 값입니다. 서버 응답에서 기대값을 복사해 신뢰하지 않습니다. 배포 전에 비용 상한과 종료 절차를 확인하고, 배포 후 prepare를 다시 실행하지 않습니다(접근 토큰·manifest가 바뀜).

| 파일 | 역할 |
|---|---|
| deploy/tee/probe/server.mjs | 짧은 실험용 암호화 수신·attestation·TEE 내부 proving |
| scripts/prepare-tee-probe.mjs | digest 고정 Node 이미지, 소스, npm integrity lock을 담은 임시 compose 생성 |
| scripts/verify-tee-probe.mjs | fresh quote·측정값 대조·암호화 입출력·proof 독립 확인 |
| src/integration/tdx-quote.js | TDX v4 signed report 파싱·응답 대조, runtime event digest 재계산 |

공개 이미지 저장소에 저장소 소스를 올리지 않았습니다. bootstrap이 tmpfs에 소스와 의존성을 설치하는 실험 방식입니다. 완성된 재현 가능한 운영 이미지·측정값 승인 절차와 구분합니다. witness와 proving artifact는 `/work` tmpfs에서 처리하며 기존 사용자 장부를 업로드하지 않았습니다. 접근 토큰·원본 quote 응답 등 운영 파일은 `.data/tee-probe`에만 보관합니다.

실제 응답에서 발견한 두 호환성 문제를 수정했습니다. Phala `checksum`은 raw quote의 SHA-256이 아니므로 hash 동일성을 가정하지 않고 signed body를 직접 대조하며, 로컬 quote hash를 별도로 계산합니다. dstack runtime event에 `digest`가 비어 있어도 event type·이름·payload로 재계산해 RTMR3을 검증합니다. 참조: [공식 event digest 구현](https://github.com/Phala-Network/dstack/blob/master/cc-eventlog/src/lib.rs), [공식 attestation 절차](https://github.com/Phala-Network/dstack/blob/master/attestation.md). 이 클라이언트는 v4 TDX만 허용하며 다른 quote 형식은 명시적으로 추가 검증해야 합니다.

## 비용과 종료

사용자 승인 상한은 $2입니다. 후불을 끄고 **Prepaid / Auto-topup off**를 확인한 뒤 배포했습니다. 화면의 합계 요금은 $0.06074/시간(컴퓨팅 $0.058, 디스크 약 $0.003)입니다. 08:56:10 KST 배포를 시작해 09:08:17 종료를 요청했고, 24.3초 후 완료됐습니다. UI의 `CVM is powered off`를 확인했습니다. 09:13경 과금 화면은 **이번 달 $0.01 사용, 잔여 크레딧 $19.99, Prepaid / Auto-topup off**였습니다. 표시 금액은 반올림·지연될 수 있으며 최종 청구액은 아닙니다.

VM 전원 종료는 완료했고 영구 삭제는 사용자 확인 대기 중입니다. 앱의 25분 timeout은 과금 차단 장치가 아닙니다. 종료 후에도 디스크 비용이 남을 수 있어 삭제 확인이 필요합니다.

## 다음 인수 조건

- 알려진 OS/firmware·이미지·compose·KMS 정책을 독립적으로 승인하고 기대 측정값을 고정합니다. 이번에 관찰한 값을 그대로 운영 허용 목록으로 채택하지 않습니다.
- 목표 intent 인증, 영속 Book 장부, TEE proving, 실제 Vault 실행 기록, TEE settlement를 하나의 흐름으로 연결합니다.
- 재시작·복제·rollback 방지·키 소실·최종 환매를 검증합니다.
- 로컬 단독 Groth16 setup을 운영 ceremony로 교체하고 회로·계약 보안 검토를 완료합니다.
