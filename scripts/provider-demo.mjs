import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { encryptEnvelope, signObject, signingPublicKey } from '../src/server/crypto.js';
import { UNIVERSE } from '../src/shared/protocol.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = arg('--url', 'http://127.0.0.1:8790'), workspace = arg('--workspace', 'demo');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('This review SDK only sends keys/signals to localhost');
const keyFile = resolve(arg('--key', `.data/provider-${workspace}.json`));
const api = async (path, body, headers = {}) => {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Local-Client': 'mm-alpha-sdk', ...headers }, body: body ? JSON.stringify({ ...body, workspace }) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
};
mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
let identity;
if (existsSync(keyFile)) identity = JSON.parse(readFileSync(keyFile, 'utf8'));
else {
  const { privateKey } = generateKeyPairSync('ed25519');
  identity = { privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
  const { provider } = await api('/api/providers', { name: arg('--name', 'Local SDK Provider'), kind: 'QUANT', publicKey: signingPublicKey(identity.privateKey) });
  identity.providerId = provider.id; identity.workspace = workspace;
  writeFileSync(keyFile, JSON.stringify(identity, null, 2), { mode: 0o600, flag: 'wx' });
}
if (identity.workspace !== workspace) throw new Error('Use a separate signing identity per workspace');
if (args.includes('--fetch-receipt')) {
  if (!identity.receipt) throw new Error('Submit a signal first');
  const { receipt } = await api(`/api/receipts/${identity.receipt.epochId}/${identity.providerId}?workspace=${workspace}`, undefined, { Authorization: `Bearer ${identity.receipt.receiptToken}` });
  const receiptPath = resolve(arg('--out', '.data/receipt.json'));
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ receiptPath, finalized: Boolean(receipt.root) }, null, 2));
} else {
  let state = await api(`/api/state?workspace=${workspace}`);
  if (!state.activeEpochId) { await api('/api/epochs', {}); state = await api(`/api/state?workspace=${workspace}`); }
  const epoch = state.epochs.find(e => e.id === state.activeEpochId);
  const vectorBps = JSON.parse(arg('--vector', '[7000,-2000,1000,0]'));
  const payload = { version: 1, providerId: identity.providerId, epochId: epoch.id, policyHash: epoch.policyHash, universe: UNIVERSE, vectorBps, nonce: randomBytes(32).toString('hex') };
  const { receipt } = await api('/api/submissions', encryptEnvelope({ payload, signature: signObject(payload, identity.privateKey) }, createPublicKey({ key: state.serverPublicKey, format: 'jwk' })));
  identity.receipt = receipt;
  writeFileSync(keyFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ providerId: identity.providerId, epochId: epoch.id, acceptedAt: receipt.acceptedAt, leafHash: receipt.leafHash, next: 'Seal/evaluate in the dashboard, then run with --fetch-receipt.' }, null, 2));
}
