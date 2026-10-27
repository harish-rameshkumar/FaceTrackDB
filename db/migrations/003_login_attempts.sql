-- =====================================================================
-- Migration 003: login rate limiting that lives in the database
-- Idempotent. db/schema.sql has the table and db/procedures.sql the two
-- functions; they are repeated here so an existing database can be upgraded
-- without reloading anything (reloading schema.sql wipes face_profiles).
--
-- Rules (change the numbers in login_retry_after to change the policy):
--   * 5 failed attempts for one email within 15 minutes lock that email until
--     the 5th most recent failure is older than 15 minutes; a successful login
--     clears the email's counter;
--   * 20 failed attempts from one IP address within 15 minutes lock that address.
-- Unknown emails are recorded and locked exactly like known ones, so the
-- response never reveals which emails exist.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_id    BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    ip            VARCHAR(64)  NOT NULL,
    succeeded     BOOLEAN      NOT NULL,
    attempted_at  TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts (email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time    ON login_attempts (ip, attempted_at DESC);

-- Seconds the caller must still wait (0 = login may be tried).
CREATE OR REPLACE FUNCTION login_retry_after(p_email TEXT, p_ip TEXT)
RETURNS INT
LANGUAGE sql STABLE AS $$
    SELECT GREATEST(
        COALESCE((
            SELECT CASE WHEN count(*) >= 5
                        THEN ceil(extract(epoch FROM (min(attempted_at) + interval '15 minutes' - now())))::INT END
            FROM (
                SELECT attempted_at FROM login_attempts
                WHERE email = lower(p_email) AND NOT succeeded
                  AND attempted_at > now() - interval '15 minutes'
                  AND attempted_at > COALESCE((SELECT max(s.attempted_at) FROM login_attempts s
                                               WHERE s.email = lower(p_email) AND s.succeeded), '-infinity')
                ORDER BY attempted_at DESC
                LIMIT 5
            ) recent
        ), 0),
        COALESCE((
            SELECT CASE WHEN count(*) >= 20
                        THEN ceil(extract(epoch FROM (min(attempted_at) + interval '15 minutes' - now())))::INT END
            FROM (
                SELECT attempted_at FROM login_attempts
                WHERE ip = p_ip AND NOT succeeded
                  AND attempted_at > now() - interval '15 minutes'
                ORDER BY attempted_at DESC
                LIMIT 20
            ) recent_ip
        ), 0),
        0);
$$;

-- Records one evaluated attempt, and now and then deletes rows older than a day.
CREATE OR REPLACE FUNCTION login_record(p_email TEXT, p_ip TEXT, p_succeeded BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO login_attempts (email, ip, succeeded)
    VALUES (left(lower(p_email), 255), left(p_ip, 64), p_succeeded);
    IF random() < 0.02 THEN
        DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day';
    END IF;
END $$;

COMMIT;
