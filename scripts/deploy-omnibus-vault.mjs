import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, Wallet, getAddress, isAddress } from 'ethers';
import { PlatformDatabase } from '../src/platform/database.js';
import { databaseUrl } from '../src/platform/environment.js';

const values = { ...process.env };
try {
  for (const line of (await readFile(resolve('.env'), 'utf8')).split(/\r?\n/)) {
    const entry = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (entry && !values[entry[1]]) values[entry[1]] = entry[2].trim();
  }
} catch {}

const DEFAULT_RPC = 'https://testnet-rpc.monad.xyz';
const DEFAULT_AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';

export async function compilePlatformOmnibusVault() {
  const source = await readFile(resolve('contracts/platform/PlatformOmnibusVault.sol'), 'utf8');
  const sources = { 'contracts/platform/PlatformOmnibusVault.sol': { content: source } };
  for(const path of ['contracts/platform/PlatformExecutionAccount.sol','contracts/perpl/PerplMvpAccount.sol']) sources[path]={content:await readFile(resolve(path),'utf8')};
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { viaIR:true, evmVersion:'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
  const contract = output.contracts['contracts/platform/PlatformOmnibusVault.sol'].PlatformOmnibusVault;
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

export async function deployPlatformOmnibusVault({ broadcast = false, token = values.PLATFORM_CASH_TOKEN_ADDRESS || DEFAULT_AUSD, operator } = {}) {
  if (!isAddress(token)) throw Error('PLATFORM_CASH_TOKEN_ADDRESS must be an address');
  const rpcUrl = values.MONAD_TESTNET_RPC_URL || DEFAULT_RPC;
  const privateKey = values.MONAD_TESTNET_PRIVATE_KEY || values.OPERATOR_PRIVATE_KEY;
  if (!broadcast) return { contract: 'PlatformOmnibusVault', chainId: 10143, token: getAddress(token), operator: operator || null, status: 'DRY_RUN' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw Error('MONAD_TESTNET_PRIVATE_KEY must be a 0x-prefixed 32-byte EVM private key');
  const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  if ((await provider.getNetwork()).chainId !== 10143n) throw Error('Refusing to deploy outside Monad testnet');
  const deployer = new Wallet(privateKey, provider);
  const initialOperator = operator || values.PLATFORM_OPERATOR_ADDRESS || deployer.address;
  if (!isAddress(initialOperator)) throw Error('PLATFORM_OPERATOR_ADDRESS must be an address');
  const artifact = await compilePlatformOmnibusVault();
  const vault = await new ContractFactory(artifact.abi, artifact.bytecode, deployer).deploy(getAddress(token), getAddress(initialOperator));
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  const transactionHash = vault.deploymentTransaction().hash;
  await mkdir('.data/platform-live',{recursive:true,mode:0o700});
  await writeFile('.data/platform-live/deployment.json',JSON.stringify({vaultAddress,transactionHash,operator:initialOperator,token:getAddress(token)},null,2),{mode:0o600});
  const database = new PlatformDatabase({ databaseUrl: databaseUrl(values) });
  try {
    await database.transaction(async client => {
      await client.query("INSERT INTO platform_settings(key,value) VALUES('omnibus_vault_address',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()", [vaultAddress]);
      await client.query("INSERT INTO platform_settings(key,value) VALUES('cash_token_address',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()", [getAddress(token)]);
    });
  } finally { await database.close(); }
  return { contract: 'PlatformOmnibusVault', chainId: 10143, token: getAddress(token), operator: getAddress(initialOperator), vaultAddress, transactionHash, status: 'DEPLOYED' };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  deployPlatformOmnibusVault({ broadcast: process.argv.includes('--broadcast') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exit(1); });
}
