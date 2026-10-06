BEGIN;
ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,32}$');
CREATE UNIQUE INDEX wallets_address_case_insensitive ON wallets(lower(address));
CREATE UNIQUE INDEX wallets_one_per_account ON wallets(user_id);
ALTER TABLE sessions ADD COLUMN user_id UUID REFERENCES users(id);
UPDATE sessions s SET user_id=w.user_id FROM wallets w WHERE w.address=s.wallet_address;
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN wallet_address DROP NOT NULL;
CREATE INDEX sessions_user_active ON sessions(user_id,expires_at) WHERE revoked_at IS NULL;
ALTER TABLE strategists ADD COLUMN user_id UUID REFERENCES users(id);
UPDATE strategists st SET user_id=w.user_id FROM wallets w WHERE w.address=st.wallet_address;
ALTER TABLE strategists ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE strategies ADD COLUMN user_id UUID REFERENCES users(id);
UPDATE strategies s SET user_id=st.user_id FROM strategists st WHERE st.wallet_address=s.strategist_wallet;
ALTER TABLE strategies ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE api_keys ADD COLUMN user_id UUID REFERENCES users(id);
UPDATE api_keys k SET user_id=st.user_id FROM strategists st WHERE st.wallet_address=k.strategist_wallet;
ALTER TABLE api_keys ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE strategies DROP CONSTRAINT strategies_strategist_wallet_fkey;
ALTER TABLE api_keys DROP CONSTRAINT api_keys_strategist_wallet_fkey;
ALTER TABLE strategists DROP CONSTRAINT strategists_pkey;
ALTER TABLE strategists ADD PRIMARY KEY(user_id);
ALTER TABLE strategists ADD UNIQUE(wallet_address);
ALTER TABLE strategists ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE strategies ALTER COLUMN strategist_wallet DROP NOT NULL;
ALTER TABLE api_keys ALTER COLUMN strategist_wallet DROP NOT NULL;
ALTER TABLE strategies ADD FOREIGN KEY(strategist_wallet) REFERENCES strategists(wallet_address);
ALTER TABLE api_keys ADD FOREIGN KEY(strategist_wallet) REFERENCES strategists(wallet_address);
ALTER TABLE strategies ADD FOREIGN KEY(user_id) REFERENCES strategists(user_id);
ALTER TABLE api_keys ADD FOREIGN KEY(user_id) REFERENCES strategists(user_id);
CREATE INDEX strategies_user_created ON strategies(user_id,created_at DESC);
CREATE INDEX api_keys_user_created ON api_keys(user_id,created_at DESC);
-- Keep wallet-based clients working during the coordinated rollout.
CREATE FUNCTION platform_legacy_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    IF TG_TABLE_NAME IN ('sessions','strategists') THEN
      SELECT user_id INTO NEW.user_id FROM wallets WHERE address=NEW.wallet_address;
    ELSE
      SELECT user_id INTO NEW.user_id FROM strategists WHERE wallet_address=NEW.strategist_wallet;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_legacy_owner BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION platform_legacy_owner();
CREATE TRIGGER strategists_legacy_owner BEFORE INSERT ON strategists FOR EACH ROW EXECUTE FUNCTION platform_legacy_owner();
CREATE TRIGGER strategies_legacy_owner BEFORE INSERT ON strategies FOR EACH ROW EXECUTE FUNCTION platform_legacy_owner();
CREATE TRIGGER api_keys_legacy_owner BEFORE INSERT ON api_keys FOR EACH ROW EXECUTE FUNCTION platform_legacy_owner();
COMMIT;
