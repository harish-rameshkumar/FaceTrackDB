-- =====================================================================
-- FaceTrackDB: demo passwords (development and demo only)
-- Run after seed.sql. Gives EVERY seeded account the same password so
-- you can log in as each role while building and demonstrating.
--
--   Password for all accounts:  FaceTrack@123
--
-- Passwords are stored as bcrypt hashes (never plain text). pgcrypto
-- creates them, and the app's login (bcryptjs) verifies them.
-- Never use a shared password like this outside development.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE users
SET password_hash = crypt('FaceTrack@123', gen_salt('bf', 10));
