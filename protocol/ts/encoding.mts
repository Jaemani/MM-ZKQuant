import { buildPoseidon } from 'circomlibjs';
import { keccak256, toUtf8Bytes } from 'ethers';

// Draft v0.1 wire compatibility, NOT a reviewed protocol or production SDK.
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DOMAIN_NAMES = 'INTENT INTENT_HDR TARGETS SIG NOTE NOTE_HDR SLOTS ANCHOR NF EXEC SNAP ACC LEDGER_LEAF NAV ESCAPE LEASE_REC SIGNALS KEY'.split(' ');
export type Scalar = bigint | string;
export function integer(value: Scalar): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(value)) throw new Error('canonical decimal integer required');
  return BigInt(value);
}
export function encode(type: string, value: Scalar): bigint {
  const x = integer(value);
  const unsigned: Record<string, number> = { u64: 64, price: 96, bps: 16, address: 160, bool: 1 };
  if (type in unsigned) {
    if (x < 0n || x >= 1n << BigInt(unsigned[type])) throw new Error(`${type} range`);
    return x;
  }
  if (type === 'qty' || type === 'amount') {
    const bound = 1n << (type === 'qty' ? 63n : 128n);
    if (x <= -bound || x >= bound) throw new Error(`${type} range`);
    return x < 0n ? FIELD + x : x;
  }
  if (type === 'bytes32') {
    if (x < 0n || x >= 1n << 256n) throw new Error('bytes32 range');
    return x & ((1n << 253n) - 1n);
  }
  const enums: Record<string, bigint[]> = { side: [1n, 2n], tif: [1n], authMode: [0n, 1n], snapCause: [1n, 2n, 3n, 4n], leaseOp: [1n, 2n] };
  if (type in enums) {
    if (!enums[type].includes(x)) throw new Error(`${type} enum`);
    return x;
  }
  if (type !== 'hash') throw new Error('unknown scalar type');
  if (x < 0n || x >= FIELD) throw new Error('noncanonical field');
  return x;
}
export function domain(name: string): bigint {
  if (!DOMAIN_NAMES.includes(name)) throw new Error('unknown domain');
  return BigInt(keccak256(toUtf8Bytes(`monad-metropolis/v1/${name}`))) % FIELD;
}

// Explicit §4 formula order. Undomained subhashes deliberately mirror the draft;
// see spec-review.md before choosing a final version or trusted setup.
export const SCHEMAS: Record<string, string[]> = {
  INTENT_HDR: ['u64','u64','u64','u64','u64','bps','tif','u64','u64'],
  TARGETS: Array.from({length: 7}, () => ['u64','qty']).flat(),
  INTENT: ['hash','hash','hash'], SIG: ['hash','u64'], KEY: ['hash','hash','hash'],
  NOTE_HDR: ['u64','u64','u64','u64','hash','u64','bool','amount','u64','hash','u64'],
  SLOT: ['address','u64','u64','qty','u64'], SLOT_GROUP: Array(8).fill('hash'),
  SLOTS: ['hash','hash'], ANCHOR: ['hash','u64','amount'], NOTE_SECRET: ['hash','u64'],
  NOTE: ['hash','hash','hash','hash'], NF: ['hash','u64','u64'],
  EXEC: ['address','u64','u64','qty','price','tif','u64','amount','bool','authMode','hash'],
  SNAP: ['address','u64','u64','qty','price','amount','amount','amount','price','u64','snapCause','amount'],
  ACC: ['hash','hash'], LEASE_REC: ['address','u64','u64','leaseOp','hash'],
  LEDGER_LEAF: ['u64','amount','price','amount','amount','hash','hash','hash','u64'],
};
export async function createCodec() {
  const poseidon = await buildPoseidon();
  function hash(name: string, values: Scalar[]): bigint {
    const schema = SCHEMAS[name];
    if (!schema || values.length !== schema.length) throw new Error('hash schema/arity');
    const inputs = values.map((x, i) => encode(schema[i], x));
    if (!['SLOT','SLOT_GROUP','NOTE_SECRET'].includes(name)) inputs.unshift(domain(name));
    return BigInt(poseidon.F.toString(poseidon(inputs)));
  }
  function intent(header: Scalar[], targets: Scalar[][], salt: Scalar) {
    if (header.length !== 8 || targets.length < 1 || targets.length > 7 || targets.some(t => t.length !== 2)) throw new Error('intent shape');
    if (new Set(targets.map(t => encode('u64',t[0]).toString())).size !== targets.length) throw new Error('duplicate market');
    const padded = targets.flat();
    while (padded.length < 14) padded.push(0n);
    const hdr = hash('INTENT_HDR', [...header, BigInt(targets.length)]);
    const comm = hash('INTENT', [hdr, hash('TARGETS', padded), salt]);
    return { intentComm: comm, sigMsg: hash('SIG', [comm, header[3]]) };
  }
  function note(header: Scalar[], slots: Scalar[][], anchor: Scalar[], productSecret: Scalar) {
    if (header.length !== 11 || slots.length > 16 || integer(header[8]) !== BigInt(slots.length)) throw new Error('note slot count');
    if (new Set(slots.map(s => encode('u64',s[1]).toString())).size !== slots.length) throw new Error('duplicate slot market');
    const leaves = slots.map(s => hash('SLOT', s));
    while (leaves.length < 16) leaves.push(0n);
    const slotsHash = hash('SLOTS', [hash('SLOT_GROUP',leaves.slice(0,8)), hash('SLOT_GROUP',leaves.slice(8))]);
    const secret = hash('NOTE_SECRET', [productSecret,header[1]]);
    return { noteComm: hash('NOTE',[hash('NOTE_HDR',header),slotsHash,hash('ANCHOR',anchor),secret]), nullifier: hash('NF',[secret,header[0],header[1]]) };
  }
  return { hash, intent, note };
}
