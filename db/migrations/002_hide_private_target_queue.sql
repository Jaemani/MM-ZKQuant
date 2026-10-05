-- The sealed TEE is the only queue of unexecuted strategy targets. Remove the
-- former Postgres queue so database operators cannot discover pending work.
DELETE FROM executions WHERE status IN ('QUEUED', 'SUBMITTED');
DROP TABLE IF EXISTS target_submissions;
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_status_check;
ALTER TABLE executions ADD CONSTRAINT executions_status_check CHECK (status IN ('CONFIRMED', 'REVERTED'));
