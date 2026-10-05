import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, Wallet, isAddress } from 'ethers';
import { PlatformDatabase } from '../src/platform/database.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Load local .env if available
const envValues = { ...process.env };
try {
  const envContent = await readFile(resolve(root, '.env'), 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && !envValues[match[1]]) envValues[match[1]] = match[2].trim();
  }
} catch {}

const DEFAULT_RPC = 'https://testnet-rpc.monad.xyz';
const MONAD_TESTNET_CHAIN_ID = 10143n;
const DEFAULT_TEST_AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';

export async function compileRollingVault() {
  const sourcePath = resolve(root, 'contracts/platform/RollingStrategyVault.sol');
  const source = await readFile(sourcePath, 'utf8');

  const input = {
    language: 'Solidity',
    sources: {
      'RollingStrategyVault.sol': { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length > 0) {
    throw new Error('Compilation error: ' + errors.map(e => e.formattedMessage).join('\n'));
  }

  const contract = output.contracts['RollingStrategyVault.sol']['RollingStrategyVault'];
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`
  };
}

export async function deployRollingVault({
  broadcast = false,
  strategySlug,
  token = DEFAULT_TEST_AUSD,
  strategist,
  operator,
  feeRecipient,
  feeBps = 2000
} = {}) {
  const artifact = await compileRollingVault();

  const report = {
    contract: 'RollingStrategyVault',
    chainId: Number(MONAD_TESTNET_CHAIN_ID),
    token,
    strategist,
    operator,
    feeRecipient,
    feeBps,
    broadcast,
    status: broadcast ? 'PENDING' : 'DRY_RUN'
  };

  if (!broadcast) {
    console.log('DRY RUN: RollingStrategyVault deployment parameters:');
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const rpcUrl = envValues.MONAD_TESTNET_RPC_URL || DEFAULT_RPC;
  const privateKey = envValues.MONAD_TESTNET_PRIVATE_KEY || envValues.OPERATOR_PRIVATE_KEY;
  if (!privateKey) throw new Error('Missing MONAD_TESTNET_PRIVATE_KEY or OPERATOR_PRIVATE_KEY in environment');

  const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  const network = await provider.getNetwork();
  if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing deployment: chainId ${network.chainId} is not Monad testnet (${MONAD_TESTNET_CHAIN_ID})`);
  }

  const deployer = new Wallet(privateKey, provider);
  const strategistAddr = strategist || deployer.address;
  const operatorAddr = operator || deployer.address;
  const feeRecipientAddr = feeRecipient || deployer.address;

  console.log(`Deploying RollingStrategyVault from ${deployer.address}...`);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const vault = await factory.deploy(
    token,
    strategistAddr,
    operatorAddr,
    feeRecipientAddr,
    feeBps
  );

  const txHash = vault.deploymentTransaction().hash;
  console.log(`Deployment transaction sent: ${txHash}`);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`✅ RollingStrategyVault deployed at: ${vaultAddress}`);

  report.status = 'DEPLOYED';
  report.vaultAddress = vaultAddress;
  report.transactionHash = txHash;
  report.deployer = deployer.address;

  // If strategy slug is provided, associate in the database
  if (strategySlug && envValues.DATABASE_URL) {
    const database = new PlatformDatabase({ databaseUrl: envValues.DATABASE_URL });
    try {
      const res = await database.query(
        "UPDATE strategies SET vault_address = $1, status = 'FUNDING', updated_at = now() WHERE slug = $2 RETURNING id, slug, name, status, vault_address",
        [vaultAddress, strategySlug]
      );
      if (res.rows[0]) {
        console.log(`Associated strategy '${strategySlug}' with vault:`, res.rows[0]);
        report.associatedStrategy = res.rows[0];
      }
    } finally {
      await database.close();
    }
  }

  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const broadcast = args.includes('--broadcast');
  const slugArg = args.find(a => a.startsWith('--strategy='));
  const strategySlug = slugArg ? slugArg.split('=')[1] : null;

  deployRollingVault({ broadcast, strategySlug }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
