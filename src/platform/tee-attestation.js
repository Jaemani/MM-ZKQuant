import { createHash, randomBytes } from 'node:crypto';
import { verifiedTdxBody, replayTdxEvents } from '../integration/tdx-quote.js';
import { teeAttestationPolicy } from './tee-attestation-policy.js';

const hex = value => String(value ?? '').replace(/^0x/, '').toLowerCase();
const must = (condition, reason) => { if (!condition) throw Error(`TEE_ATTESTATION_${reason}`); };
const sha = value => createHash('sha256').update(value).digest('hex');

export async function verifyPlatformTee({ endpoint, publicKey, vault, policy = teeAttestationPolicy, fetchImpl = fetch, onProgress = () => {} }) {
  must(typeof endpoint === 'string' && new URL(endpoint).protocol === 'https:', 'ENDPOINT');
  must(hex(publicKey) === hex(policy.encryptionPublicKey), 'CONFIG_KEY');
  must(hex(vault) === hex(policy.vault), 'CONFIG_VAULT');
  onProgress('CONFIG_VERIFIED');

  const challenge = randomBytes(32).toString('hex');
  const attestationUrl = `${endpoint.replace(/\/$/, '')}/attestation?challenge=${challenge}`;
  onProgress('FETCHING_TEE_QUOTE');
  const response = await fetchImpl(attestationUrl, { signal: AbortSignal.timeout(12000), redirect: 'error', cache: 'no-store' });
  must(response.ok, 'ENDPOINT_RESPONSE');
  const attestation = await response.json();
  const identity = attestation?.identity;
  must(attestation?.challenge === challenge && identity?.mode === policy.mode, 'IDENTITY');
  must(identity.chainId === policy.chainId && hex(identity.operator) === hex(policy.operator), 'OPERATOR');
  must(hex(identity.encryptionPublicKey) === hex(publicKey) && hex(identity.omnibusVault) === hex(vault), 'KEY_OR_VAULT');
  must(hex(identity.lockSha256) === hex(policy.lockSha256) && hex(identity.wasmSha256) === hex(policy.wasmSha256) && hex(identity.zkeySha256) === hex(policy.zkeySha256), 'ARTIFACTS');
  for (const [path, expected] of Object.entries(policy.sourceHashes)) must(hex(identity.sourceHashes?.[path]) === hex(expected), 'SOURCE_HASH');
  for (const [field, expected] of Object.entries(policy.ledgerGenesis)) must(hex(identity.ledgerGenesis?.[field]) === hex(expected), 'LEDGER_GENESIS');
  onProgress('IDENTITY_AND_SOURCE_HASHES_VERIFIED');

  const binding = sha(JSON.stringify({ domain: 'MM_COHORT_OPERATOR_V1', identity, challenge }));
  must(hex(attestation.binding) === binding, 'BINDING');
  const raw = hex(attestation.quote?.quote);
  must(/^[0-9a-f]{1272,65536}$/.test(raw) && raw.length % 2 === 0, 'QUOTE_FORMAT');
  onProgress('VERIFYING_QUOTE_WITH_PHALA');
  const vendorResponse = await fetchImpl('https://cloud-api.phala.com/api/v1/attestations/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hex: raw }),
    signal: AbortSignal.timeout(12000), redirect: 'error', cache: 'no-store'
  });
  must(vendorResponse.ok, 'VENDOR_RESPONSE');
  const { body, quoteHash } = verifiedTdxBody(raw, await vendorResponse.json());
  onProgress('QUOTE_VERIFIED');
  must(hex(body.reportdata) === binding.padEnd(128, '0'), 'REPORT_DATA');
  must(/^[0-9a-f]{16}$/.test(hex(body.tdattributes)) && !(parseInt(hex(body.tdattributes).slice(0, 2), 16) & 1), 'DEBUG_MODE');
  for (const [field, expected] of Object.entries(policy.measurements)) must(hex(body[field]) === hex(expected), 'MEASUREMENT');
  onProgress('REPORT_BINDING_AND_MEASUREMENTS_VERIFIED');

  const events = typeof attestation.quote.event_log === 'string' ? JSON.parse(attestation.quote.event_log) : attestation.quote.event_log;
  replayTdxEvents(events, body);
  const composeEvents = events.filter(event => event.imr === 3 && event.event === 'compose-hash');
  must(composeEvents.length === 1 && hex(composeEvents[0].event_payload) === hex(policy.composeHash), 'COMPOSE_EVENT');
  must(hex(body.mrconfig) === `01${hex(policy.composeHash)}${'00'.repeat(15)}`, 'COMPOSE_MEASUREMENT');
  onProgress('EVENT_LOG_AND_COMPOSE_VERIFIED');

  const verifiedAt = Date.now();
  return {
    status: 'VERIFIED_PINNED_TDX_VIA_PHALA',
    teeEndpoint: endpoint,
    encryptionPublicKey: identity.encryptionPublicKey,
    operator: identity.operator,
    quoteHash,
    verifiedAt,
    expiresAt: verifiedAt + 60_000
  };
}
