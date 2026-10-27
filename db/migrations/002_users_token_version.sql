-- =====================================================================
-- Migration 002: users.token_version (session revocation)
-- Idempotent. db/schema.sql contains the same column for fresh loads.
--
-- Every login token carries the user's token_version. The app checks on every
-- request that the user still exists and that the version still matches, so
-- adding 1 to token_version signs that user out everywhere (password change,
-- or the admin action "Sign out this user everywhere").
-- =====================================================================
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

COMMIT;
