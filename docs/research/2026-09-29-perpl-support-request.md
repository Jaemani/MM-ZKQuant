# Perpl 테스트 AUSD 지원 요청

상태: **접수 완료 — Awaiting organizer**. 2026-09-29 17:31 KST, 사용자 로그인 후 Metropolis 공식 지원 포럼에 제출했다. 분류는 Something is broken이며, 운영진이 확인하고 이 요청에 답변한다는 접수 안내를 확인했다. 토큰 지급이나 문제 해결은 아직 확인되지 않았다.

제출 경로: https://hackathon.monad.xyz/support

## 제목

Perpl testnet integration blocked: Agora AUSD faucet depleted

## 본문

Hi Metropolis / Perpl team,

We are building Confidential Alpha Protocol (MM-ZKQuant) for Metropolis. Our ZK authorization checks have passed on public Monad testnet, and our Perpl execution flow has passed on a local fork. We are now blocked on test collateral for public-testnet execution through two smart-contract accounts.

Agora's official deployment documentation lists this Monad testnet faucet:
https://docs.agora.finance/developer/contract-deployments

- Network: Monad testnet, chain ID 10143
- Faucet: 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C
- AUSD: 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
- Latest check: block 66609444, September 29, 2026, 05:44 UTC
- Faucet balance: 0.000001 AUSD; configured drip: 10,000 AUSD
- requestFunds(our wallet) reverts with InsufficientFunds() in read-only simulation

Could you help get the faucet refilled, arrange 200 test AUSD directly, or route us to the appropriate Agora/Perpl contact? We need 100 AUSD per contract account to validate deposit, proof-gated order execution, actual fills, position close and collateral recovery. We already have test MON for gas.

Recipient test wallet: 0xA761529aE65a0966125C47911DEDCC7F23951D57
Repository and reproducible evidence: https://github.com/Jaemani/MM-ZKQuant/blob/main/docs/research/2026-09-29-perpl-test-collateral.md

This request is for testnet collateral only. Thank you!
