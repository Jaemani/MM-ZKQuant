import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ZeroAddress, ZeroHash, sha256, toUtf8Bytes } from 'ethers';
import { createLocalRegistry } from '../contracts/local-evm.mjs';
import { compileRegistry, normalizeManifest } from '../scripts/chain-demo.mjs';
import { canonicalJson } from '../src/shared/protocol.js';

test('epoch registry preserves anchored bytes and rejects unauthorized or ambiguous writes', async (t) => {
  const artifact = await compileRegistry();
  const contract = await createLocalRegistry(artifact);
  await contract.deploy();
    const manifest = normalizeManifest({
      epochId: 'epoch-42',
      root: sha256(toUtf8Bytes('root-42')),
      manifestHash: sha256(toUtf8Bytes('manifest-42')),
    });
    await t.test('constructor cannot create an unpublishable registry', async () => {
      await assert.rejects(contract.deploy(ZeroAddress), /InvalidPublisher/);
    });
    await t.test('unknown epoch is distinguishable from an anchored epoch', async () => {
      const [empty] = await contract.read('getCommitment', [manifest.epochKey]);
      assert.equal(empty.root, ZeroHash);
      assert.equal(empty.anchoredAt, 0n);
    });
    await t.test('only the immutable publisher may anchor', async () => {
      assert.equal((await contract.read('publisher'))[0].toLowerCase(), contract.publisher);
      await assert.rejects(contract.transact('anchor', [manifest.epochKey, manifest.root, manifest.manifestHash], 1), /Unauthorized/);
      assert.equal((await contract.read('getCommitment', [manifest.epochKey]))[0].root, ZeroHash);
    });
    await t.test('zero epoch key, root, and policy manifest are rejected', async () => {
      await assert.rejects(contract.transact('anchor', [ZeroHash, manifest.root, manifest.manifestHash]), /InvalidCommitment/);
      await assert.rejects(contract.transact('anchor', [manifest.epochKey, ZeroHash, manifest.manifestHash]), /InvalidCommitment/);
      await assert.rejects(contract.transact('anchor', [manifest.epochKey, manifest.root, ZeroHash]), /InvalidCommitment/);
    });
    await t.test('event and storage bind both the batch root and manifest', async () => {
      const receipt = await contract.transact('anchor', [manifest.epochKey, manifest.root, manifest.manifestHash]);
      const [stored] = await contract.read('getCommitment', [manifest.epochKey]);
      assert.equal(stored.root, manifest.root);
      assert.equal(stored.manifestHash, manifest.manifestHash);
      assert.equal(stored.blockNumber, BigInt(receipt.blockNumber));
      assert.ok(stored.anchoredAt > 0n);
      const event = receipt.logs.map((log) => contract.iface.parseLog(log)).find((log) => log?.name === 'EpochAnchored');
      assert.equal(event.args.epochKey, manifest.epochKey);
      assert.equal(event.args.root, manifest.root);
      assert.equal(event.args.manifestHash, manifest.manifestHash);
    });
    await t.test('a published epoch cannot be overwritten, including identical retry', async () => {
      await assert.rejects(contract.transact('anchor', [manifest.epochKey, manifest.root, manifest.manifestHash]), /AlreadyAnchored/);
      await assert.rejects(contract.transact('anchor', [manifest.epochKey, sha256(toUtf8Bytes('changed')), manifest.manifestHash]), /AlreadyAnchored/);
      const [stored] = await contract.read('getCommitment', [manifest.epochKey]);
      assert.equal(stored.root, manifest.root);
      assert.equal(stored.manifestHash, manifest.manifestHash);
    });
    await t.test('the contract cannot accidentally receive investor capital', async () => {
      await assert.rejects(contract.sendValue(1n), /EVM reverted/);
    });
});

test('chain manifest input rejects missing digests and uses namespaced epoch keys', () => {
  assert.throws(() => normalizeManifest({ epochId: 'x', root: ZeroHash, manifestHash: ZeroHash }));
  assert.throws(() => normalizeManifest({ epochId: '', root: sha256(toUtf8Bytes('r')), manifestHash: sha256(toUtf8Bytes('m')) }));
  const input = { epochId: 'x', root: sha256(toUtf8Bytes('r')), manifestHash: sha256(toUtf8Bytes('m')) };
  assert.equal(normalizeManifest(input).epochKey, sha256(toUtf8Bytes('mmzkquant:epoch:v1:x')));
  assert.notEqual(normalizeManifest(input).epochKey, normalizeManifest({ ...input, epochId: 'y' }).epochKey);
});

test('an exported full manifest must bind the exact epoch, root, and canonical manifest hash', () => {
  const root = sha256(toUtf8Bytes('sealed root'));
  const manifest = { domain: 'MM_ALPHA_EPOCH_V1', epochId: 'sealed-epoch', submissionRoot: root, policyHash: sha256(toUtf8Bytes('policy')) };
  const manifestHash = '0x' + createHash('sha256').update(canonicalJson(manifest)).digest('hex');
  const exported = { epochId: manifest.epochId, root, manifestHash, manifest };
  assert.equal(normalizeManifest(exported).manifestHash, manifestHash);
  assert.throws(() => normalizeManifest({ ...exported, epochId: 'another-epoch' }), /does not match/);
  assert.throws(() => normalizeManifest({ ...exported, root: sha256(toUtf8Bytes('another-root')) }), /does not match/);
  assert.throws(() => normalizeManifest({ ...exported, manifest: { ...manifest, policyHash: root } }), /does not match/);
});
