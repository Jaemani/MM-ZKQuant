# Veilvest

An investment platform that processes private target positions in a TEE and executes them on Perpl. Investors can compare public strategy terms, manage strategy shares and settlements, and verify retrospective ZK proofs of the ledger.

**Current status: 2026-10-07 · Monad/Perpl testnet**

Live service: https://mm-zkquant.vercel.app

## Start here

- [Documentation guide](docs/README.md)
- [Current architecture and trust boundaries](docs/platform-architecture.md)
- [Account and funding UX](docs/account-login-ux.md), [Platform handoff](docs/e2e-platform-handoff.md)
- [Strategist API](docs/testnet-platform-api.md), [Daily mean-reversion bot](docs/mean-reversion-bot.md)
- [Current progress](docs/team-status.md), [Presentation](docs/presentation-2026-10-07.md)

## User flow

1. **Sign up and log in with a username and password:** Browse without a wallet, register a strategist profile and strategies, and issue API tokens. Recovery login for existing wallet accounts is also supported.
2. **Deposit external funds:** Sign the AUSD approval and deposit into the single Vault from your linked wallet. Once the confirmed receipt is verified, the deposit is recorded in the TEE's private platform cash ledger.
3. **Allocate to a strategy:** Use your login session to allocate platform cash to a strategy's pending funds. Shares are issued at the prevailing NAV when the next target is submitted.
4. **Submit and execute targets:** The client encrypts the target vector. The TEE checks authentication, policies, and actual Perpl state, then submits each strategy's delta to the execution account contract.
5. **Redeem and withdraw:** Redeem strategy shares for platform cash at the agreed settlement time. The TEE pays cash withdrawals to the fixed linked wallet, without requiring an additional transaction signature from the user.

Target vectors fully replace the previous targets. Omitted markets and markets set to zero are closed out; negative values represent short positions. Performance fees follow each strategy's configuration (up to 20%) and a per-investment high-water mark (HWM).

## Current implementation and guarantees

| Area | Current implementation | Boundary |
| --- | --- | --- |
| Accounts | Username/password sessions, optional wallet recovery, API tokens | Account authentication and ownership rely on the platform API/DB |
| TEE | Phala TDX, challenge-based quote verification, pinned deployment policy | The web app trusts the server's verification result; uses Phala's HTTPS DCAP service |
| Funds | Single Vault, private cash and strategy ledgers, scheduled settlement | Vault withdrawals require operator authority; the contract does not enforce proofs of investor claims |
| Perpl | Multiple strategies and markets sharing an account with compatible position directions; attribution of actual filled quantities | Separate strategy accounting does not isolate exchange liquidation risk |
| Ledger ZK | Regular hourly checkpoints, Groth16 proofs of financial transitions, root continuity | Retrospective auditing. Does not independently prove prices, fills, authentication, overall solvency, or transfer relationships between separate ledgers |
| Recovery | Encrypted journal with fsync, reconciliation of transactions using the same signature, proof reuse | Requires preservation of the existing identity and persistent state; committee Forced Exit is not implemented |

Vault deposits and withdrawals, as well as Perpl orders and positions, are visible on the public chain. Plaintext targets, per-investor allocations, and the attribution of execution accounts to strategies are stored in the TEE, but correlations in timing and amounts are not hidden. Not every order on the current platform has ZK pre-authorization.

## Development and validation

Use the Node version required by `engines` in [package.json](package.json). Configure your local `.env` using `.env.example` as a reference.

```sh
npm ci
npm run db:migrate
npm run dev
```

To run PostgreSQL locally with Docker, configure the database URL and start the container:

```sh
sed 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres@localhost:5432/mmq|' .env.example > .env
docker run --rm --name mmq-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=mmq postgres:17
```

Then apply migrations with `npm run db:migrate` and start the app with `npm run dev` as shown above.

The web app is available at http://localhost:5173 by default, and the platform API uses port 8789. Migrations require write access to the configured database.

```sh
npm test                        # Current platform regression tests
npm run test:contracts          # Vault and shared execution account on a local EVM
npm run test:ledger-zk          # Witnesses, real proofs, verifier contract, and retries
npm run build                   # Frontend build
npm run verify:tee:platform     # Read-only verification of a fresh quote from the current deployment
npm run verify:ledger-zk        # Read-only verification of public proofs and on-chain records
```

`npm run test:all` also includes earlier research and protocol reference models. Do not conflate historical full-suite test counts with the current `npm test` count. See [Team status](docs/team-status.md) for the latest validation records.

Passwords for username/password judging accounts are stored only in `.data/judge-accounts/access.md`, which is excluded from Git. `setup:judges -- --fund` and account E2E tests move real testnet funds, so follow the procedures in the [Account guide](docs/account-login-ux.md).

## Deployment and operations

The platform uses the Vercel project `mm-zkquant`, the Supabase project `monad`, and the existing Phala CVM. Database migration 008 includes account login. When changing the worker, preserve the existing keys, sealed ledger, and genesis; check the control-plane compose configuration and a fresh quote, update the pinned policy, and then deploy the web app/API. See the [Attestation operations procedure](docs/platform-tee-attestation.md) and [Gas recovery guide](docs/platform-gas-recovery.md).

Routine web app/worker updates do not require redeploying the Vault. Do not commit private keys, sessions, API tokens, witnesses, or private ledgers.

## Historical specifications and experiments

The [Original specification from 2026-09-23](docs/specs/README.md) describes the intended design, including Trade/Lease/Anchor/Ledger and the committee exit path. Assess the current platform's implementation guarantees using the documents above and the actual code.

- [10/04 cohort MVP](docs/2026-10-04-core-cohort-mvp.md): Two investors, a closing ledger, direct TEE submission, and payout verification
- [Perpl execution core](docs/core-mvp.md), [Protocol reference model](protocol/README.md)
- [Previous README](docs/archive/readme-before-perpl.md)

VM shutdowns, costs, transactions, and test counts in these records reflect the results at the time of each experiment. They do not describe the current platform's operational status.
