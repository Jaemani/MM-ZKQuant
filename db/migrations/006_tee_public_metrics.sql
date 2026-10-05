BEGIN;
CREATE TABLE strategy_public_metrics (
 strategy_id UUID PRIMARY KEY REFERENCES strategies(id),
 observed_at TIMESTAMPTZ NOT NULL,
 metrics JSONB NOT NULL
);
CREATE TABLE strategy_public_metric_history (
 strategy_id UUID NOT NULL REFERENCES strategies(id),
 observed_at TIMESTAMPTZ NOT NULL,
 metrics JSONB NOT NULL,
 PRIMARY KEY(strategy_id,observed_at)
);
INSERT INTO platform_settings(key,value) VALUES('tee_operator_address','0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7') ON CONFLICT(key) DO NOTHING;
COMMIT;
