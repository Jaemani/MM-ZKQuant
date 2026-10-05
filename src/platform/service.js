import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, verifyMessage } from 'ethers';

const hash = value => createHash('sha256').update(value).digest('hex');
const sessionHash = token => hash(`MMQ_SESSION_V1:${token}`);
const apiKeyHash = token => hash(`MMQ_API_KEY_V1:${token}`);
const authorizationToken = value => String(value || '').replace(/^Bearer\s+/i, '');
const authorizationMessage = ({ address, nonce }) => `MM-ZKQuant Testnet authorization\nAddress: ${address}\nNonce: ${nonce}`;

export class PlatformError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function address(value) {
  if (!isAddress(value)) throw new PlatformError('INVALID_WALLET');
  return getAddress(value);
}
function text(value, code, minimum, maximum) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) throw new PlatformError(code);
  return value.trim();
}
function integer(value, code, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new PlatformError(code);
  return value;
}
function compareHash(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export class PlatformService {
  constructor(database) { this.database = database; }

  async challenge(input) {
    const wallet = address(input.address), nonce = randomBytes(32).toString('hex'), message = authorizationMessage({ address: wallet, nonce });
    await this.database.query('INSERT INTO auth_challenges(nonce,address,message,expires_at) VALUES($1,$2,$3,now()+interval \'5 minutes\')', [nonce, wallet, message]);
    return { address: wallet, nonce, message, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }

  async verify(input) {
    const wallet = address(input.address), nonce = text(input.nonce, 'INVALID_NONCE', 64, 64), signature = text(input.signature, 'INVALID_SIGNATURE', 64, 512);
    return this.database.transaction(async client => {
      const { rows } = await client.query('SELECT nonce,address,message FROM auth_challenges WHERE nonce=$1 AND address=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE', [nonce, wallet]);
      if (!rows[0]) throw new PlatformError('AUTHORIZATION_EXPIRED', 401);
      if (verifyMessage(rows[0].message, signature).toLowerCase() !== wallet.toLowerCase()) throw new PlatformError('INVALID_SIGNATURE', 401);
      await client.query('UPDATE auth_challenges SET used_at=now() WHERE nonce=$1', [nonce]);
      const knownWallet = await client.query('SELECT user_id FROM wallets WHERE address=$1 FOR UPDATE', [wallet]);
      if (knownWallet.rows[0]) await client.query('UPDATE wallets SET verified_at=now() WHERE address=$1', [wallet]);
      else {
        const userId = randomUUID();
        await client.query('INSERT INTO users(id) VALUES($1)', [userId]);
        await client.query('INSERT INTO wallets(address,user_id,verified_at) VALUES($1,$2,now())', [wallet, userId]);
      }
      const token = `mmq_session_${randomBytes(32).toString('base64url')}`;
      await client.query('INSERT INTO sessions(token_hash,wallet_address,expires_at) VALUES($1,$2,now()+interval \'24 hours\')', [sessionHash(token), wallet]);
      return { wallet, sessionToken: token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    });
  }

  async session(authorization) {
    const token = authorizationToken(authorization);
    if (!/^mmq_session_[A-Za-z0-9_-]{20,}$/.test(token)) throw new PlatformError('SESSION_REQUIRED', 401);
    const { rows } = await this.database.query('UPDATE sessions SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING wallet_address', [sessionHash(token)]);
    if (!rows[0]) throw new PlatformError('SESSION_EXPIRED', 401);
    return rows[0].wallet_address;
  }

  async apiKey(authorization) {
    const token = authorizationToken(authorization);
    if (!/^mmq_test_[A-Za-z0-9_-]{20,}$/.test(token)) throw new PlatformError('API_KEY_REQUIRED', 401);
    const tokenHash = apiKeyHash(token);
    const { rows } = await this.database.query('SELECT id,strategist_wallet,key_hash FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())', [tokenHash]);
    if (!rows[0] || !compareHash(rows[0].key_hash, tokenHash)) throw new PlatformError('API_KEY_INVALID', 401);
    await this.database.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [rows[0].id]);
    return rows[0];
  }

  async upsertStrategist(authorization, input) {
    const wallet = await this.session(authorization), displayName = text(input.displayName, 'INVALID_DISPLAY_NAME', 2, 60), bio = text(input.bio, 'INVALID_BIO', 2, 500);
    const { rows } = await this.database.query(`INSERT INTO strategists(wallet_address,display_name,bio,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(wallet_address) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,updated_at=now() RETURNING wallet_address,display_name,bio,status,created_at,updated_at`, [wallet, displayName, bio]);
    return rows[0];
  }

  async issueApiKey(authorization) {
    const wallet = await this.session(authorization);
    const strategist = await this.database.query('SELECT wallet_address FROM strategists WHERE wallet_address=$1 AND status=\'ACTIVE\'', [wallet]);
    if (!strategist.rows[0]) throw new PlatformError('STRATEGIST_REQUIRED', 403);
    const apiKey = `mmq_test_${randomBytes(24).toString('base64url')}`, id = randomUUID();
    await this.database.query('INSERT INTO api_keys(id,strategist_wallet,key_prefix,key_hash) VALUES($1,$2,$3,$4)', [id, wallet, apiKey.slice(0, 14), apiKeyHash(apiKey)]);
    return { id, apiKey, createdAt: new Date().toISOString() };
  }

  async createStrategy(authorization, input) {
    const key = await this.apiKey(authorization), slug = text(input.slug, 'INVALID_SLUG', 3, 48).toLowerCase();
    if (!/^[a-z][a-z0-9-]{2,47}$/.test(slug)) throw new PlatformError('INVALID_SLUG');
    const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(input.risk) ? input.risk : 'HIGH';
    const { rows } = await this.database.query(`INSERT INTO strategies(id,slug,strategist_wallet,name,description,risk,fee_bps,status) VALUES($1,$2,$3,$4,$5,$6,$7,'WAITING_FOR_VAULT') RETURNING *`, [randomUUID(), slug, key.strategist_wallet, text(input.name, 'INVALID_STRATEGY_NAME', 2, 100), text(input.description, 'INVALID_DESCRIPTION', 2, 500), risk, integer(input.feeBps, 'INVALID_FEE_BPS', 0, 2000)]);
    return rows[0];
  }

  async recordPerformance(authorization, strategyId, input) {
    const key = await this.apiKey(authorization), strategy = await this.ownedStrategy(key.strategist_wallet, strategyId);
    const start = new Date(input.periodStart), end = new Date(input.periodEnd);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start) throw new PlatformError('INVALID_PERIOD');
    const navStart = text(String(input.navStart), 'INVALID_NAV_START', 1, 78), navEnd = text(String(input.navEnd), 'INVALID_NAV_END', 1, 78);
    if (!/^\d+$/.test(navStart) || !/^\d+$/.test(navEnd) || BigInt(navStart) === 0n) throw new PlatformError('INVALID_NAV');
    const { rows } = await this.database.query('INSERT INTO performance_records(id,strategy_id,period_start,period_end,nav_start,nav_end,return_bps,source,evidence_uri) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [randomUUID(), strategy.id, start.toISOString(), end.toISOString(), navStart, navEnd, integer(input.returnBps, 'INVALID_RETURN_BPS', -1_000_000, 1_000_000), text(input.source, 'INVALID_SOURCE', 2, 100), text(input.evidenceUri, 'INVALID_EVIDENCE_URI', 8, 2000)]);
    return rows[0];
  }

  async ownedStrategy(wallet, strategyId) {
    const { rows } = await this.database.query('SELECT * FROM strategies WHERE id=$1 AND strategist_wallet=$2', [strategyId, wallet]);
    if (!rows[0]) throw new PlatformError('STRATEGY_FORBIDDEN', 403);
    return rows[0];
  }

  async publicStrategies() {
    const { rows } = await this.database.query(`SELECT s.id,s.slug,s.name,s.description,s.risk,s.fee_bps,s.status,s.vault_address,s.created_at,st.display_name AS strategist_name,st.wallet_address AS strategist_wallet,n.estimated_nav,n.unit_nav,n.pnl_bps,n.marked_at FROM strategies s JOIN strategists st ON st.wallet_address=s.strategist_wallet LEFT JOIN LATERAL (SELECT estimated_nav,unit_nav,pnl_bps,marked_at FROM nav_marks WHERE strategy_id=s.id ORDER BY marked_at DESC LIMIT 1) n ON true WHERE s.status <> 'SUSPENDED' ORDER BY s.created_at DESC`);
    return { strategies: rows };
  }

  async portfolio(authorization) {
    const wallet = await this.session(authorization);
    const { rows } = await this.database.query(`SELECT s.id,s.slug,s.name,COALESCE(dep.shares,0)-COALESCE(red.shares,0) AS shares,n.unit_nav,n.estimated_nav,n.pnl_bps,n.marked_at FROM strategies s JOIN (SELECT strategy_id,SUM(shares) AS shares FROM subscriptions WHERE investor_wallet=$1 AND status='CONFIRMED' GROUP BY strategy_id) dep ON dep.strategy_id=s.id LEFT JOIN (SELECT strategy_id,SUM(shares) AS shares FROM redemptions WHERE investor_wallet=$1 AND status='PAID' GROUP BY strategy_id) red ON red.strategy_id=s.id LEFT JOIN LATERAL (SELECT unit_nav,estimated_nav,pnl_bps,marked_at FROM nav_marks WHERE strategy_id=s.id ORDER BY marked_at DESC LIMIT 1) n ON true WHERE COALESCE(dep.shares,0)>COALESCE(red.shares,0) ORDER BY s.name`, [wallet]);
    return { wallet, positions: rows };
  }
}
