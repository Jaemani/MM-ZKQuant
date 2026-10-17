# Phala account migration

This procedure moves the platform between Phala accounts while preserving the operator, Vault, private balances, strategy ownership, execution journals, and ledger proof history. Creating an empty CVM and changing the web endpoint is insufficient: a different dstack application derives a different key, and the existing Vault and execution accounts authorize the original operator.

## Transfer model

The temporary agent in `deploy/tee/operator/migration.mjs` runs only when explicitly configured through `MMQ_MIGRATION_CONFIG`. It is not part of the normal platform server. Its service needs the dstack socket, the existing `operator-state` volume, and temporary Docker socket access to quiesce the operator container. Remove the agent from the destination compose before opening normal platform traffic.

1. Save the source account's exact control-plane compose and a fresh quote. Record the existing operator, encryption public key, Vault, genesis, latest verified root and sequence. Preserve the original local client manifest and access token in ignored private storage.
2. Create an isolated destination CVM using the same application runtime. Start it without a Vault or ledger-proof deployment so it cannot initialize a competing book or execute against the existing Vault. Explicitly select a production OS; do not accept an automatically selected development image.
3. Verify both temporary agents using fresh challenges, Phala DCAP signature verification, report-data binding, event-log replay, the exact control-plane compose, production-mode checks, and the OS image hash in the signed event log. Pin the destination encryption key in the source agent's configuration. Agent and configuration hashes are included in its quoted identity.
4. Authenticate an encrypted `EXPORT` request with the existing operator configuration token. The source pauses the operator container before reading its state. Files are gzip-compressed and the operator secret and complete snapshot are encrypted directly to the verified destination TEE key. The migration client receives ciphertext and a snapshot hash, not the plaintext operator secret or financial records.
5. Forward that packet to the destination agent. It authenticates a separate transfer token, checks source/destination IDs, verifies that the transferred secret produces the expected source encryption key, validates the snapshot hash and paths, and restores the original files. It seals the transferred operator secret under the destination CVM's own dstack-derived key. It removes the empty standby container without deleting the persistent volume, preventing its old in-memory journal from running after import.
6. Read authenticated, encrypted `STATUS` from the destination agent and compare its imported hash and file count with the source result. Repeated import of the same completed snapshot is idempotent; a different snapshot is rejected.
7. Deploy the normal worker with an `identityMigration` manifest binding the original operator/public key and both application IDs. Include `identity.mjs` in the runtime source hashes. Remove the transfer agent from the compose. The worker refuses startup if imported identity state is absent, corrupted, belongs to another CVM, or derives a different operator.
8. Verify the restored Vault, genesis, latest checkpoint, proof history, runtime hashes and fresh quote before changing public traffic. The new OS may require explicit enrollment of an independently selected official production image hash.
9. Update Vercel's `PLATFORM_TEE_URL`, deploy the matching attestation pins, and verify the public configuration, attestation gate and encrypted channel. Keep the original encryption public key and Vault address. Account identity and strategy metadata remain in the same database.
10. Disable normal startup on the source CVM and stop it after cutover. Keep its persistent volume as a point-in-time backup. Remove temporary agent exposure and unused migration SSH keys.

## Identity preservation

`deploy/tee/operator/identity.mjs` loads the imported secret from `operator-identity.json`, sealed using the destination dstack key and the `operator-identity-migration-v1` context. It checks both application IDs, the original encryption public key, and the operator address derived with the existing `gas-relayer-v1` derivation.

The original secret continues to decrypt the existing financial stores and sign for existing execution accounts and checkpoint contracts. The destination's native dstack key protects the imported secret at rest. Future worker updates must retain the destination application identity, its persistent volume, and the manifest's migration provenance. `prepare-cohort-tee.mjs` carries that provenance forward when reusing the deployed identity.

Do not initialize a new ledger genesis, rotate the Vault operator, replace the verifier, or recreate investor balances as a shortcut. A changed TEE application ID does not require changing those financial identities when the complete original state and secret are transferred together.

## Deployment configuration

Set these values in the ignored local `.env`:

```dotenv
PHALA_API_TOKEN=YOUR_DESTINATION_ACCOUNT_API_KEY
PHALA_CVM_ID=YOUR_DESTINATION_CVM_ID
PLATFORM_TEE_URL=https://YOUR_DESTINATION_APP-8080.YOUR_GATEWAY
PLATFORM_TEE_ENCRYPTION_PUBLIC_KEY=THE_PRESERVED_PUBLIC_KEY
OMNIBUS_VAULT_ADDRESS=THE_EXISTING_VAULT
PLATFORM_CASH_TOKEN_ADDRESS=THE_EXISTING_AUSD_TOKEN
```

Worker updates and enrollment require `PHALA_CVM_ID`; they no longer silently target a hardcoded CVM in the previous account. Routine updates use the existing procedures:

```sh
node scripts/deploy-platform-worker.mjs
node scripts/enroll-platform-tee.mjs .data/platform-tee-DEPLOYMENT_TIMESTAMP
node scripts/deploy-platform-web.mjs
npm run verify:tee:platform
```

When intentionally changing the OS during migration, enrollment accepts an explicit image hash:

```sh
node scripts/enroll-platform-tee.mjs .data/MIGRATION/worker \
  --expected-os-image-hash=OFFICIAL_PRODUCTION_IMAGE_SHA256
```

This checks the selected production image against both the authenticated control plane and the replayed, signed OS-image event. The resulting policy pins the new boot measurements, compose, runtime sources, OS image, original financial identity and migration provenance. Ordinary enrollment continues to reject unexpected boot-measurement changes.

## Verification and recovery

Run `npm test` for account, execution, attestation and migration regressions. Migration tests cover loss of identity state, wrong destination sealing keys, operator/public-key mismatch, tampered snapshots, invalid paths, symlinks and conflicting repeated imports. `npm run build` checks the web bundle. Hosted quote and proof verification are read-only; do not use funded account E2E as an incidental deployment check.

Never operate the source and destination financial workers simultaneously. If transfer fails before destination activation, the authenticated source agent can resume the paused source operator after the destination is confirmed inactive. Once the destination has processed financial changes, the original snapshot is stale: reverting requires transferring the latest state and reconciling the transaction journal, not simply restarting the old CVM.

A Phala account migration does not replenish the on-chain operator's MON gas balance. Preserve and report pre-existing gas or reconciliation errors separately from migration success. API keys, configuration tokens, transfer ciphertext, imported identity files, private manifests and raw state belong in ignored private storage, never Git or public deployment logs.
