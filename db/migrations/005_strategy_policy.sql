BEGIN;
ALTER TABLE strategies ADD COLUMN policy JSONB NOT NULL DEFAULT '{"maxLeverageBps":20000,"stopLossBps":1500,"maxDrawdownBps":2000,"settlementPeriodSeconds":86400,"settlementOffsetSeconds":0,"withdrawalCutoffSeconds":3600,"orderTtlSeconds":120,"slippageBps":50}'::jsonb;
ALTER TABLE strategies ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1;
COMMIT;
