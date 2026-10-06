// Snapshot of the existing Phala CVM's verified testnet quote, checked against
// the current repository source hashes. At runtime these pins are independent
// of /attestation. Confirm compose provenance in the Phala control plane before
// production enrollment; update pins deliberately after a worker deployment.
export const teeAttestationPolicy = Object.freeze({
  mode: 'COHORT_TESTNET_OPERATOR',
  chainId: 10143,
  operator: '0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7',
  encryptionPublicKey: '03725e6c5dd02ad7cf9f4c00ef135d0d08a2c9697403e2c2f1817dfa9e518585ed',
  vault: '0xdC4e5675cD4b4E10E1D2274Abc3Fd9100c0334b6',
  composeHash: 'e4d2fa0b36fd5bfe75155ab3fe1ce13d1d12b1c1f080717d0915eed5ead8f32a',
  measurements: {
    mrtd: 'f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077',
    rtmr0: '68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96',
    rtmr1: '07e6f51aa763abfe75c3ddfbf4f425fe3f0ceff66d807a75e049303dce9addf68e7218729bd419638af63a370f65878c',
    rtmr2: 'df67e467e60edc1737bcf8e682d48131bfb427f523226aa7f197a7608e9b3784783fa759ef5b28191fa12f9ddb36b858',
    rtmr3: '19f8ee51b55713a0b701bd7e46e38e7eaed018351e9bcd3dc90333a41935d6f04c97a1d4b6a5aeb6d2fbf207fa80a4da'
  },
  lockSha256: 'd6ba52d6f49d643544d3b3b13d09479e20ba1b1e7215a9ba8196b6e0f3335340',
  wasmSha256: 'e2d51e06c934f589038af03ad0e7ae465cebe0fdbed4ddc7776d90df3865709a',
  zkeySha256: '9b9b68bd4caba5067a1970afde23b67ffc7d3c056c64a4074aa19c72638f0b22',
  ledgerGenesis: {
    genesisRoot: '18055927181367554054422602309928801871588405143950604475701374666380086633284',
    verificationKeyHash: '2bb14f8061688eb5cdc49c866f74c75c9f68b131aa9d1089378c716f2bf7221d',
    registry: '0xDFd9188E5CC1A72a9f9D68ad65e698e51950D822'
  },
  sourceHashes: {
    'deploy/tee/operator/server.mjs': '392ae13f036d5d5dc1e38cb857c05127c7c20de4c743781dcab3451cf90c5383',
    'deploy/tee/operator/execution.mjs': '9883e8d5cd20d7741f8dfb2debb7c4b621c18a992dc51b234355fd74bfbd00b4',
    'deploy/tee/operator/investments.mjs': '9fb4ec3852e9639347e525181cdcc56f76a54f964b54b0dbc52875a5972c2664',
    'deploy/tee/operator/shared-accounts.mjs': '8bf36dc62fda6ea30520320c99dd49d8f9df97b66c37a09808bfbc7b83e0e407',
    'deploy/tee/operator/ledger-proofs.mjs': '93b817858dfd8eea7872323dcd742e7891dbe35a4616584165655a5dc40b8e3a',
    'deploy/tee/operator/ledger-prover.mjs': 'f857ab3adccc82c49b6c6d8990ef98e5bd59d142c2bafbcc40cdb9ae8c069b31',
    'protocol/platform/ledger-witness.mjs': '3e1f1f415e6738aa060fad5ad44c6ee8eac5cad937cfdc3864ddfabce8a4d050'
  }
});
