// Verified Phala control-plane compose, fresh DCAP quote and exact deployed runtime.
export const teeAttestationPolicy = Object.freeze({
  "mode": "COHORT_TESTNET_OPERATOR",
  "chainId": 10143,
  "operator": "0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7",
  "encryptionPublicKey": "03725e6c5dd02ad7cf9f4c00ef135d0d08a2c9697403e2c2f1817dfa9e518585ed",
  "vault": "0xdC4e5675cD4b4E10E1D2274Abc3Fd9100c0334b6",
  "composeHash": "a66655ec778d9a9abeff887b9bfb7b0d053897e8d9958f25d14d6761ac799a45",
  "measurements": {
    "mrtd": "7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173",
    "rtmr0": "68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96",
    "rtmr1": "4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec",
    "rtmr2": "764489f277a8540189761e72b4238ba36d4d647e11bd958d8ab5522af2a4867b0ff63e06b0c4967f1857236244040a5d",
    "rtmr3": "641596647003befc88923c19142c6a0406d7b49d4168e47ecd06750924f6d22fe5c0b6d82e6546fe7579336d056db35d"
  },
  "lockSha256": "d6ba52d6f49d643544d3b3b13d09479e20ba1b1e7215a9ba8196b6e0f3335340",
  "wasmSha256": "e2d51e06c934f589038af03ad0e7ae465cebe0fdbed4ddc7776d90df3865709a",
  "zkeySha256": "bb3703d5be6bcde1eed621cec3240cffc9bfe692ffde782e6b0582089326824b",
  "ledgerGenesis": {
    "genesisRoot": "18055927181367554054422602309928801871588405143950604475701374666380086633284",
    "verificationKeyHash": "2bb14f8061688eb5cdc49c866f74c75c9f68b131aa9d1089378c716f2bf7221d",
    "registry": "0xDFd9188E5CC1A72a9f9D68ad65e698e51950D822"
  },
  "sourceHashes": {
    "deploy/tee/operator/server.mjs": "41e8ac8ed3bb03aa1bac31c284e3e8d0b7318627e44b64885ba6469a3459f7bb",
    "deploy/tee/operator/identity.mjs": "646a0d3f6e977fb9e5d6d79ee26c3d432824125fb467c6e49c7e0516ba5ea144",
    "deploy/tee/operator/engine.mjs": "6c0e4a89ba23aa91394f40c71d919d3cad42e918bc77cace5a39bad08be5949d",
    "deploy/tee/operator/platform.mjs": "dd04354bebaebb9b784a808a331200447375fcf734076c003d1f50367776d2f9",
    "deploy/tee/operator/investments.mjs": "3f178402a3e9d61672b57525f2a25b6181182a07890a05dfc4cf481a791a0a11",
    "protocol/cohort/durable-submitter.mjs": "2bf8263081446f35541d494f04e70f5af09d80e9eedc3dbfe35471396125c227",
    "protocol/perpl/target-prover.mjs": "2d1613c49e5161f388c4ede79be07ecbf20e2b5fde2e25cbe8c619c750dd319a",
    "src/platform/investment-message.js": "fceded25b563ff4ba94133503576c5f87820cd22e36e72098f82c93d07ff743c",
    "src/integration/sealed.js": "2a6803f99d92b4f94d20d8560183a89c6af5e6846d862273597de4733676c4cb",
    "deploy/tee/operator/cash-ledger.mjs": "1755e5351dbf27709d9a947e2faa60159a13bafcdc1944f9196f63d7261b9694",
    "deploy/tee/operator/execution.mjs": "846a19aa5ee33e78fd307f48c79ee6fe3574665e4775c4bd08b28385d0ca1f85",
    "deploy/tee/operator/shared-accounts.mjs": "34c59e90d4a65357a646e486e18bbb8588771216daf109ae226cb0dc931d847a",
    "deploy/tee/operator/ledger.mjs": "e4c3f0e116b949b161cb257bed62918f2e908ac848b67c24235bd22f5bacf7d6",
    "src/platform/policy.js": "e134e3d0b40e54b147c6aca2ed68c07f4abb68d4d95039e92c3d0682d79431bb",
    "src/platform/execution-errors.js": "680c8866acd0131fe8a7245451b6e7c27cfb83b149f360c97ac2db865a4b8ba7",
    "src/platform/vault-retirement.js": "f439379bc4bfe644c1d365391a1d4770f81513998d28dca2086d74e5d487a6e3",
    "protocol/perpl/exchange-abi.json": "c72bbb967b240a4cc758e9f594bb682ea063283e240b4cdd6e34d7c179d55f26",
    "deploy/tee/operator/ledger-journal.mjs": "ff75a77f25efb329617a9239902bf805887561921a6da8a9ed06ec610df81287",
    "deploy/tee/operator/ledger-proofs.mjs": "161a2e65d0c486f04a30c39f46fdded9376bd01951bf0a9a1199d471b278f3cd",
    "deploy/tee/operator/ledger-prover.mjs": "f857ab3adccc82c49b6c6d8990ef98e5bd59d142c2bafbcc40cdb9ae8c069b31",
    "deploy/tee/operator/ledger-prove-worker.mjs": "5ddb3774cf447e5d5c811f99936f69f42eab20ba695be7ba3f62bf7cc9dc33ae",
    "protocol/platform/ledger-witness.mjs": "3e1f1f415e6738aa060fad5ad44c6ee8eac5cad937cfdc3864ddfabce8a4d050",
    "circuits/platform-ledger-transition.circom": "24c236e6e060ba2f3a837d2f328e3d62fcac21c1548386a45b9982ba19a2e94a",
    "circuits/platform-ledger-transition.template.circom": "6d4dbebdad6f1d4d61a660c1c3bd88872ea12953af7b3d9f8fab242fd3c50fe3",
    "artifacts/platform/shared-account.json": "232de167055b76cc922668737ff4f69b65f21519b6668bb4cebd44868e1e2a9d"
  },
  "osImageHash": "8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd",
  "identityMigration": {
    "sourceAppId": "633b691dbe00185be471da9f57b145aba58cbd77",
    "targetAppId": "779fc173e3c60e56f3b6463d3e49d06164244379",
    "operator": "0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7",
    "encryptionPublicKey": "03725e6c5dd02ad7cf9f4c00ef135d0d08a2c9697403e2c2f1817dfa9e518585ed"
  }
});
