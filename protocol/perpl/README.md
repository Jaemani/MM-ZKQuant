# Perpl core MVP experiment

See [scope, results and reproduction](../../docs/core-mvp.md). These contracts only deploy on chain 31337.

`exchange-abi.json` contains function/event entries selected from the official PerplFoundation/dex-sdk Exchange ABI at commit `5b5be46a3349d719fbb59a08cf3955194bc8dfd8`:
https://raw.githubusercontent.com/PerplFoundation/dex-sdk/5b5be46a3349d719fbb59a08cf3955194bc8dfd8/crates/sdk/abi/dex/Exchange.json

Original full ABI SHA-256: `766fc81326bdf27f243ca582f65c3e2ff72bc639d88674876697a63ae1c47cb3`.
See [upstream license](PERPL-SDK-LICENSE). Solidity interface tuple layouts are taken from this ABI; the adapter is a separate research harness.

`target-prover.mjs` signs synthetic target contexts and produces local proofs. `hardware-prover.mjs` checks a fresh vendor-verified TDX quote and sends encrypted signed witnesses to the pinned probe. Neither module implements strategy execution, private notes, fund accounting, or a production relayer.
