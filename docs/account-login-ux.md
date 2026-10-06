# Veilvest account and funding UX

Sign in with a username and password. A new account can browse, create a strategist profile and draft strategy, and issue its strategy API token without a wallet. Existing wallet accounts retain their user identity and can set credentials after the optional wallet recovery sign-in.

## Money flow

1. **Add funds** connects a wallet, approves AUSD when needed, and deposits into the existing single Vault. The confirmed receipt binds one funding wallet to the account and credits a private TEE cash book.
2. **Allocate** moves platform cash to a strategy's pending capital. This requires the account session, with no wallet signature. Capital activates on the strategist's next target submission.
3. **Redeem** reserves strategy units, settles at the strategy's configured time, and returns the proceeds to platform cash. Returning pending allocation follows the same settlement rules.
4. **Withdraw cash** reserves available platform cash and asks the TEE operator to transfer it to the account's fixed linked wallet. The user does not sign an additional transaction. Requested withdrawals can be cancelled before execution starts.

Cash and strategy ownership stay in the sealed ledger. The public database stores account identity, strategy information and public metrics. Internal transfers have matching debit and credit records checked before checkpoint creation. The existing v1 ZK circuit proves the financial transitions of each book; its circuit does not add a separate cross-book transfer predicate. The original genesis, verifier and verification key are retained, with the regular checkpoint interval of one hour.

Financial account mutations use stable request IDs. The browser retains an uncertain request and retries the exact payload. Deposit receipts and withdrawal transactions are reconciled before balance changes are committed. Asset and execution-status reads use committed state without waiting for a venue trade to finish.

## Judge access and verification

Run `npm run setup:judges` to prepare the two username/password accounts. Credentials are written only to the ignored local `.data/judge-accounts/access.md`. `npm run setup:judges -- --fund` funds this fixture with real Monad testnet AUSD, using persisted transaction IDs to avoid repeated funding: strategist 400 AUSD (200 initially allocated), investor 200 AUSD. The fixture strategy uses 60-second settlement; ordinary strategies retain the one-day default.

`node scripts/verify-account-e2e.mjs` resumes the fixture's real allocation, target submission, redemption, external cash withdrawal and on-chain ledger checkpoint verification. If the original operator credential is unavailable locally, verification waits for the existing hourly checkpoint covering both judge cash deposits; later mutations follow the regular hourly schedule. `node scripts/verify-judge-ux.mjs` checks both account screens and mobile navigation with all wallet RPC calls forbidden; Playwright must be installed locally. These scripts never print account passwords or private keys.

## Deployment

Apply `npm run db:migrate`, update the existing Phala CVM with `node scripts/deploy-platform-worker.mjs`, and verify its control-plane compose, source hashes and fresh DCAP quote with `node scripts/enroll-platform-tee.mjs`. Then deploy the matching frontend pins with `node scripts/deploy-platform-web.mjs`. The Vercel helper supports the locally authenticated CLI credential when `VERCEL_TOKEN` is absent. No additional Vault deployment is needed.

All static website copy is English. User-authored strategy names and biographies are retained as entered.
