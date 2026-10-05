BEGIN;

CREATE TABLE users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  address TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (address ~ '^0x[0-9A-Fa-f]{40}$')
);

CREATE TABLE auth_challenges (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (address ~ '^0x[0-9A-Fa-f]{40}$')
);

CREATE TABLE strategists (
  wallet_address TEXT PRIMARY KEY REFERENCES wallets(address),
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(display_name) BETWEEN 2 AND 60),
  CHECK (char_length(bio) BETWEEN 2 AND 500)
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY,
  strategist_wallet TEXT NOT NULL REFERENCES strategists(wallet_address),
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (key_prefix ~ '^mmq_test_')
);

CREATE TABLE strategies (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  strategist_wallet TEXT NOT NULL REFERENCES strategists(wallet_address),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),
  fee_bps INTEGER NOT NULL CHECK (fee_bps BETWEEN 0 AND 2000),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'WAITING_FOR_VAULT', 'FUNDING', 'LIVE', 'CLOSING', 'SETTLED', 'SUSPENDED')),
  vault_address TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slug ~ '^[a-z][a-z0-9-]{2,47}$'),
  CHECK (char_length(name) BETWEEN 2 AND 100),
  CHECK (char_length(description) BETWEEN 2 AND 500)
);

CREATE TABLE strategy_versions (
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  version INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_id, version)
);

CREATE TABLE performance_records (
  id UUID PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  nav_start NUMERIC(78,0) NOT NULL CHECK (nav_start > 0),
  nav_end NUMERIC(78,0) NOT NULL CHECK (nav_end >= 0),
  return_bps INTEGER NOT NULL,
  source TEXT NOT NULL,
  evidence_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE TABLE epochs (
  id UUID PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  sequence INTEGER NOT NULL,
  deposit_cutoff_at TIMESTAMPTZ NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED', 'FUNDING', 'LIVE', 'CLOSING', 'SETTLED', 'CANCELLED')),
  opening_nav NUMERIC(78,0),
  closing_nav NUMERIC(78,0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, sequence),
  CHECK (deposit_cutoff_at <= start_at AND start_at < end_at)
);

CREATE TABLE target_submissions (
  id UUID PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  epoch_id UUID NOT NULL REFERENCES epochs(id),
  ciphertext TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  tee_receipt TEXT NOT NULL UNIQUE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, epoch_id)
);

CREATE TABLE subscriptions (
  tx_hash TEXT NOT NULL,
  log_index BIGINT NOT NULL,
  investor_wallet TEXT NOT NULL REFERENCES wallets(address),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  epoch_id UUID REFERENCES epochs(id),
  amount NUMERIC(78,0) NOT NULL CHECK (amount > 0),
  shares NUMERIC(78,0) NOT NULL CHECK (shares > 0),
  block_number BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'REORGED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE redemptions (
  tx_hash TEXT NOT NULL,
  log_index BIGINT NOT NULL,
  investor_wallet TEXT NOT NULL REFERENCES wallets(address),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  epoch_id UUID REFERENCES epochs(id),
  shares NUMERIC(78,0) NOT NULL CHECK (shares > 0),
  amount NUMERIC(78,0),
  block_number BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'PAID', 'REORGED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE nav_marks (
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  marked_at TIMESTAMPTZ NOT NULL,
  estimated_nav NUMERIC(78,0) NOT NULL CHECK (estimated_nav >= 0),
  unit_nav NUMERIC(78,0) NOT NULL CHECK (unit_nav >= 0),
  pnl_bps INTEGER NOT NULL,
  source_block BIGINT NOT NULL,
  PRIMARY KEY (strategy_id, marked_at)
);

CREATE TABLE executions (
  id UUID PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  epoch_id UUID REFERENCES epochs(id),
  intent_hash TEXT NOT NULL UNIQUE,
  tx_hash TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SUBMITTED', 'CONFIRMED', 'REVERTED')),
  position_after TEXT,
  proof_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chain_cursors (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  last_block BIGINT NOT NULL,
  last_log_index BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address)
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX performance_records_strategy_period ON performance_records(strategy_id, period_end DESC);
CREATE INDEX nav_marks_strategy_time ON nav_marks(strategy_id, marked_at DESC);
CREATE INDEX subscriptions_investor_strategy ON subscriptions(investor_wallet, strategy_id);
CREATE INDEX redemptions_investor_strategy ON redemptions(investor_wallet, strategy_id);
CREATE INDEX executions_strategy_epoch ON executions(strategy_id, epoch_id, created_at DESC);

COMMIT;
