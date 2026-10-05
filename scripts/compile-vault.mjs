import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import solc from 'solc';

async function main() {
  const sourcePath = resolve('contracts/platform/RollingStrategyVault.sol');
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
    console.error('Compilation failed:');
    for (const err of errors) console.error(err.formattedMessage);
    process.exit(1);
  }

  const contract = output.contracts['RollingStrategyVault.sol']['RollingStrategyVault'];
  console.log('✅ RollingStrategyVault compiled successfully!');
  console.log(`Bytecode length: ${contract.evm.bytecode.object.length / 2} bytes`);
  console.log(`ABI methods: ${contract.abi.filter(item => item.type === 'function').length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
