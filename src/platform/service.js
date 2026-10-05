import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, verifyMessage } from 'ethers';
import { validatePolicy, nextSettlement } from './policy.js';

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
  constructor(database, { teeEndpoint, teeEncryptionPublicKey } = {}) {
    this.database = database;
    this.teeEndpoint = teeEndpoint?.replace(/\/$/, '');
    this.teeEncryptionPublicKey = teeEncryptionPublicKey;
  }

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

  async apiKey(authorization, {touch=true}={}) {
    const token = authorizationToken(authorization);
    if (!/^mmq_test_[A-Za-z0-9_-]{20,}$/.test(token)) throw new PlatformError('API_KEY_REQUIRED', 401);
    const tokenHash = apiKeyHash(token);
    const { rows } = await this.database.query('SELECT id,strategist_wallet,key_hash FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())', [tokenHash]);
    if (!rows[0] || !compareHash(rows[0].key_hash, tokenHash)) throw new PlatformError('API_KEY_INVALID', 401);
    if(touch)await this.database.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [rows[0].id]);
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

  async managerWallet(authorization, options) {
    if (authorizationToken(authorization).startsWith('mmq_session_')) {
      const wallet = await this.session(authorization);
      const {rows} = await this.database.query("SELECT wallet_address FROM strategists WHERE wallet_address=$1 AND status='ACTIVE'", [wallet]);
      if (!rows[0]) throw new PlatformError('STRATEGIST_REQUIRED', 403);
      return wallet;
    }
    return (await this.apiKey(authorization, options)).strategist_wallet;
  }

  async listApiKeys(authorization) {
    const wallet = await this.session(authorization);
    const {rows} = await this.database.query('SELECT id,key_prefix,created_at,last_used_at,expires_at,revoked_at FROM api_keys WHERE strategist_wallet=$1 ORDER BY created_at DESC', [wallet]);
    return {keys:rows};
  }

  async revokeApiKey(authorization, id) {
    const wallet = await this.session(authorization);
    const {rows} = await this.database.query('UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND strategist_wallet=$2 RETURNING id,revoked_at', [id,wallet]);
    if (!rows[0]) throw new PlatformError('API_KEY_NOT_FOUND',404);
    return rows[0];
  }

  async createStrategy(authorization, input) {
    const wallet = await this.managerWallet(authorization), slug = text(input.slug, 'INVALID_SLUG', 3, 48).toLowerCase();
    if (!/^[a-z][a-z0-9-]{2,47}$/.test(slug)) throw new PlatformError('INVALID_SLUG');
    const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(input.risk) ? input.risk : 'HIGH';
    let policy;try { policy=validatePolicy(input.policy); } catch(e) {throw new PlatformError(e.message);}
    let rows;
    try { ({rows}=await this.database.query(`INSERT INTO strategies(id,slug,strategist_wallet,name,description,risk,fee_bps,status,policy) VALUES($1,$2,$3,$4,$5,$6,$7,'FUNDING',$8) RETURNING *`, [randomUUID(), slug, wallet, text(input.name, 'INVALID_STRATEGY_NAME', 2, 100), text(input.description, 'INVALID_DESCRIPTION', 2, 500), risk, integer(input.feeBps, 'INVALID_FEE_BPS', 0, 2000),JSON.stringify(policy)])); }
    catch(error) { if(error.code==='23505'&&error.constraint==='strategies_slug_key')throw new PlatformError('STRATEGY_SLUG_TAKEN',409);throw error; }
    return rows[0];
  }

  async recordPerformance(authorization, strategyId, input) {
    const key = await this.apiKey(authorization), strategy = await this.ownedStrategy(key.strategist_wallet, strategyId);
    const start = new Date(input.periodStart), end = new Date(input.periodEnd);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start) throw new PlatformError('INVALID_PERIOD');
    const { rows } = await this.database.query('INSERT INTO performance_records(id,strategy_id,period_start,period_end,return_bps,volatility_bps,source,evidence_uri) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [randomUUID(), strategy.id, start.toISOString(), end.toISOString(), integer(input.returnBps, 'INVALID_RETURN_BPS', -1_000_000, 1_000_000), integer(input.volatilityBps, 'INVALID_VOLATILITY_BPS', 0, 1_000_000), text(input.source, 'INVALID_SOURCE', 2, 100), text(input.evidenceUri, 'INVALID_EVIDENCE_URI', 8, 2000)]);
    return rows[0];
  }

  async submitTarget() {
    throw new PlatformError('ENCRYPT_TARGETS_ON_CLIENT_AND_SUBMIT_DIRECTLY_TO_TEE',410);
  }

  async authorizeStrategy(authorization, strategyId) {
    const wallet=await this.managerWallet(authorization,{touch:false});
    return this.ownedStrategy(wallet,strategyId);
  }

  async myStrategies(authorization) {
    const wallet=await this.session(authorization);
    const {rows}=await this.database.query('SELECT * FROM strategies WHERE strategist_wallet=$1 ORDER BY created_at DESC',[wallet]);
    return {strategies:rows};
  }

  async proposePolicy(authorization,strategyId,input) {
    const wallet=await this.managerWallet(authorization),strategy=await this.ownedStrategy(wallet,strategyId);
    if(strategy.pending_policy)throw new PlatformError('POLICY_CHANGE_ALREADY_PENDING',409);
    let policy;try{policy=validatePolicy(input.policy);}catch(e){throw new PlatformError(e.message);}
    const feeBps=integer(input.feeBps,'INVALID_FEE_BPS',0,2000);
    const effectiveAfter=nextSettlement(strategy.policy,Math.floor(Date.now()/1000))+60;
    const proposal={policy,feeBps,version:strategy.policy_version+1,effectiveAfter,announcedAt:Math.floor(Date.now()/1000)};
    await this.database.transaction(async client=>{
      const changed=await client.query('UPDATE strategies SET pending_policy=$2 WHERE id=$1 AND pending_policy IS NULL RETURNING id',[strategyId,JSON.stringify(proposal)]);
      if(!changed.rows.length)throw new PlatformError('POLICY_CHANGE_ALREADY_PENDING',409);
      await client.query('INSERT INTO strategy_policy_history(strategy_id,version,policy,fee_bps,effective_after) VALUES($1,$2,$3,$4,$5)',[strategyId,proposal.version,JSON.stringify(policy),feeBps,new Date(effectiveAfter*1000).toISOString()]);
    });return proposal;
  }

  async ownedStrategy(wallet, strategyId) {
    const { rows } = await this.database.query('SELECT * FROM strategies WHERE id=$1 AND strategist_wallet=$2', [strategyId, wallet]);
    if (!rows[0]) throw new PlatformError('STRATEGY_FORBIDDEN', 403);
    return rows[0];
  }

  async publicStrategies() {
    const { rows } = await this.database.query(`SELECT s.id,s.slug,s.name,s.description,s.risk,s.fee_bps,s.status,s.created_at,st.display_name AS strategist_name,st.wallet_address AS strategist_wallet,n.unit_nav,COALESCE(n.pnl_bps,p.return_bps) AS pnl_bps,COALESCE(n.volatility_bps,p.volatility_bps) AS volatility_bps,n.marked_at FROM strategies s JOIN strategists st ON st.wallet_address=s.strategist_wallet LEFT JOIN LATERAL (SELECT unit_nav,pnl_bps,volatility_bps,marked_at FROM nav_marks WHERE strategy_id=s.id ORDER BY marked_at DESC LIMIT 1) n ON true LEFT JOIN LATERAL (SELECT return_bps,volatility_bps FROM performance_records WHERE strategy_id=s.id ORDER BY period_end DESC LIMIT 1) p ON true WHERE s.status <> 'SUSPENDED' ORDER BY s.created_at DESC`);
    const configs=await this.database.query('SELECT id,policy,policy_version,pending_policy FROM strategies');
    const marks=await this.database.query('SELECT strategy_id,observed_at,metrics FROM strategy_public_metrics');
    return { strategies: rows.map(row=>{const m=marks.rows.find(m=>m.strategy_id===row.id);return {...row,...configs.rows.find(c=>c.id===row.id),performance_source:m?'TEE_LIVE':null,pnl_bps:m?.metrics.pnlBps??null,volatility_bps:m?.metrics.volatilityBps??null,public_metrics:m?.metrics||null,marked_at:m?.observed_at||null};}) };
  }

  async publishMetrics(input) {
    const configured=await this.database.query("SELECT value FROM platform_settings WHERE key='tee_operator_address'");
    const message=`MMQ_PUBLIC_METRICS_V1\n${JSON.stringify(input.payload)}`;
    let signer;try{signer=verifyMessage(message,input.signature);}catch{throw new PlatformError('INVALID_METRICS_SIGNATURE',401);}
    if(!configured.rows[0]||signer.toLowerCase()!==configured.rows[0].value.toLowerCase())throw new PlatformError('INVALID_METRICS_SIGNER',401);
    const {observedAt,strategies}=input.payload||{};
    if(!Number.isSafeInteger(observedAt)||Math.abs(Date.now()-observedAt)>300000||!Array.isArray(strategies)||strategies.length>1000)throw new PlatformError('INVALID_METRICS');
    const allowed=['strategyId','source','pnlBps','volatilityBps','maxDrawdownBps','managerActive','managerPending','managerWithdrawing','status','policyVersion'];
    for(const m of strategies){
      if(Object.keys(m).some(k=>!allowed.includes(k))||m.source!=='TEE_LIVE'||!Number.isSafeInteger(m.pnlBps)||!(m.volatilityBps===null||Number.isSafeInteger(m.volatilityBps)))throw new PlatformError('INVALID_PUBLIC_METRICS');
      for(const key of ['managerActive','managerPending','managerWithdrawing'])if(!/^\d+$/.test(m[key]||''))throw new PlatformError('INVALID_PUBLIC_METRICS');
    }
    await this.database.transaction(async client=>{for(const {strategyId,...metrics} of strategies){
      await client.query('INSERT INTO strategy_public_metrics(strategy_id,observed_at,metrics) VALUES($1,$2,$3) ON CONFLICT(strategy_id) DO UPDATE SET observed_at=excluded.observed_at,metrics=excluded.metrics WHERE strategy_public_metrics.observed_at<excluded.observed_at',[strategyId,new Date(observedAt).toISOString(),JSON.stringify(metrics)]);
      await client.query('INSERT INTO strategy_public_metric_history(strategy_id,observed_at,metrics) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[strategyId,new Date(observedAt).toISOString(),JSON.stringify(metrics)]);
      if(Number.isSafeInteger(metrics.policyVersion))await client.query("UPDATE strategies SET policy=pending_policy->'policy',fee_bps=(pending_policy->>'feeBps')::integer,policy_version=$2,pending_policy=NULL WHERE id=$1 AND (pending_policy->>'version')::integer=$2 AND (pending_policy->>'effectiveAfter')::bigint <= $3",[strategyId,metrics.policyVersion,Math.floor(observedAt/1000)]);
    }});return {accepted:true};
  }

  async metricHistory(strategyId, query = {}) {
    const period = query.period || 'all';
    const seconds = { '1d':86400, '7d':604800, '30d':2592000, all:null };
    if (!(period in seconds)) throw new PlatformError('INVALID_HISTORY_PERIOD');
    const from = seconds[period] ? new Date(Date.now()-seconds[period]*1000).toISOString() : null;
    const bucket = period==='1d'?300:period==='7d'?3600:period==='30d'?14400:86400;
    const {rows} = await this.database.query(`SELECT observed_at,metrics FROM (
      SELECT DISTINCT ON (floor(extract(epoch FROM observed_at)/$3)) observed_at,metrics
      FROM strategy_public_metric_history WHERE strategy_id=$1 AND ($2::timestamptz IS NULL OR observed_at >= $2)
      ORDER BY floor(extract(epoch FROM observed_at)/$3),observed_at DESC
    ) sampled ORDER BY observed_at DESC LIMIT 1000`, [strategyId,from,bucket]);
    return {period, history:rows.reverse()};
  }

  async strategyDetail(slug, query = {}) {
    const normalized = text(slug, 'INVALID_STRATEGY_SLUG', 3, 48).toLowerCase();
    const { rows } = await this.database.query(`SELECT s.id,s.slug,s.name,s.description,s.risk,s.fee_bps,s.status,s.created_at,st.display_name AS strategist_name,st.wallet_address AS strategist_wallet FROM strategies s JOIN strategists st ON st.wallet_address=s.strategist_wallet WHERE s.slug=$1`, [normalized]);
    if (!rows[0]) throw new PlatformError('STRATEGY_NOT_FOUND', 404);
    const config=await this.database.query('SELECT policy,policy_version,pending_policy FROM strategies WHERE id=$1',[rows[0].id]);
    const strategy = {...rows[0],...config.rows[0]};
    const [performance, nav] = await Promise.all([
      this.database.query('SELECT period_start,period_end,return_bps,volatility_bps,source,evidence_uri FROM performance_records WHERE strategy_id=$1 ORDER BY period_end DESC', [strategy.id]),
      this.database.query('SELECT unit_nav,pnl_bps,volatility_bps,marked_at FROM nav_marks WHERE strategy_id=$1 ORDER BY marked_at DESC LIMIT 1', [strategy.id])
    ]);
    const history=await this.metricHistory(strategy.id,query);
    return { strategy, performance: performance.rows, latestNav: nav.rows[0] || null,liveHistory:history.history,historyPeriod:history.period };
  }

  async me(authorization) {
    const wallet = await this.session(authorization);
    const {rows} = await this.database.query('SELECT display_name,bio,status,created_at FROM strategists WHERE wallet_address=$1', [wallet]);
    return { wallet, strategist:rows[0]||null };
  }

  async publicConfig() {
    const { rows } = await this.database.query("SELECT key,value FROM platform_settings WHERE key IN ('omnibus_vault_address','cash_token_address')");
    const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
    return {
      chainId: 10143,
      vaultAddress: settings.omnibus_vault_address || null,
      cashTokenAddress: settings.cash_token_address || null,
      teeEndpoint: this.teeEndpoint || null,
      teeEncryptionPublicKey: this.teeEncryptionPublicKey || null
    };
  }
}
