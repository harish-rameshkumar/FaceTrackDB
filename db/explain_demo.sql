-- =====================================================================
-- FaceTrackDB: index comparison with EXPLAIN ANALYZE (Phase 5)
--
-- Shows the same query WITHOUT and WITH three of the real indexes from
-- schema.sql, on a large generated data set (300,000 gate events, 40,000
-- roll calls, 120,000 attendance rows and 120,000 violations).
--
-- Run on a freshly loaded database (db\load_all.ps1):
--   Get-Content db\explain_demo.sql | docker compose exec -T postgres psql -U facetrack -d facetrackdb
--
-- Everything, including the generated data and the dropped indexes, happens
-- inside ONE transaction that is rolled back at the end, so the real
-- database is left exactly as it was. Timings differ from machine to
-- machine; compare the plan type and the "Execution Time" before vs after.
-- =====================================================================

BEGIN;

-- Bulk loading: skip our own triggers (they are tested separately);
-- the keys and foreign keys are still checked.
ALTER TABLE entry_exit_log DISABLE TRIGGER USER;
ALTER TABLE attendance     DISABLE TRIGGER USER;
ALTER TABLE violations     DISABLE TRIGGER USER;

\o /dev/null

INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time)
SELECT 1,
       DATE '2026-11-01' + (i / 24),
       make_time(i % 24, 0, 0),
       make_time(i % 24, 30, 0)
FROM generate_series(0, 39999) AS i;

INSERT INTO attendance (session_id, student_id, status, marked_at)
SELECT sess.session_id, s.student_id, 'present',
       sess.session_date + sess.start_time + INTERVAL '5 minutes'
FROM attendance_sessions sess
CROSS JOIN (VALUES (1), (2), (3)) AS s(student_id)
WHERE sess.session_date >= DATE '2026-11-01';

INSERT INTO entry_exit_log (student_id, gate_id, direction, event_time)
SELECT 1 + (i % 6),
       CASE WHEN 1 + (i % 6) <= 3 THEN 1 ELSE 3 END,
       CASE WHEN (i / 6) % 2 = 0 THEN 'OUT' ELSE 'IN' END,
       TIMESTAMP '2025-01-01' + i * INTERVAL '2 minutes'
FROM generate_series(1, 300000) AS i;

-- 1 violation in 100 is still open; the rest are resolved by the warden
INSERT INTO violations (student_id, session_id, type, details, raised_at, status, resolved_by)
SELECT a.student_id, a.session_id, 'missed_attendance', 'generated',
       sess.session_date + sess.end_time,
       CASE WHEN a.session_id % 100 = 0 THEN 'open' ELSE 'resolved' END,
       CASE WHEN a.session_id % 100 = 0 THEN NULL ELSE 1 END
FROM attendance a
JOIN attendance_sessions sess USING (session_id)
WHERE sess.session_date >= DATE '2026-11-01';

ANALYZE entry_exit_log;
ANALYZE attendance;
ANALYZE violations;

\o

SELECT (SELECT count(*) FROM entry_exit_log) AS gate_events,
       (SELECT count(*) FROM attendance)      AS attendance_rows,
       (SELECT count(*) FROM violations)      AS violations,
       (SELECT count(*) FROM violations WHERE status = 'open') AS open_violations;

-- =====================================================================
-- 1. idx_log_student_time: "the latest gate events of one student"
-- =====================================================================
\echo
\echo '########## 1. Last 10 gate events of student 3'
\echo '--- BEFORE (index dropped)'
DROP INDEX idx_log_student_time;
EXPLAIN (ANALYZE, COSTS OFF)
SELECT * FROM entry_exit_log WHERE student_id = 3 ORDER BY event_time DESC LIMIT 10;

\echo '--- AFTER (index created)'
CREATE INDEX idx_log_student_time ON entry_exit_log (student_id, event_time DESC);
ANALYZE entry_exit_log;
EXPLAIN (ANALYZE, COSTS OFF)
SELECT * FROM entry_exit_log WHERE student_id = 3 ORDER BY event_time DESC LIMIT 10;

-- =====================================================================
-- 2. idx_log_gate_time: "traffic at one gate in one week"
-- =====================================================================
\echo
\echo '########## 2. Gate 1 traffic for one week'
\echo '--- BEFORE (index dropped)'
DROP INDEX idx_log_gate_time;
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM entry_exit_log
WHERE gate_id = 1 AND event_time >= '2025-03-01' AND event_time < '2025-03-08';

\echo '--- AFTER (index created)'
CREATE INDEX idx_log_gate_time ON entry_exit_log (gate_id, event_time DESC);
ANALYZE entry_exit_log;
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM entry_exit_log
WHERE gate_id = 1 AND event_time >= '2025-03-01' AND event_time < '2025-03-08';

-- =====================================================================
-- 3. idx_violations_open (partial index): "the warden's open queue"
-- =====================================================================
\echo
\echo '########## 3. Oldest 20 open missed-attendance violations'
\echo '--- BEFORE (index dropped)'
DROP INDEX idx_violations_open;
EXPLAIN (ANALYZE, COSTS OFF)
SELECT violation_id, student_id, raised_at FROM violations
WHERE status = 'open' AND type = 'missed_attendance'
ORDER BY raised_at LIMIT 20;

\echo '--- AFTER (partial index created, it only holds the open rows)'
CREATE INDEX idx_violations_open ON violations (type, raised_at) WHERE status = 'open';
ANALYZE violations;
EXPLAIN (ANALYZE, COSTS OFF)
SELECT violation_id, student_id, raised_at FROM violations
WHERE status = 'open' AND type = 'missed_attendance'
ORDER BY raised_at LIMIT 20;

\echo
\echo 'Index sizes (full indexes vs the partial one):'
SELECT indexrelname AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE indexrelname IN ('idx_log_student_time', 'idx_log_gate_time', 'idx_violations_open', 'idx_violations_student')
ORDER BY indexrelname;

ROLLBACK;
\echo
\echo 'Everything above was rolled back: the real data and indexes are unchanged.'
