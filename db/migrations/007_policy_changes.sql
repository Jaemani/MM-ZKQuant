BEGIN;
ALTER TABLE strategies ADD COLUMN pending_policy JSONB;
CREATE TABLE strategy_policy_history (
 strategy_id UUID NOT NULL REFERENCES strategies(id),
 version INTEGER NOT NULL,
 policy JSONB NOT NULL,
 fee_bps INTEGER NOT NULL,
 announced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 effective_after TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(strategy_id,version)
);
COMMIT;
