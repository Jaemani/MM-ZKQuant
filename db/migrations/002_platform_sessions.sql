BEGIN;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES wallets(address),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_wallet_active ON sessions(wallet_address, expires_at) WHERE revoked_at IS NULL;

COMMIT;
