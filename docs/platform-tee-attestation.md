# 플랫폼 TEE attestation 요청 게이트

현재 웹 코드에서는 전략가 목표 제출과 투자자 비공개 장부 요청 전에 로그인 세션으로 `GET /api/v1/tee-attestation`을 호출한다. 이 API가 실패하면 암호화 요청을 보내지 않는다. 성공 결과의 암호화 공개키만 실제 암호화에 사용하며, 같은 로그인 중에는 최대 60초 동안 재사용한다. 로그아웃하면 결과를 폐기한다.

서버는 매 검증마다 새 32바이트 challenge를 생성하고 기존 Phala CVM의 `/attestation`에서 TDX quote를 받는다. 원문 quote를 Phala의 DCAP 검증 API에 보내고, 검증된 서명 report를 quote 바이트와 대조한다. 이어서 challenge·identity·암호화 키의 `report_data` 결합, debug 비트, MRTD/RTMR 측정값, 이벤트 로그 재생, compose hash, 운용자·Vault·장부 genesis 및 주요 소스·회로 해시를 [고정 정책](../src/platform/tee-attestation-policy.js)과 비교한다. 하나라도 다르면 API는 `TEE_ATTESTATION_FAILED`를 반환한다.

```sh
npm run verify:tee:platform   # 공개 배포에 새 challenge로 읽기 전용 확인
npm test
npm run build
```

고정 정책은 2026-10-06 현재 배포의 quote를 Phala API에서 검증하고 저장소의 해당 소스 해시와 대조해 작성했다. compose hash의 최초 등록 근거는 관측된 quote이며, 별도 Phala control-plane 기록과의 독립 대조는 추가 운영 검수 대상이다. 이 구현은 Phala의 HTTPS DCAP 검증 서비스와 웹 서버의 정직성을 신뢰한다. 브라우저는 서버가 반환한 검증 결과를 확인하지만 Intel 인증서 체인을 독립적으로 검증하지 않는다.

TEE worker를 새 compose로 배포하면 측정값이 바뀔 수 있다. 새 quote와 control-plane compose hash를 검토하고 [고정 정책](../src/platform/tee-attestation-policy.js)을 명시적으로 갱신한 뒤 웹/API를 배포해야 한다. 불일치 동안 비공개 요청은 안전하게 차단된다. 이 게이트는 이미 완료된 거래를 소급 검증하지 않으며, 장부 ZK proof와 별개의 검증이다.

현재 worker는 변경하지 않는 배포 순서는 다음과 같다. 배포 전 `npm run verify:tee:platform`의 성공과 Phala control-plane의 compose hash를 대조한다. 승인 후 기존 Vercel 프로젝트에 웹/API를 배포하고, 로그인한 테스트 지갑으로 `/api/v1/tee-attestation`이 200을 반환하는지 확인한다. 이어서 전략 상태 조회와 투자자 포트폴리오 조회를 수행하되 새 거래는 보내지 않는다. 실패하면 비공개 요청을 차단한 상태에서 배포를 되돌린다.
