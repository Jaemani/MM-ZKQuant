# 독립 심사 평가의 기준과 관측 범위

사용자가 제공한 Metropolis 트랙/바운티 안내와 Onchain Finance & Trading 상세 안내를 기준으로 평가한다. 이는 주최 측의 실제 채점 결과가 아니라, 세 서브 에이전트의 독립적인 모의 심사다. 평가자는 서로의 결론을 공유하지 않고 동일한 원자료와 저장소를 검토했다.

기준 구현: `5178cf8527ef6aa3a62500e46e2842803628eb0e`. 평가 작업은 제품 코드·배포·계정 공개 설정을 변경하지 않는다.

## 사용자 제공 공식 기준

| 항목 | 배점 | 원문이 요구하는 핵심 |
|---|---:|---|
| Technical Execution | 20 | 실제 온체인 종단 간 작동, 정산·가격/매칭 로직. 정적 데이터 위 UI 모형은 부족 |
| Design & Craft | 20 | 신뢰할 수 있고 이해하기 쉬운 거래 경험, 명확한 가격과 위험 고지 |
| Originality & Track Insight | 15 | 빠른 정산으로 가능해진 새로운 자산·시장 구조/거래 경험, 기존 상품의 단순 복제 여부 |
| Founder & Market Readiness | 25 | 구체적인 첫 사용자·거래 상대·시장 부재 원인에 대한 이해 |
| Traction & Path Forward | 20 | 실제 사용 또는 테스트 거래·모의 거래량 등 검증 흔적과 구체적 후속 계획 |

주 트랙은 하나만 선택하고 sponsor bounty는 선택적으로 추가할 수 있다. 주 트랙 상금 총 $30,000은 3팀에 $10,000씩 분배된다고 상세 첨부에 기재되어 있다. 마감은 **2026-10-14 12:59 GMT+9**다.

필수 제출물:

- 로고/그래픽: JPG/JPEG/PNG/WEBP, 최대 3MB.
- Public GitHub Repository: `metropolis@hackathon.monad.xyz`에서 접근 가능.
- 기술 데모 영상: 최대 3분, YouTube/Loom/Vimeo. 슬라이드·코드 설명 대신 실제 작동 제품을 보여야 함.
- 피치 영상: 최대 2분. 팀·문제·개발 이유.
- Live Product Link: Monad mainnet/testnet 배포와 접근 방법·필요한 테스트 로그인 정보.
- 선택 광고 영상 최대 30초는 심사에 반영되지 않음.

첨부 출처는 대화의 `c2c14a03-79a3-477a-ae6a-87a9b393f30e/Pasted text.txt`(전체 트랙/바운티) 및 `16cf6959-e146-41b0-84fe-7bfa0d7c08a6/Pasted text.txt`(상세 기준)이다. 현재 웹페이지를 다시 조회해 규정 변경 여부나 추가 세부 규정까지 확인한 것은 아니다.

## 부모 에이전트의 공통 사실 확인

- `gh repo view Jaemani/MM-ZKQuant --json nameWithOwner,isPrivate,url,defaultBranchRef`: `isPrivate=false`, default branch `main`. **현재 저장소는 공개**다. 심사 계정으로 직접 접근한 것은 아니다.
- `http://127.0.0.1:8790/` HTTP 요청: connection refused. 현재 열려 있는 브라우저 주소만으로 실행 중인 제품을 확인할 수 없다. localhost는 외부 심사위원용 배포 주소도 아니다.
- 저장소의 README/docs/protocol/src에서 YouTube/Loom/Vimeo·Vercel/Netlify 링크와 인터뷰/의향서 관련 표현을 검색했으나 해당 검색에서 제출용 자료를 찾지 못했다. 이는 외부에 해당 자료가 존재하지 않는다는 증명이 아니다.
- 저장소 파일명 검색에서 제출용 로고·피치·영상 파일을 특정하지 못했다. 구조도 PNG의 존재를 제출용 로고 준비 완료로 처리하지 않는다.
- 새 Perpl RPC 기록, 과거 spot DEX fork, 과거 Phala TDX 기록의 범위를 구분한다. 별도로 성공한 구성요소를 하나의 완성된 TEE→Perpl 운용/출금 경로로 합산하지 않는다.

화면이 실행되지 않아 실제 인터랙션·시각 품질을 직접 점검하지 못했다. Design & Craft 점수는 저장소 자료와 증거 접근성에 대한 잠정 판단이며 완성된 UI의 시각 평가로 읽지 않는다. 고객 인터뷰/외부 배포/제출 영상처럼 확인하지 못한 자료는 '없음'이 아니라 '미확인'으로 표시한다.
