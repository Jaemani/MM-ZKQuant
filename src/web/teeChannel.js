import { SigningKey, getBytes, hexlify, randomBytes } from 'ethers';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const hexToBytes = hex => Uint8Array.from(hex.match(/.{2}/g) || [], value => parseInt(value, 16));

async function channelKey(publicKey) {
  const ephemeral = new SigningKey(hexlify(randomBytes(32)));
  const sharedPoint = getBytes(ephemeral.computeSharedSecret(publicKey.startsWith('0x') ? publicKey : `0x${publicKey}`));
  // secp256k1 ECDH uses the x coordinate. This matches Node's ECDH.computeSecret.
  const raw = await crypto.subtle.importKey('raw', sharedPoint.slice(1, 33), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode('MM_CHANNEL_V1') }, raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { ephemeral: ephemeral.compressedPublicKey.slice(2), key };
}

export async function encryptedTeeRequest(endpoint, publicKey, path, message, { relayBase } = {}) {
  if (!endpoint || !publicKey) throw Error("TEE connection is not configured.");
  const { ephemeral, key } = await channelKey(publicKey);
  const iv = randomBytes(12);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('request'), tagLength: 128 }, key, encoder.encode(JSON.stringify(message))));
  const packet = { ephemeral, box: { version: 1, iv: bytesToHex(iv), data: bytesToHex(encrypted.slice(0, -16)), tag: bytesToHex(encrypted.slice(-16)) } };
  const url = relayBase ? `${relayBase.replace(/\/$/, '')}${path.replace(/^\/platform/, '')}` : `${endpoint.replace(/\/$/, '')}${path}`;
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet), signal: AbortSignal.timeout(28000) });
  } catch (error) {
    throw Error(error.name === 'TimeoutError' ? 'TEE_RESPONSE_TIMEOUT' : 'TEE_CONNECTION_FAILED');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.reply) throw Error(body.error || "TEE request rejected.");
  const sealed = body.reply;
  const cipher = new Uint8Array([...hexToBytes(sealed.data), ...hexToBytes(sealed.tag)]);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(sealed.iv), additionalData: encoder.encode('response'), tagLength: 128 }, key, cipher);
  const result=JSON.parse(decoder.decode(plaintext));
  if(result.error){const error=Error(result.error);error.teeRejected=true;throw error;}
  return result;
}
