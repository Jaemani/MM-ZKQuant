// Read-only deployment check. No strategist positions or private journal access.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { FetchRequest, JsonRpcProvider, formatEther } from 'ethers';

const fileValues = existsSync('.env') ? Object.fromEntries(readFileSync('.env', 'utf8')
  .split(/\r?\n/).map(line => line.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean)
  .map(match => [match[1], match[2].trim().replace(/^['"]|['"]$/g, '')])) : {};
const values = { ...fileValues, ...process.env };
const endpoint = (values.MM_TEE_REUSE_ENDPOINT || values.PLATFORM_TEE_URL || '').replace(/\/$/, '');
assert.ok(endpoint, 'PLATFORM_TEE_URL is required');
const expectedOperator = values.PLATFORM_OPERATOR_ADDRESS || '0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7';
const expectedKey = values.PLATFORM_TEE_ENCRYPTION_PUBLIC_KEY || '03725e6c5dd02ad7cf9f4c00ef135d0d08a2c9697403e2c2f1817dfa9e518585ed';
const runtimeFiles = ['protocol/cohort/durable-submitter.mjs', 'deploy/tee/operator/execution.mjs', 'src/platform/execution-errors.js'];
const hashes = Object.fromEntries(runtimeFiles.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `HTTP ${response.status}: ${new URL(url).pathname}`);
  return response.json();
}

let identity, status;
// The CVM may be running before npm installation and the HTTP worker are ready.
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const challenge = randomBytes(32).toString('hex');
    const [attestation, live] = await Promise.all([
      get(`${endpoint}/attestation?challenge=${challenge}`), get(`${endpoint}/platform/status`),
    ]);
    assert.equal(attestation.challenge, challenge, 'TEE challenge mismatch');
    identity = attestation.identity; status = live;
    assert.equal(identity.chainId, 10143, 'Wrong TEE chain');
    assert.equal(identity.operator.toLowerCase(), expectedOperator.toLowerCase(), 'Operator changed');
    assert.equal(identity.encryptionPublicKey, expectedKey, 'TEE encryption identity changed');
    for (const path of runtimeFiles) assert.equal(identity.sourceHashes[path], hashes[path], `Runtime update missing: ${path}`);
    assert.equal(status.execution, 'STRATEGY_EXECUTION_AVAILABLE', 'Execution is not initialized');
    break;
  } catch (error) {
    if (attempt === 11) throw error;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
const config = await get(`${values.MMQ_API_URL || 'https://mm-zkquant.vercel.app/api'}/v1/config`);
assert.equal(config.chainId, 10143, 'Wrong platform chain');
assert.equal(config.teeEncryptionPublicKey, identity.encryptionPublicKey, 'Platform TEE key mismatch');
assert.equal(new URL(config.teeEndpoint).origin, new URL(endpoint).origin, 'Platform points to another TEE');
assert.equal(config.vaultAddress.toLowerCase(), status.investments.vaultAddress.toLowerCase(), 'Platform and TEE Vault mismatch');
if (values.OMNIBUS_VAULT_ADDRESS) assert.equal(config.vaultAddress.toLowerCase(), values.OMNIBUS_VAULT_ADDRESS.toLowerCase(), 'Vault changed');

const rpcEndpoint = values.MONAD_TESTNET_RPC_URL || 'https://testnet-rpc.monad.xyz';
const rpcUrl = rpcEndpoint.includes('://') ? rpcEndpoint : `https://${rpcEndpoint}`;
assert.ok(['http:', 'https:'].includes(new URL(rpcUrl).protocol), 'RPC URL must use HTTP or HTTPS');
const request = new FetchRequest(rpcUrl);
request.timeout = 15000;
const provider = new JsonRpcProvider(request, 10143, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
try {
  assert.equal(BigInt(await provider.send('eth_chainId', [])), 10143n, 'Wrong RPC chain');
  const balance = await provider.getBalance(identity.operator);
  console.log(JSON.stringify({ verified: true, gasFundingPolicy: 'OPERATOR_WALLET_BALANCE',
    operator: identity.operator, operatorBalanceMON: formatEther(balance), operatorFunded: balance > 0n,
    vaultAddress: config.vaultAddress, runtimeHashesMatch: true, teeIdentityPreserved: true }));
} finally { provider.destroy(); }
