-- Fixture test for the recursive view v_absence_runs and the RECURSIVE 1 query in db/b_queries.sql.
-- Builds one hostel with known absences, compares the runs with the expected ones, and rolls back.
-- Run: docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < db/b_queries_tests.sql
BEGIN;
CREATE TEMP TABLE t (name TEXT, ok BOOLEAN, detail TEXT);
CREATE FUNCTION pg_temp.chk(p_name TEXT, p_actual JSONB, p_expected JSONB) RETURNS VOID LANGUAGE sql AS
$$ INSERT INTO t VALUES (p_name, p_actual = p_expected, CASE WHEN p_actual = p_expected THEN 'as expected' ELSE 'got ' || p_actual::text || ' expected ' || p_expected::text END) $$;

INSERT INTO hostels (hostel_id, name) VALUES (95, 'Recursive Fixture Hostel');
INSERT INTO users (user_id, email, password_hash, role) VALUES
  (9501, 'rq.a@rq.test', 'x', 'student'), (9502, 'rq.b@rq.test', 'x', 'student'), (9503, 'rq.c@rq.test', 'x', 'student');
INSERT INTO students (student_id, user_id, roll_no, name, hostel_id) VALUES
  (9501, 9501, 'RQ1', 'Run A', 95), (9502, 9502, 'RQ2', 'Run B', 95), (9503, 9503, 'RQ3', 'Run C', 95);

-- ten daily roll calls, 2026-02-01 .. 2026-02-10 (day 6 is missing: no roll call that day)
INSERT INTO attendance_sessions (session_id, hostel_id, session_date, start_time, end_time)
SELECT 9500 + n, 95, DATE '2026-02-01' + (n - 1), '20:30', '21:00' FROM generate_series(1, 10) AS n WHERE n <> 6;

-- Run A: absent on days 1,2,3 (run of 3), present on day 4, absent on 5 (run of 1), absent on 7 and 8 (run of 2: day 6 has no roll call), absent on 10 (run of 1)
INSERT INTO attendance (session_id, student_id, status, marked_at)
SELECT 9500 + n, 9501, CASE WHEN n IN (1,2,3,5,7,8,10) THEN 'absent' ELSE 'present' END,
       CASE WHEN n IN (1,2,3,5,7,8,10) THEN NULL ELSE (DATE '2026-02-01' + (n - 1))::timestamp + TIME '20:40' END
FROM generate_series(1, 10) AS n WHERE n <> 6;
-- Run B: absent at every roll call; day 6 has no roll call, so the runs are days 1-5 and days 7-10
INSERT INTO attendance (session_id, student_id, status, marked_at)
SELECT 9500 + n, 9502, 'absent', NULL FROM generate_series(1, 10) AS n WHERE n <> 6;
-- Run C: never absent
INSERT INTO attendance (session_id, student_id, status, marked_at)
SELECT 9500 + n, 9503, 'present', (DATE '2026-02-01' + (n - 1))::timestamp + TIME '20:40' FROM generate_series(1, 10) AS n WHERE n <> 6;

SELECT pg_temp.chk('Run A: every maximal run, with its length',
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('s', run_start, 'e', run_end, 'n', days) ORDER BY run_start), '[]')
   FROM v_absence_runs WHERE student_id = 9501),
  '[{"s":"2026-02-01","e":"2026-02-03","n":3},{"s":"2026-02-05","e":"2026-02-05","n":1},{"s":"2026-02-07","e":"2026-02-08","n":2},{"s":"2026-02-10","e":"2026-02-10","n":1}]');
SELECT pg_temp.chk('Run B: a day with no roll call breaks the run (days 1-5, then 7-10)',
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('s', run_start, 'n', days) ORDER BY run_start), '[]')
   FROM v_absence_runs WHERE student_id = 9502),
  '[{"s":"2026-02-01","n":5},{"s":"2026-02-07","n":4}]');
SELECT pg_temp.chk('Run C: a student who is never absent has no run',
  (SELECT count(*) FROM v_absence_runs WHERE student_id = 9503)::TEXT::JSONB, '0');
SELECT pg_temp.chk('Longest run per student, as the RECURSIVE 1 query computes it',
  (SELECT jsonb_agg(jsonb_build_object('roll', roll_no, 'longest', longest, 'since', since) ORDER BY roll_no)
   FROM (SELECT s.roll_no, max(r.days) AS longest, (array_agg(r.run_start ORDER BY r.days DESC, r.run_start))[1] AS since
         FROM v_absence_runs r JOIN students s ON s.student_id = r.student_id
         WHERE s.hostel_id = 95 GROUP BY s.roll_no) q),
  '[{"roll":"RQ1","longest":3,"since":"2026-02-01"},{"roll":"RQ2","longest":5,"since":"2026-02-01"}]');
SELECT pg_temp.chk('The recursion terminates and counts each run once (rows per student)',
  (SELECT jsonb_object_agg(student_id::TEXT, n) FROM (SELECT student_id, count(*) AS n FROM v_absence_runs WHERE student_id IN (9501, 9502, 9503) GROUP BY student_id) q),
  '{"9501":4,"9502":2}');
SELECT pg_temp.chk('The view is read-only and does not change the data',
  (SELECT count(*) FROM attendance WHERE student_id BETWEEN 9501 AND 9503)::TEXT::JSONB, '27');

SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, CASE WHEN ok THEN '' ELSE detail END AS detail FROM t ORDER BY ctid;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total FROM t;
ROLLBACK;
