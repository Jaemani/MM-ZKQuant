import { createHash } from 'node:crypto';

const hex = x => String(x ?? '').replace(/^0x/, '').toLowerCase();
const must = (ok, message) => { if (!ok) throw Error(message); };
const fields = [['tee_tcb_svn',16],['mrseam',48],['mrsignerseam',48],['seamattributes',8],['tdattributes',8],['xfam',8],['mrtd',48],['mrconfig',48],['mrowner',48],['mrownerconfig',48],['rtmr0',48],['rtmr1',48],['rtmr2',48],['rtmr3',48],['reportdata',64]];

// Intel TDX quote v4: 48-byte header, 584-byte signed TD report, then
// length-prefixed signature data. DCAP signature/collateral validation is
// delegated to Phala over HTTPS; compare its decoded report to our input.
// The vendor's opaque checksum is NOT a SHA-256 hash of the raw quote.
export function verifiedTdxBody(rawQuote, result) {
  const raw = hex(rawQuote);
  must(raw.length <= 65536 && raw.length >= 1272 && raw.length % 2 === 0 && /^[0-9a-f]+$/.test(raw), 'Invalid quote');
  const bytes = Buffer.from(raw, 'hex');
  must(bytes.readUInt16LE(0) === 4 && bytes.readUInt16LE(2) === 2 && bytes.readUInt32LE(4) === 129, 'Unsupported TDX quote header');
  must(bytes.readUInt32LE(632) > 0 && bytes.readUInt32LE(632) + 636 <= bytes.length, 'Invalid quote signature length');
  // dstack returns a zero-padded quote buffer; reject nonzero trailing data.
  must(bytes.subarray(636+bytes.readUInt32LE(632)).every(b=>b===0), 'Invalid quote padding');
  must(result.success === true && result.quote?.verified === true, 'Hardware signature/collateral rejected');
  const { header, body } = result.quote;
  must(header?.version === 4 && [2,'ECDSA_P256'].includes(header.ak_type) && [129,'TEE_TDX'].includes(header.tee_type), 'Verifier quote header mismatch');
  must(hex(header.qe_vendor) === bytes.subarray(12,28).toString('hex') && hex(header.user_data) === bytes.subarray(28,48).toString('hex'), 'Verifier quote header mismatch');
  let offset = 48;
  for (const [name, length] of fields) {
    must(hex(body?.[name] ?? (name === 'mrconfig' ? body?.mr_config_id : undefined)) === bytes.subarray(offset,offset+length).toString('hex'), 'Verifier signed report mismatch: '+name);
    offset += length;
  }
  return { body, quoteHash: createHash('sha256').update(bytes).digest('hex') };
}

// dstack cc-eventlog/src/lib.rs: runtime event hash covers the event name
// AND payload, even when the JSON API omits digest. x86 event_type is LE.
export function replayTdxEvents(events, body) {
  must(Array.isArray(events) && events.length > 0, 'Missing event log');
  const mrs = Array.from({length:4},()=>Buffer.alloc(48));
  for (const ev of events) {
    must(Number.isInteger(ev.imr) && ev.imr >= 0 && ev.imr < 4, 'Invalid event register');
    let digest;
    if (ev.imr === 3) {
      const payload=hex(ev.event_payload);
      must(payload.length % 2 === 0 && /^[0-9a-f]*$/.test(payload) && typeof ev.event === 'string', 'Invalid runtime event');
      must(Number.isInteger(ev.event_type) && ev.event_type >= 0 && ev.event_type <= 0xffffffff, 'Invalid event type');
      const type=Buffer.alloc(4);type.writeUInt32LE(ev.event_type);
      digest=createHash('sha384').update(Buffer.concat([type,Buffer.from(':'+ev.event+':'),Buffer.from(payload,'hex')])).digest();
      if (ev.digest) must(hex(ev.digest) === digest.toString('hex'), 'Runtime event digest mismatch');
    } else {
      must(/^[0-9a-f]{96}$/.test(hex(ev.digest)), 'Missing boot event digest');
      digest=Buffer.from(hex(ev.digest),'hex');
    }
    mrs[ev.imr]=createHash('sha384').update(Buffer.concat([mrs[ev.imr],digest])).digest();
  }
  for (let i=0;i<4;i++) must(mrs[i].toString('hex') === hex(body['rtmr'+i]), 'Event log does not match quote: rtmr'+i);
  return mrs.map(m=>m.toString('hex'));
}
