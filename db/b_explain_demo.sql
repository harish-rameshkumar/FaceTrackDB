-- =====================================================================
-- FaceTrackDB: EXPLAIN before/after demo (Person B)
-- The seed data is far too small for an index to matter, so this file
-- bulk-loads synthetic rows INSIDE a transaction and ends with ROLLBACK:
-- the database is left exactly as it was. Safe to re-run.
-- Needs a superuser (the Docker default) for session_replication_role,
-- which skips the gate-log triggers during the bulk load only.
-- Run: ./db/load_b.sh --demo     (needs b_search.sql loaded first)
-- =====================================================================

BEGIN;
SET LOCAL session_replication_role = replica;   -- bulk load only; rolled back with the transaction

-- 300,000 gate events spread over 6 students (log_id values are unique)
INSERT INTO entry_exit_log (student_id, gate_id, direction, event_time)
SELECT 1 + (g % 6),
       CASE WHEN g % 6 < 3 THEN 1 ELSE 3 END,
       CASE WHEN g % 2 = 0 THEN 'OUT' ELSE 'IN' END,
       timestamp '2025-01-01 00:00:00' + g * interval '1 minute'
FROM generate_series(1, 300000) AS g;

-- 100,000 leave requests with varied reasons (all pending, so no overlap rule applies)
INSERT INTO leave_requests (student_id, start_date, end_date, reason)
SELECT 1 + (g % 6),
       date '2027-01-01' + (g % 300),
       date '2027-01-01' + (g % 300),
       (ARRAY['Family function','Medical appointment','Cousin wedding','Exam preparation at home',
              'Festival travel','Sports meet','Dental checkup','Internship interview'])[1 + (g % 8)]
       || ' ' || g
FROM generate_series(1, 100000) AS g;
-- one rare word so the search is selective
UPDATE leave_requests SET reason = 'Passport renewal appointment' WHERE leave_id =
    (SELECT max(leave_id) FROM leave_requests);

ANALYZE entry_exit_log;
ANALYZE leave_requests;
SET LOCAL max_parallel_workers_per_gather = 0;   -- keep plans easy to compare

\echo
\echo '######## DEMO 1: latest gate events of one student (B-tree on student_id, event_time DESC)'
\echo '--- BEFORE: index dropped'
DROP INDEX idx_log_student_time;
EXPLAIN (ANALYZE, BUFFERS)
SELECT log_id, direction, event_time
FROM entry_exit_log WHERE student_id = 3
ORDER BY event_time DESC LIMIT 10;

\echo '--- AFTER: index created'
CREATE INDEX idx_log_student_time ON entry_exit_log (student_id, event_time DESC);
EXPLAIN (ANALYZE, BUFFERS)
SELECT log_id, direction, event_time
FROM entry_exit_log WHERE student_id = 3
ORDER BY event_time DESC LIMIT 10;

\echo
\echo '######## DEMO 2: full-text search for a rare word in leave reasons (GIN)'
\echo '--- BEFORE: GIN index dropped'
DROP INDEX idx_leave_reason_fts;
EXPLAIN (ANALYZE, BUFFERS)
SELECT leave_id, reason FROM leave_requests
WHERE reason_tsv @@ to_tsquery('english', 'passport');

\echo '--- AFTER: GIN index created'
CREATE INDEX idx_leave_reason_fts ON leave_requests USING gin (reason_tsv);
EXPLAIN (ANALYZE, BUFFERS)
SELECT leave_id, reason FROM leave_requests
WHERE reason_tsv @@ to_tsquery('english', 'passport');

ROLLBACK;

\echo
\echo 'After ROLLBACK the tables are back to their seeded size:'
SELECT (SELECT count(*) FROM entry_exit_log) AS gate_log_rows,
       (SELECT count(*) FROM leave_requests) AS leave_rows;
SELECT indexname FROM pg_indexes
WHERE indexname IN ('idx_log_student_time', 'idx_leave_reason_fts') ORDER BY 1;
