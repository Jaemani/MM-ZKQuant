import { encryptedTeeRequest } from './teeChannel.js';

// The verified key, never the unverified /v1/config key, is passed to the
// encryption channel. A short cache avoids another vendor round trip during
// a multi-step deposit while every new session gets a fresh challenge.
export function createAttestedTeeChannel({ loadAttestation, sendEncrypted = encryptedTeeRequest, now = Date.now }) {
  let cached = null, pending = null, generation = 0;
  const sameConfig = (entry, config) => entry?.teeEndpoint === config?.teeEndpoint && entry?.encryptionPublicKey === config?.teeEncryptionPublicKey;

  async function verify(config) {
    if (!config?.teeEndpoint || !config?.teeEncryptionPublicKey) throw Error('TEE_ATTESTATION_UNAVAILABLE');
    if (sameConfig(cached, config) && cached.expiresAt > now() + 5000) return cached;
    if (sameConfig(pending, config)) return pending.promise;
    const version = generation;
    const task = { teeEndpoint: config.teeEndpoint, encryptionPublicKey: config.teeEncryptionPublicKey };
    task.promise = loadAttestation().then(result => {
      if (version !== generation || pending !== task || result?.status !== 'VERIFIED_PINNED_TDX_VIA_PHALA' ||
          !sameConfig(result, config) || !Number.isFinite(result.expiresAt) || result.expiresAt <= now())
        throw Error('TEE_ATTESTATION_FAILED');
      const verified = { teeEndpoint: result.teeEndpoint, encryptionPublicKey: result.encryptionPublicKey, expiresAt: Math.min(result.expiresAt, now() + 60_000) };
      if (pending === task) cached = verified;
      return verified;
    }).finally(() => { if (pending === task) pending = null; });
    pending = task;
    return task.promise;
  }

  return {
    async send(config, path, message, options) {
      const version = generation;
      const verified = await verify(config);
      if (version !== generation) throw Error('TEE_ATTESTATION_FAILED');
      return sendEncrypted(verified.teeEndpoint, verified.encryptionPublicKey, path, message, options);
    },
    clear() { generation++; cached = null; pending = null; }
  };
}
