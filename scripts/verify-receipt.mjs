import { readFileSync } from 'node:fs';
import { verifyReceipt } from '../src/server/crypto.js';
const args = process.argv.slice(2);
const receiptPath = args[0], keyIndex = args.indexOf('--public-key');
if (!receiptPath || keyIndex < 0 || !args[keyIndex + 1]) {
  console.error('Usage: npm run verify:receipt -- receipt.json --public-key trusted-server-key.json');
  console.error('Save /api/verification-key independently. A key bundled in a receipt is not a trust anchor.');
  process.exit(2);
}
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const keyFile = readFileSync(args[keyIndex + 1], 'utf8').trim();
const trustedPublicKey = keyFile.startsWith('{') ? JSON.parse(keyFile).publicKey : keyFile;
const result = verifyReceipt(receipt, trustedPublicKey);
console.log(JSON.stringify({ ...result, finalized: Boolean(receipt.root), note: 'Local signature and inclusion verification. No TEE, chain finality, price truth or independent cutoff-time proof.' }, null, 2));
if (!result.valid) process.exitCode = 1;
