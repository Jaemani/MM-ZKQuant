// Read-only preflight for the pinned testnet TEE enrollment.
import assert from 'node:assert/strict';
import { verifyPlatformTee } from '../src/platform/tee-attestation.js';

const base = (process.env.MMQ_API_URL || 'https://mm-zkquant.vercel.app/api').replace(/\/$/, '');
const response = await fetch(`${base}/v1/config`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
assert.equal(response.status, 200, 'Public platform configuration is unavailable');
const config = await response.json();
const result = await verifyPlatformTee({ endpoint: config.teeEndpoint, publicKey: config.teeEncryptionPublicKey, vault: config.vaultAddress });
console.log(JSON.stringify({ status: result.status, operator: result.operator, quoteHash: result.quoteHash, verifiedAt: result.verifiedAt }));
