-- =====================================================================
-- FaceTrackDB: transaction demo (Phase 3)
-- Shows that related writes succeed or fail together.
-- Every scenario ends with ROLLBACK, so the database is left unchanged
-- and this file can be run again and again. To keep the rows of
-- scenario A, change its ROLLBACK to COMMIT.
-- Run after load order: settings, schema, seed, triggers, procedures:
--   Get-Content db\transactions_demo.sql | docker compose exec -T postgres psql -U facetrack -d facetrackdb
-- (Do not add ON_ERROR_STOP: scenario B is meant to hit an error.)
-- =====================================================================

\echo
\echo '=== A. A late-night exit: face event + gate log + violation in ONE transaction ==='
BEGIN;

INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time)
VALUES (2, 1, 0.931, 'matched', '2026-10-22 23:05:00')
RETURNING event_id AS ev \gset

CALL record_entry_exit(1, 1, :ev, 'OUT', NULL, NULL);

\echo 'Inside the transaction: the log row and its violation exist together'
SELECT l.log_id, l.direction, l.event_time, v.type AS violation
FROM entry_exit_log l
LEFT JOIN violations v USING (log_id)
WHERE l.student_id = 1;

ROLLBACK;

\echo 'After ROLLBACK: nothing was kept'
SELECT count(*) AS gate_logs_for_arun FROM entry_exit_log WHERE student_id = 1;


\echo
\echo '=== B. A duplicate scan fails: the face event saved earlier in the same transaction is undone too ==='
SELECT count(*) AS face_events_before FROM face_events;

BEGIN;

INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time)
VALUES (1, 1, 0.900, 'matched', '2026-10-20 22:10:00')
RETURNING event_id AS ev2 \gset

-- Arun is already present in session 1, so this raises error FT001
CALL mark_attendance(1, 1, :ev2, NULL);

ROLLBACK;

SELECT count(*) AS face_events_after FROM face_events;


\echo
\echo '=== C. Closing a roll call: absences + violations written together ==='
BEGIN;

INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time)
VALUES (2, '2026-10-21', '20:00', '20:30')
RETURNING session_id AS sid \gset

CALL close_attendance_session(:sid, NULL, NULL);

SELECT s.name, a.status, v.type AS violation
FROM attendance a
JOIN students s USING (student_id)
LEFT JOIN violations v
       ON v.session_id = a.session_id AND v.student_id = a.student_id
WHERE a.session_id = :sid
ORDER BY s.name;

ROLLBACK;
