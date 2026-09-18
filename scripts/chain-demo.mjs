import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { isHexString, sha256, toUtf8Bytes } from 'ethers';
import { createLocalRegistry } from '../contracts/local-evm.mjs';
import { canonicalJson } from '../src/shared/protocol.js';

const contractPath = fileURLToPath(new URL('../contracts/EpochCommitmentRegistry.sol', import.meta.url));

export async function compileRegistry() {
  const source = await readFile(contractPath, 'utf8');
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'EpochCommitmentRegistry.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  })));
  const errors = (result.errors ?? []).filter((error) => error.severity === 'error');
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  const compiled = result.contracts['EpochCommitmentRegistry.sol'].EpochCommitmentRegistry;
  return {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
    compilerVersion: solc.version(),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
  };
}

export function normalizeManifest(value) {
  const epochId = value.epochId ?? value.id;
  const root = value.root ?? value.submissionRoot;
  const manifestHash = value.manifestHash;
  if (typeof epochId !== 'string' || !epochId.trim() || epochId.length > 256) {
    throw new Error('Manifest requires a nonempty epochId of at most 256 characters.');
  }
  for (const [name, digest] of Object.entries({ root, manifestHash })) {
    if (!isHexString(digest, 32) || /^0x0{64}$/i.test(digest)) {
      throw new Error(`Manifest ${name} must be a nonzero 0x-prefixed bytes32 value.`);
    }
  }
  if (value.manifest !== undefined) {
    if (!value.manifest || typeof value.manifest !== 'object' || Array.isArray(value.manifest)) {
      throw new Error('Full manifest must be a JSON object.');
    }
    const computedHash = '0x' + createHash('sha256').update(canonicalJson(value.manifest)).digest('hex');
    if (computedHash.toLowerCase() !== manifestHash.toLowerCase()
        || value.manifest.epochId !== epochId
        || value.manifest.submissionRoot?.toLowerCase() !== root.toLowerCase()) {
      throw new Error('Full manifest does not match its epochId, root, or manifestHash.');
    }
  }
  return { epochId, root, manifestHash, epochKey: sha256(toUtf8Bytes(`mmzkquant:epoch:v1:${epochId}`)) };
}

export async function runLocalChainDemo(input, { fixture = false } = {}) {
  const manifest = normalizeManifest(input);
  const artifact = await compileRegistry();
  const registry = await createLocalRegistry(artifact);
  await registry.deploy();
  const receipt = await registry.transact('anchor', [manifest.epochKey, manifest.root, manifest.manifestHash]);
  const [stored] = await registry.read('getCommitment', [manifest.epochKey]);
    const verified = stored.root.toLowerCase() === manifest.root.toLowerCase()
      && stored.manifestHash.toLowerCase() === manifest.manifestHash.toLowerCase();
    if (!verified) throw new Error('Stored commitment differs from the supplied manifest.');
    return {
      evidenceVersion: 'local-anchor-v1',
      environment: 'LOCAL_EVM',
      runtime: '@ethereumjs/vm',
      inputProvenance: fixture ? 'SYNTHETIC_FIXTURE' : 'SUPPLIED_MANIFEST',
      chainId: 31337,
      contractAddress: registry.address,
      publisher: registry.publisher,
      ...manifest,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      anchoredAt: Number(stored.anchoredAt),
      verified,
      compilerVersion: artifact.compilerVersion,
      sourceSha256: artifact.sourceSha256,
      limitations: [
        'In-memory EVM with simulated block times; this transaction was not submitted to Monad.',
        'Publication alone does not establish that submission preceded the evaluation window.',
        'No fund custody, execution, confidential computation, or performance verification.',
      ],
    };
}

async function main() {
  const args = process.argv.slice(2);
  let manifestPath;
  let outputPath;
  let compileOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--compile-only') compileOnly = true;
    else if ((arg === '--manifest' || arg === '--output') && args[index + 1]) {
      const value = args[++index];
      if (arg === '--manifest') manifestPath = value;
      else outputPath = value;
    } else {
      throw new Error('Usage: node scripts/chain-demo.mjs [--manifest file.json] [--output file.json] [--compile-only]');
    }
  }
  const input = manifestPath ? JSON.parse(await readFile(resolve(manifestPath), 'utf8')) : {
    epochId: 'synthetic-local-registry-demo',
    root: sha256(toUtf8Bytes('MM-ZKQuant local synthetic submission root')),
    manifestHash: sha256(toUtf8Bytes('MM-ZKQuant local synthetic manifest')),
  };
  const result = compileOnly ? await compileRegistry() : await runLocalChainDemo(input, { fixture: !manifestPath });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await writeFile(resolve(outputPath), json);
  process.stdout.write(json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
