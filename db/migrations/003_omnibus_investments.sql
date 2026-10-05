BEGIN;

-- The platform has exactly one custody address. Strategy selection, allocations
-- and units are sealed in the TEE; Postgres keeps only public configuration.
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- These tables expose individual strategy holdings to database readers.
-- The live database was verified empty before this migration was authored.
DROP TABLE subscriptions;
DROP TABLE redemptions;
ALTER TABLE executions DROP COLUMN epoch_id;
DROP TABLE epochs;
ALTER TABLE strategies DROP COLUMN vault_address;

-- Public marks contain aggregate performance only. Absolute strategy NAV
-- would reveal private strategy allocations, so it stays in the TEE.
ALTER TABLE nav_marks DROP COLUMN estimated_nav;
ALTER TABLE nav_marks ADD COLUMN volatility_bps INTEGER CHECK (volatility_bps >= 0);
ALTER TABLE performance_records ADD COLUMN volatility_bps INTEGER CHECK (volatility_bps >= 0);

UPDATE strategies SET status='DRAFT', updated_at=now()
WHERE status IN ('WAITING_FOR_VAULT','FUNDING');

COMMIT;
