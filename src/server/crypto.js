import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, privateDecrypt, publicEncrypt, sign, verify, constants, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../shared/protocol.js';

export const hash = value => '0x' + createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
export function makeKeys() {
  const encryption = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signing = generateKeyPairSync('ed25519');
  return {
    encryptionPrivateKey: encryption.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signingPrivateKey: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    tokenSecret: randomBytes(32).toString('hex'),
  };
}
export function signingPublicKey(privateKey) { return createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64'); }
export function parsePublicKey(base64) {
  if (typeof base64 !== 'string' || base64.length > 200) throw new Error('Invalid signing key');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) throw new Error('Canonical base64 signing key required');
  const key = createPublicKey({ key: bytes, type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 signing key required');
  if (key.export({ type: 'spki', format: 'der' }).toString('base64') !== base64) throw new Error('Canonical DER signing key required');
  return key;
}
export function signObject(value, privateKey) { return sign(null, Buffer.from(canonicalJson(value)), createPrivateKey(privateKey)).toString('base64'); }
export function verifyObject(value, signature, publicKey) {
  try { return typeof signature === 'string' && signature.length === 88 && verify(null, Buffer.from(canonicalJson(value)), parsePublicKey(publicKey), Buffer.from(signature, 'base64')); } catch { return false; }
}
function decode(value, min, max) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid encrypted envelope');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== value) throw new Error('Invalid encrypted envelope');
  return bytes;
}
export function encryptEnvelope(value, publicKey) {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { wrappedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') };
}
export function decryptEnvelope(envelope, privateKey) {
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, decode(envelope.wrappedKey, 256, 256));
  const iv = decode(envelope.iv, 12, 12), ciphertext = decode(envelope.ciphertext, 17, 131072);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(ciphertext.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'));
}
export function tokenFor(keys, epochId, providerId, leafHash) { return createHmac('sha256', keys.tokenSecret).update([epochId, providerId, leafHash].join(':')).digest('hex'); }
export function secureEqual(a, b) { return typeof a === 'string' && typeof b === 'string' && /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function parentHash(left, right) { return '0x' + createHash('sha256').update(Buffer.from('01', 'hex')).update(Buffer.from(left.slice(2), 'hex')).update(Buffer.from(right.slice(2), 'hex')).digest('hex'); }
export function leafHash(leaf) { return hash('00' + canonicalJson(leaf)); }
export function merkleTree(leaves) {
  if (!leaves.length) throw new Error('Empty roster');
  const levels = [leaves.map(leafHash)];
  while (levels.at(-1).length > 1) {
    const current = levels.at(-1), next = [];
    for (let i = 0; i < current.length; i += 2) next.push(parentHash(current[i], current[i + 1] ?? current[i]));
    levels.push(next);
  }
  return { root: levels.at(-1)[0], proofs: leaves.map((_, index) => {
    const proof = [];
    for (let level = 0; level < levels.length - 1; level++) {
      proof.push({ side: index % 2 ? 'left' : 'right', hash: levels[level][index ^ 1] ?? levels[level][index] });
      index = Math.floor(index / 2);
    }
    return proof;
  }) };
}
export function verifyInclusion(leaf, proof, root) {
  try {
    if (!Array.isArray(proof) || proof.length > 32) return false;
    let current = leafHash(leaf);
    for (const sibling of proof) {
      if (!['left', 'right'].includes(sibling.side) || !/^0x[0-9a-f]{64}$/.test(sibling.hash)) return false;
      current = sibling.side === 'left' ? parentHash(sibling.hash, current) : parentHash(current, sibling.hash);
    }
    return current === root;
  } catch { return false; }
}
export function verifyReceipt(receipt, trustedPublicKey) {
  const { serverSignature, receiptToken, ...signed } = receipt;
  const signatureValid = verifyObject(signed, serverSignature, trustedPublicKey);
  const inclusionValid = receipt.root ? verifyInclusion(receipt.leaf, receipt.proof, receipt.root) : null;
  const manifestValid = receipt.manifest ? hash(receipt.manifest) === receipt.manifestHash && receipt.manifest.submissionRoot === receipt.root : null;
  const contextValid = receipt.leaf?.epochId === receipt.epochId && receipt.leaf?.providerId === receipt.providerId && receipt.leaf?.status === 'SUBMITTED'
    && receipt.leafHash === leafHash(receipt.leaf) && receipt.serverPublicKey === trustedPublicKey
    && (!receipt.manifest || (receipt.manifest.epochId === receipt.epochId && receipt.manifest.policyHash === receipt.policyHash && receipt.manifest.workspace === receipt.workspace));
  return { valid: signatureValid && contextValid && inclusionValid !== false && manifestValid !== false, signatureValid, inclusionValid, manifestValid, contextValid, independentlyTimestamped: false };
}
