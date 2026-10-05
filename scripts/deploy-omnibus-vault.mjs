import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, Wallet, getAddress, isAddress } from 'ethers';

const values = { ...process.env };
try {
  for (const line of (await readFile(resolve('.env'), 'utf8')).split(/\r?\n/)) {
    const entry = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (entry && !values[entry[1]]) values[entry[1]] = entry[2].trim();
  }
} catch {}

const DEFAULT_RPC = 'https://testnet-rpc.monad.xyz';
const DEFAULT_AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';

export async function compilePlatformContract(name='PlatformOmnibusVault') {
  const source = await readFile(resolve('contracts/platform/PlatformOmnibusVault.sol'), 'utf8');
  const sources = { 'contracts/platform/PlatformOmnibusVault.sol': { content: source } };
  for(const path of ['contracts/platform/PlatformExecutionAccount.sol','contracts/platform/PlatformSharedExecutionAccount.sol','contracts/perpl/PerplMvpAccount.sol']) sources[path]={content:await readFile(resolve(path),'utf8')};
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { viaIR:true, evmVersion:'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
  const path=name==='PlatformOmnibusVault'?'contracts/platform/PlatformOmnibusVault.sol':'contracts/platform/PlatformSharedExecutionAccount.sol';
  const contract = output.contracts[path][name];
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}
export const compilePlatformOmnibusVault=()=>compilePlatformContract();
export const compilePlatformSharedAccount=()=>compilePlatformContract('PlatformSharedExecutionAccount');

export async function deployPlatformOmnibusVault({ broadcast = false, token = values.PLATFORM_CASH_TOKEN_ADDRESS || DEFAULT_AUSD, operator } = {}) {
  if (!isAddress(token)) throw Error('PLATFORM_CASH_TOKEN_ADDRESS must be an address');
  const rpcUrl = values.MONAD_TESTNET_RPC_URL || DEFAULT_RPC;
  const privateKey = values.MONAD_TESTNET_PRIVATE_KEY || values.OPERATOR_PRIVATE_KEY;
  if (!broadcast) return { contract: 'PlatformOmnibusVault', chainId: 10143, token: getAddress(token), operator: operator || null, status: 'DRY_RUN' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw Error('MONAD_TESTNET_PRIVATE_KEY must be a 0x-prefixed 32-byte EVM private key');
  const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
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
  // Stage a v2 vault without redirecting deposits or overwriting the active
  // deployment. Activation requires an empty retired vault and a pinned TEE.
  const deployment={vaultAddress,transactionHash,operator:getAddress(initialOperator),token:getAddress(token),executionAccountVersion:2};
  await writeFile('.data/platform-live/shared-deployment.json',JSON.stringify(deployment,null,2),{mode:0o600});
  return { contract: 'PlatformOmnibusVault', chainId: 10143, ...deployment, status: 'STAGED',activationCommand:'node scripts/shared-account-rollout.mjs activate' };
  }finally{provider.destroy();}
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  deployPlatformOmnibusVault({ broadcast: process.argv.includes('--broadcast') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exit(1); });
}
