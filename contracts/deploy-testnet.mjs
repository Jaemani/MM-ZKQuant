import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, ZeroHash, isAddress } from 'ethers';
import { compileRegistry, normalizeManifest } from '../scripts/chain-demo.mjs';

// This script never broadcasts without the explicit --broadcast flag.
export async function main(args = process.argv.slice(2)) {
  let manifestPath;
  let outputPath;
  let broadcast = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--broadcast') broadcast = true;
    else if ((arg === '--manifest' || arg === '--output') && args[index + 1]) {
      const value = args[++index];
      if (arg === '--manifest') manifestPath = value;
      else outputPath = value;
    } else throw new Error('Usage: node contracts/deploy-testnet.mjs --manifest file.json [--broadcast --output evidence.json]');
  }
  if (!manifestPath) throw new Error('A sealed epoch manifest file is required.');
  const manifest = normalizeManifest(JSON.parse(await readFile(resolve(manifestPath), 'utf8')));
  const artifact = await compileRegistry();
  const report = {
    environment: 'MONAD_TESTNET',
    expectedChainId: 10143,
    status: 'NOT_BROADCAST',
    ...manifest,
    compilerVersion: artifact.compilerVersion,
    sourceSha256: artifact.sourceSha256,
    limitations: 'Anchors commitments only; no custody, trading, TEE, or timing certification.',
  };
  if (!broadcast) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report;
  }
  if (!outputPath) throw new Error('Broadcast requires --output so the deployment address is preserved.');
  const output = resolve(outputPath);
  if (existsSync(output)) throw new Error('Evidence output already exists. Choose a new path; reuse REGISTRY_ADDRESS when resuming.');
  if (!process.env.MONAD_TESTNET_RPC_URL || !process.env.MONAD_TESTNET_PRIVATE_KEY) {
    throw new Error('MONAD_TESTNET_RPC_URL and MONAD_TESTNET_PRIVATE_KEY must be configured.');
  }
  // Reserve a writable evidence file before any transaction can be sent.
  await writeFile(output, JSON.stringify({ ...report, status: 'PREPARED' }, null, 2) + '\n', { flag: 'wx' });
  const rpc = new JsonRpcProvider(process.env.MONAD_TESTNET_RPC_URL);
  try {
    const network = await rpc.getNetwork();
    if (network.chainId !== 10143n) throw new Error('Refusing to broadcast: RPC chainId is not Monad testnet 10143.');
    const signer = new Wallet(process.env.MONAD_TESTNET_PRIVATE_KEY, rpc);
    let registry;
    if (process.env.REGISTRY_ADDRESS) {
      if (!isAddress(process.env.REGISTRY_ADDRESS)) throw new Error('REGISTRY_ADDRESS is invalid.');
      registry = new Contract(process.env.REGISTRY_ADDRESS, artifact.abi, signer);
    } else {
      registry = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(signer.address);
      // Save the transaction hash before waiting so an uncertain response can be reconciled.
      Object.assign(report, { status: 'DEPLOYMENT_PENDING', contractAddress: await registry.getAddress(), publisher: signer.address, deploymentTransactionHash: registry.deploymentTransaction().hash });
      await writeFile(output, JSON.stringify(report, null, 2) + '\n');
      await registry.waitForDeployment();
    }
    const publisher = await registry.publisher();
    if (publisher.toLowerCase() !== signer.address.toLowerCase()) throw new Error('Configured signer is not the registry publisher.');
    Object.assign(report, { status: 'DEPLOYED', contractAddress: await registry.getAddress(), publisher });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    let stored = await registry.getCommitment(manifest.epochKey);
    if (stored.root !== ZeroHash) {
      if (stored.root.toLowerCase() !== manifest.root.toLowerCase() || stored.manifestHash.toLowerCase() !== manifest.manifestHash.toLowerCase()) {
        throw new Error('This epoch already has a different immutable commitment.');
      }
      report.status = 'ALREADY_ANCHORED';
    } else {
      const transaction = await registry.anchor(manifest.epochKey, manifest.root, manifest.manifestHash);
      Object.assign(report, { status: 'ANCHOR_PENDING', transactionHash: transaction.hash });
      await writeFile(output, JSON.stringify(report, null, 2) + '\n');
      const receipt = await transaction.wait();
      Object.assign(report, { status: 'ANCHORED', blockNumber: receipt.blockNumber });
      stored = await registry.getCommitment(manifest.epochKey);
    }
    Object.assign(report, {
      verified: stored.root.toLowerCase() === manifest.root.toLowerCase() && stored.manifestHash.toLowerCase() === manifest.manifestHash.toLowerCase(),
      anchoredAt: Number(stored.anchoredAt),
      blockNumber: Number(stored.blockNumber),
    });
    if (!report.verified) throw new Error('Onchain readback differs from the supplied epoch manifest.');
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally {
    rpc.destroy();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
