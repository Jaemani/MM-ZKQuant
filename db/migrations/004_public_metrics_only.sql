BEGIN;

-- Public catalog metrics must not reveal strategy AUM or bind a strategy to an
-- execution position. Those values live only in the sealed TEE ledger.
ALTER TABLE performance_records DROP COLUMN nav_start;
ALTER TABLE performance_records DROP COLUMN nav_end;
ALTER TABLE nav_marks DROP COLUMN source_block;
DROP TABLE executions;

COMMIT;
