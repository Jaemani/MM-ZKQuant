import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, verifyMessage } from 'ethers';
import { SealedStore } from '../../../src/integration/sealed.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const apiHash = value => hash(`MMQ_PLATFORM_KEY_V1:${value}`);
const timestamp = () => new Date().toISOString();
const messageFor = ({ address, nonce }) => `MM-ZKQuant Testnet strategist authorization\nAddress: ${address}\nNonce: ${nonce}`;

function text(value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) throw Error(`INVALID_${label}`);
  return value.trim();
}
function address(value) { if (!isAddress(value)) throw Error('INVALID_ADDRESS'); return getAddress(value); }
function target(value) { if (!Number.isInteger(value) || value < -100 || value > 100) throw Error('INVALID_TARGET'); return value; }

export class TestnetPlatform {
  constructor({ secret, storeDir }) {
    this.store = new SealedStore(`${storeDir}/platform.json`, secret, 'testnet-platform-v1');
    this.commitKey = createHmac('sha256', secret).update('platform-target-commitment-v1').digest();
  }
  state() { return this.store.read() || { version: 1, challenges: {}, strategists: {}, keys: {}, strategies: {}, submissions: {} }; }
  mutate(fn) { const state = this.state(); const result = fn(state); this.store.write(state); return result; }
  challenge(input) {
    const owner = address(input.address);
    return this.mutate(state => {
      const nonce = randomBytes(32).toString('hex'), expiresAt = Date.now() + 300_000;
      state.challenges[owner.toLowerCase()] = { nonce, expiresAt };
      return { address: owner, nonce, message: messageFor({ address: owner, nonce }), expiresAt: new Date(expiresAt).toISOString() };
    });
  }
  authorize(state, input) {
    const owner = address(input.address), pending = state.challenges[owner.toLowerCase()];
    if (!pending || pending.expiresAt < Date.now() || pending.nonce !== input.nonce) throw Error('AUTHORIZATION_EXPIRED');
    if (typeof input.signature !== 'string' || verifyMessage(messageFor({ address: owner, nonce: pending.nonce }), input.signature).toLowerCase() !== owner.toLowerCase()) throw Error('INVALID_SIGNATURE');
    delete state.challenges[owner.toLowerCase()];
    return owner;
  }
  issue(state, strategist) {
    const apiKey = `mmq_test_${randomBytes(24).toString('base64url')}`, id = hash(apiKey).slice(0, 24);
    state.keys[id] = { id, strategist, hash: apiHash(apiKey), createdAt: timestamp(), lastUsedAt: null, revokedAt: null };
    return { id, apiKey, createdAt: state.keys[id].createdAt };
  }
  enroll(input) {
    return this.mutate(state => {
      const owner = this.authorize(state, input), key = owner.toLowerCase(), prior = state.strategists[key];
      const strategist = { address: owner, name: text(input.name, 'NAME', 2, 60), bio: text(input.bio, 'BIO', 2, 500), createdAt: prior?.createdAt || timestamp(), updatedAt: timestamp() };
      state.strategists[key] = strategist;
      return { strategist, key: this.issue(state, owner) };
    });
  }
  issueKey(input) {
    return this.mutate(state => { const owner = this.authorize(state, input); if (!state.strategists[owner.toLowerCase()]) throw Error('STRATEGIST_NOT_FOUND'); return this.issue(state, owner); });
  }
  key(authorization) {
    const raw = String(authorization || '').replace(/^Bearer\s+/i, '');
    if (!/^mmq_test_[A-Za-z0-9_-]{20,}$/.test(raw)) throw Error('API_KEY_REQUIRED');
    const digest = apiHash(raw), record = Object.values(this.state().keys).find(item => timingSafeEqual(Buffer.from(item.hash, 'hex'), Buffer.from(digest, 'hex')));
    if (!record || record.revokedAt) throw Error('API_KEY_INVALID');
    return record;
  }
  createStrategy(authorization, input) {
    const key = this.key(authorization);
    return this.mutate(state => {
      const owner = state.strategists[key.strategist.toLowerCase()]; if (!owner) throw Error('STRATEGIST_NOT_FOUND');
      const id = text(input.id, 'STRATEGY_ID', 3, 48).toLowerCase(); if (!/^[a-z][a-z0-9-]{2,47}$/.test(id)) throw Error('INVALID_STRATEGY_ID');
      const prior = state.strategies[id]; if (prior && prior.strategist.toLowerCase() !== key.strategist.toLowerCase()) throw Error('STRATEGY_ID_TAKEN');
      const strategy = { id, strategist: key.strategist, strategistName: owner.name, name: text(input.name, 'NAME', 2, 100), description: text(input.description, 'DESCRIPTION', 2, 500), risk: ['LOW', 'MEDIUM', 'HIGH'].includes(input.risk) ? input.risk : 'HIGH', feeBps: Number.isInteger(input.feeBps) && input.feeBps >= 0 && input.feeBps <= 2000 ? input.feeBps : 2000, createdAt: prior?.createdAt || timestamp(), updatedAt: timestamp(), status: 'TESTNET_WAITING_FOR_VAULT' };
      state.strategies[id] = strategy; state.keys[key.id].lastUsedAt = timestamp(); return this.publicStrategy(strategy, state);
    });
  }
  submitTarget(authorization, strategyId, input) {
    const key = this.key(authorization);
    return this.mutate(state => {
      const strategy = state.strategies[strategyId]; if (!strategy) throw Error('STRATEGY_NOT_FOUND'); if (strategy.strategist.toLowerCase() !== key.strategist.toLowerCase()) throw Error('STRATEGY_FORBIDDEN');
      const epoch = text(input.epoch, 'EPOCH', 1, 80), targetLots = target(input.targetLots), deadline = Number(input.deadline);
      if (!Number.isInteger(deadline) || deadline <= Math.floor(Date.now() / 1000) || deadline > Math.floor(Date.now() / 1000) + 3600) throw Error('INVALID_DEADLINE');
      const submittedAt = timestamp(), receipt = createHmac('sha256', this.commitKey).update(JSON.stringify({ strategyId, epoch, targetLots, deadline, submittedAt })).digest('hex');
      state.submissions[`${strategyId}:${epoch}`] = { strategyId, epoch, targetLots, deadline, submittedAt, receipt }; state.keys[key.id].lastUsedAt = submittedAt;
      return { strategyId, epoch, acceptedAt: submittedAt, receipt, execution: 'QUEUED_FOR_TESTNET_EPOCH' };
    });
  }
  publicStrategy(strategy, state = this.state()) {
    const submitted = Object.values(state.submissions).filter(item => item.strategyId === strategy.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), latest = submitted[0];
    return { id: strategy.id, name: strategy.name, description: strategy.description, risk: strategy.risk, feeBps: strategy.feeBps, strategist: strategy.strategist, strategistName: strategy.strategistName, status: strategy.status, createdAt: strategy.createdAt, targetSubmissions: submitted.length, lastTargetAt: latest?.submittedAt || null, lastEpoch: latest?.epoch || null };
  }
  strategies() { const state = this.state(); return Object.values(state.strategies).map(item => this.publicStrategy(item, state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  status() { return { mode: 'TESTNET_PLATFORM_TEE', strategies: this.strategies().length, execution: 'COHORT_EXECUTOR_NOT_YET_BOUND' }; }
}
