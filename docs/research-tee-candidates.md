# 실제 TEE 검증 후보 (2026-09-19)

공식 문서로 지원 구조를 확인했다. 계정별 가용 리전·재고·쿼터·가격 및 실제 배포 성공은 이번 조사에서 검증하지 않았다. 아래 우선순위와 이식 난이도는 MM-ZKQuant의 Node 런타임에 대한 판단이다.

## 추천

**빠른 1차 검증은 Phala Cloud / dstack**. 기존 Node 서비스를 이미지로 고정하고 Docker Compose로 배포할 수 있으며 JavaScript SDK에서 quote와 custom reportData를 다룬다. 이미지를 올렸다는 사실이 통과 기준은 아니다. 공개키와 challenge를 quote에 결합하고, 외부 검증기가 정확한 이미지·OS·KMS·키를 검사한 뒤 그 키로만 입력을 암호화해야 한다.

| 후보 | 적합한 이유 | 필요한 추가 작업 / 한계 |
|---|---|---|
| Phala Cloud / dstack | Compose 기반 CVM, JS SDK, attestation·키 관리·TLS 통합이 있어 현재 Node 코드의 첫 이식에 유리 | 이미지 digest 고정, OS·RTMR·KMS 신뢰 검증, ingress 실제 종단 확인, 장부 rollback 방지와 단일 실행자 보장은 애플리케이션이 설계해야 함 |
| AWS Nitro Enclaves | enclave 측정값과 KMS 정책을 묶는 명시적 격리 모델. AWS 운영 기반이 있다면 다음 후보 | enclave는 직접 외부 네트워크·영속 저장소·SSH가 없음. 부모 인스턴스와 vsock 프록시, 암호화 저장 및 복구 경로가 필요해서 기존 Node HTTP/파일 코드를 그대로 옮길 수 없음 |
| Google Cloud Confidential Space | 컨테이너 workload, 원격 attestation과 조건부 비밀 제공. 기존 GCP IAM/KMS 기반과 잘 맞음 | workload identity 및 attestation 정책 설정 필요. GCP 밖 Vault/클라이언트가 사용할 토큰 검증·키 결합을 별도로 구현해야 함 |

## 반드시 시험할 TEE 경계

1. **정확한 코드와 승인 키의 연결:** TEE 내부에서 승인 키를 생성·파생하고 nonce + 공개키 hash + 프로토콜 문맥을 attestation에 결합한다. 단순히 quote를 보여주고 임의 지갑 주소를 옆에 표시하면 증명이 아니다. Vault에서 승인할 키의 등록·교체도 동일 정책을 따라야 한다.
2. **입력의 실제 종단:** 전략 데이터가 일반 웹서버·리버스 프록시에서 평문이 되는지 확인한다. 검증된 TEE 키로 애플리케이션 암호화를 적용하면 중계 서버는 암호문만 취급하게 할 수 있다. HTTPS 자물쇠만으로 enclave 종단을 보장하지 않는다.
3. **저장과 복구:** 암호화된 파일을 어제 버전으로 되돌리거나 두 VM에 복제해도 과거 승인·환매를 다시 실행하지 못해야 한다. 상태 root/증가 sequence를 체인의 최신 값에 연결하고 계약에서도 nonce를 소비해야 한다. 암호화 자체는 최신성을 증명하지 않는다.
4. **버전과 키 수명:** 승인한 image digest 변경, 오래된 이미지 재기동, 폐기한 키, debug 모드, 잘못된 KMS, 만료된 attestation을 거절해야 한다. 관리자 계정으로 악성 코드 업데이트 후 기존 키를 다시 얻을 수 있다면 비밀성 약속이 깨진다.
5. **누출 경로:** 로그·오류·trace API·백업·RPC 요청·DEX calldata에서 무엇이 공개되는지 별도 확인한다. TEE는 공개 체결의 수량·시점·토큰을 숨기지 않는다.

## 공식 근거

- [Phala CVM 배포](https://docs.phala.com/phala-cloud/cvm/create-with-docker-compose): Docker Compose 배포.
- [Phala attestation SDK](https://docs.phala.com/phala-cloud/attestation/get-attestation): JS/Python/Go SDK, 64-byte reportData, nonce 및 공개키 hash 결합 예시.
- [Phala complete chain of trust](https://docs.phala.com/phala-cloud/attestation/chain-of-trust): image digest pinning, compose hash, RTMR event replay, OS·KMS·TLS·거버넌스 검증을 구분. 하드웨어 quote만으로 전체 보안 보장이 성립하지 않음을 명시.
- [dstack whitepaper](https://docs.phala.com/dstack/design-documents/whitepaper): 키 파생·암호화 백업. rollback 방지에 애플리케이션 개발자가 통합할 monotonic counter 등의 방식을 설명한다. 자동 rollback 방지가 완성되어 있다는 뜻으로 해석하면 안 된다.
- [AWS Nitro Enclaves overview](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html): 외부 네트워크·영속 저장소·SSH 없음, 부모 인스턴스와 local socket, KMS attestation 연계.
- [AWS cryptographic attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html): enclave 측정 PCR과 외부 접근 정책.
- [GCP Confidential Space overview](https://cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-overview): hardened OS + 컨테이너 workload + attestation service + 조건부 리소스 접근.
- [GCP workload 작성](https://cloud.google.com/confidential-computing/confidential-space/docs/create-customize-workloads): 외부 리소스를 위한 custom audience·토큰 검증, image digest 및 서명 기반 정책.
