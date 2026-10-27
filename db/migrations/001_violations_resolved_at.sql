-- =====================================================================
-- Migration 001: violations.resolved_at
-- Idempotent: safe to run on a database that already has the column.
-- db/schema.sql contains the same column and constraint for fresh loads.
--
-- BACKFILL (an approximation, stated plainly): violations resolved before this
-- column existed have no recorded resolution time, so resolved_at is set to
-- raised_at for them. Only violations resolved from now on have a real time.
-- =====================================================================
BEGIN;

ALTER TABLE violations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;

UPDATE violations SET resolved_at = raised_at
WHERE status = 'resolved' AND resolved_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'violations_resolved_at_consistent') THEN
        ALTER TABLE violations
            ADD CONSTRAINT violations_resolved_at_consistent
            CHECK ((status = 'resolved') = (resolved_at IS NOT NULL));
    END IF;
END $$;

COMMIT;
