-- =====================================================================
-- FaceTrackDB: database settings (Phase 3). Safe to re-run.
-- =====================================================================

-- The hostel runs on Indian Standard Time. The Postgres container runs on
-- UTC, so without this every now() default would be 5h30m behind the
-- wall clock and roll-call windows would never match. New connections
-- (including the Next.js app) pick this up automatically.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L',
                   current_database(), 'Asia/Kolkata');
END $$;

-- Needed by the leave-overlap exclusion constraint in triggers.sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
