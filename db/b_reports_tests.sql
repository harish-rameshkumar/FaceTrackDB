-- Fixture test for db/b_reports.sql. Builds a small hostel with known data, calls every
-- report for that hostel only (p_hostel = 91, so the seed data cannot interfere) and
-- compares the rows with the expected ones. Everything is rolled back at the end.
-- Run: docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < db/b_reports_tests.sql
BEGIN;
CREATE TEMP TABLE t (name TEXT, ok BOOLEAN, detail TEXT);
CREATE FUNCTION pg_temp.chk(p_name TEXT, p_actual JSONB, p_expected JSONB) RETURNS VOID LANGUAGE sql AS
$$ INSERT INTO t VALUES (p_name, p_actual = p_expected, CASE WHEN p_actual = p_expected THEN 'as expected' ELSE 'got ' || p_actual::text || ' expected ' || p_expected::text END) $$;

-- ---------------- fixture ----------------
INSERT INTO hostels (hostel_id, name) VALUES (91, 'Fixture Hostel');
INSERT INTO gates (gate_id, hostel_id, name) VALUES (91, 91, 'Fixture Gate');
INSERT INTO cameras (camera_id, gate_id, location, status) VALUES (91, 91, 'fixture', 'active');
INSERT INTO users (user_id, email, password_hash, role) VALUES
  (9101, 'fx.a@fx.test', 'x', 'student'), (9102, 'fx.b@fx.test', 'x', 'student'), (9103, 'fx.c@fx.test', 'x', 'student'),
  (9111, 'fx.parent@fx.test', 'x', 'parent');
INSERT INTO students (student_id, user_id, roll_no, name, hostel_id) VALUES
  (9101, 9101, 'FX1', 'Fixture A', 91), (9102, 9102, 'FX2', 'Fixture B', 91), (9103, 9103, 'FX3', 'Fixture C', 91);
INSERT INTO parents (parent_id, user_id, name) VALUES (9111, 9111, 'Fixture Parent');
INSERT INTO student_parent (student_id, parent_id, relation) VALUES (9101, 9111, 'father'), (9102, 9111, 'father'), (9103, 9111, 'father');

INSERT INTO attendance_sessions (session_id, hostel_id, session_date, start_time, end_time) VALUES
  (9101, 91, '2026-03-10', '20:30', '21:00'), (9102, 91, '2026-04-05', '20:30', '21:00'), (9103, 91, '2026-04-20', '20:30', '21:00');
INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES
  (9101, 9101, 'present', '2026-03-10 20:40'), (9101, 9102, 'present', '2026-03-10 20:41'), (9101, 9103, 'absent', NULL),
  (9102, 9101, 'present', '2026-04-05 20:40'), (9102, 9102, 'absent', NULL), (9102, 9103, 'absent', NULL),
  (9103, 9101, 'present', '2026-04-20 20:40'), (9103, 9102, 'absent', NULL), (9103, 9103, 'absent', NULL);

INSERT INTO entry_exit_log (log_id, student_id, gate_id, direction, event_time) VALUES
  (9101, 9101, 91, 'OUT', '2026-03-10 09:00'), (9102, 9101, 91, 'IN', '2026-03-10 18:00'),
  (9103, 9101, 91, 'OUT', '2026-03-11 10:00'), (9104, 9101, 91, 'IN', '2026-03-11 23:00'),
  (9105, 9101, 91, 'OUT', '2026-03-12 10:00'), (9106, 9101, 91, 'IN', '2026-03-12 23:10'),
  (9107, 9102, 91, 'OUT', '2026-03-10 12:00'), (9108, 9102, 91, 'IN', '2026-03-10 22:45');

INSERT INTO violations (student_id, log_id, session_id, type, details, raised_at, status, resolved_by) VALUES
  (9101, 9104, NULL, 'late_return', 'Returned after the curfew', '2026-03-11 23:00', 'open', NULL),
  (9101, 9106, NULL, 'late_return', 'Returned after the curfew', '2026-03-12 23:10', 'open', NULL),
  (9102, 9108, NULL, 'late_return', 'Returned after the curfew', '2026-03-10 22:45', 'resolved', 1),
  (9103, NULL, 9102, 'missed_attendance', 'Absent at the roll call', '2026-04-05 21:00', 'open', NULL),
  (9103, NULL, 9103, 'missed_attendance', 'Absent at the roll call', '2026-04-20 21:00', 'open', NULL);

INSERT INTO leave_requests (student_id, start_date, end_date, reason, status, decided_by, decided_at) VALUES
  (9101, '2026-04-10', '2026-04-12', 'Family wedding ceremony', 'approved', 9111, '2026-04-08 10:00'),
  (9102, '2026-04-15', '2026-04-15', 'Medical checkup', 'rejected', 9111, '2026-04-14 09:00'),
  (9103, '2026-04-25', '2026-04-27', 'Family function', 'pending', NULL, NULL);

INSERT INTO face_events (event_id, camera_id, student_id, confidence, outcome, event_time) VALUES
  (9101, 91, 9101, 0.900, 'matched',        '2026-03-10 09:00'),
  (9102, 91, 9102, 0.550, 'matched',        '2026-03-11 10:00'),
  (9103, 91, 9102, 0.420, 'low_confidence', '2026-03-12 10:00'),
  (9104, 91, NULL, 0.100, 'no_match',       '2026-03-12 11:00'),
  (9105, 91, NULL, 0.200, 'no_match',       '2026-04-07 11:00');

-- ---------------- expectations ----------------
SELECT pg_temp.chk('attendance_by_hostel_month (CTE)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_attendance_by_hostel_month('2026-03-01', '2026-04-30', 91) r),
  '[{"hostel":"Fixture Hostel","month":"2026-03","marks":3,"present":2,"attendance_pct":66.7},
    {"hostel":"Fixture Hostel","month":"2026-04","marks":6,"present":2,"attendance_pct":33.3}]');
SELECT pg_temp.chk('attendance report respects the date range',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_attendance_by_hostel_month('2026-04-01', '2026-04-30', 91) r),
  '[{"hostel":"Fixture Hostel","month":"2026-04","marks":6,"present":2,"attendance_pct":33.3}]');
SELECT pg_temp.chk('violations_by_type_hostel (GROUP BY / HAVING)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_violations_by_type_hostel('2026-03-01', '2026-04-30', 91) r),
  '[{"hostel":"Fixture Hostel","type":"late_return","violations":3,"still_open":2},
    {"hostel":"Fixture Hostel","type":"missed_attendance","violations":2,"still_open":2}]');
SELECT pg_temp.chk('HAVING hides groups below p_min',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_violations_by_type_hostel('2026-03-01', '2026-04-30', 91, 3) r),
  '[{"hostel":"Fixture Hostel","type":"late_return","violations":3,"still_open":2}]');
SELECT pg_temp.chk('cumulative_violations (window SUM OVER)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_cumulative_violations('2026-03-01', '2026-04-30', 91) r),
  '[{"day":"2026-03-10","hostel":"Fixture Hostel","violations":1,"cumulative":1},
    {"day":"2026-03-11","hostel":"Fixture Hostel","violations":1,"cumulative":2},
    {"day":"2026-03-12","hostel":"Fixture Hostel","violations":1,"cumulative":3},
    {"day":"2026-04-05","hostel":"Fixture Hostel","violations":1,"cumulative":4},
    {"day":"2026-04-20","hostel":"Fixture Hostel","violations":1,"cumulative":5}]');
SELECT pg_temp.chk('late_return_rank (RANK / DENSE_RANK)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_late_return_rank('2026-03-01', '2026-04-30', 91) r),
  '[{"hostel":"Fixture Hostel","student":"Fixture A","roll_no":"FX1","late_returns":2,"rank":1,"dense_rank":1},
    {"hostel":"Fixture Hostel","student":"Fixture B","roll_no":"FX2","late_returns":1,"rank":2,"dense_rank":2}]');
SELECT pg_temp.chk('gate_traffic_by_hour (GROUP BY hour, 48 rows incl. zeros)',
  (SELECT jsonb_build_object('rows', count(*), 'nonzero', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM report_gate_traffic_by_hour('2026-03-01', '2026-04-30', 91) WHERE crossings > 0) x))
   FROM report_gate_traffic_by_hour('2026-03-01', '2026-04-30', 91)),
  '{"rows":48,"nonzero":[{"hour":9,"direction":"OUT","crossings":1},{"hour":10,"direction":"OUT","crossings":2},{"hour":12,"direction":"OUT","crossings":1},
                         {"hour":18,"direction":"IN","crossings":1},{"hour":22,"direction":"IN","crossings":1},{"hour":23,"direction":"IN","crossings":2}]}');
SELECT pg_temp.chk('time_outside (LEAD via v_report_trips)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_time_outside('2026-03-01', '2026-04-30', 91) r),
  '[{"hostel":"Fixture Hostel","weekday":"Tue","weekday_no":2,"trips":2,"avg_hours":9.88},
    {"hostel":"Fixture Hostel","weekday":"Wed","weekday_no":3,"trips":1,"avg_hours":13.00},
    {"hostel":"Fixture Hostel","weekday":"Thu","weekday_no":4,"trips":1,"avg_hours":13.17}]');
SELECT pg_temp.chk('leave_summary (FILTER, percentile_cont)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_leave_summary('2026-04-01', '2026-04-30', 91) r),
  '[{"hostel":"Fixture Hostel","status":"approved","requests":1,"median_days":3.0,"median_lead_days":2.0},
    {"hostel":"Fixture Hostel","status":"pending","requests":1,"median_days":3.0,"median_lead_days":null},
    {"hostel":"Fixture Hostel","status":"rejected","requests":1,"median_days":1.0,"median_lead_days":1.0}]');
SELECT pg_temp.chk('recognition_outcomes (FILTER by week)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_recognition_outcomes('2026-03-01', '2026-04-30', 91) r),
  '[{"week":"2026-03-09","scans":4,"matched":2,"low_confidence":1,"no_match":1,"avg_similarity":0.493},
    {"week":"2026-04-06","scans":1,"matched":0,"low_confidence":0,"no_match":1,"avg_similarity":0.200}]');
SELECT pg_temp.chk('similarity_distribution (width_bucket, 30 rows)',
  (SELECT jsonb_build_object('rows', count(*), 'nonzero', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT band, band_no, outcome, scans FROM report_similarity_distribution('2026-03-01', '2026-04-30', 91) WHERE scans > 0) x))
   FROM report_similarity_distribution('2026-03-01', '2026-04-30', 91)),
  '{"rows":30,"nonzero":[{"band":"0.1-0.2","band_no":2,"outcome":"no_match","scans":1},{"band":"0.2-0.3","band_no":3,"outcome":"no_match","scans":1},
                         {"band":"0.4-0.5","band_no":5,"outcome":"low_confidence","scans":1},{"band":"0.5-0.6","band_no":6,"outcome":"matched","scans":1},
                         {"band":"0.9-1.0","band_no":10,"outcome":"matched","scans":1}]}');
SELECT pg_temp.chk('low_attendance_students (subqueries, below 75 %)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_low_attendance_students('2026-03-01', '2026-04-30', 91) r),
  '[{"student":"Fixture C","roll_no":"FX3","hostel":"Fixture Hostel","marks":3,"present":0,"attendance_pct":0.0},
    {"student":"Fixture B","roll_no":"FX2","hostel":"Fixture Hostel","marks":3,"present":1,"attendance_pct":33.3}]');
SELECT pg_temp.chk('low_attendance: threshold parameter',
  (SELECT jsonb_agg(r.student) FROM report_low_attendance_students('2026-03-01', '2026-04-30', 91, 10) r), '["Fixture C"]');
SELECT pg_temp.chk('top_words (full-text lexemes)',
  (SELECT jsonb_agg(to_jsonb(r)) FROM report_top_words('2026-03-01', '2026-04-30', 91) r WHERE r.word IN ('curfew', 'famili', 'wedding', 'medic')),
  '[{"word":"curfew","source":"violations","occurrences":3},{"word":"famili","source":"leave reasons","occurrences":2},{"word":"medic","source":"leave reasons","occurrences":1}]');
SELECT pg_temp.chk('empty range returns no rows, not an error',
  (SELECT jsonb_build_object('a', (SELECT count(*) FROM report_attendance_by_hostel_month('2001-01-01', '2001-01-31', NULL)),
                             'b', (SELECT count(*) FROM report_time_outside('2001-01-01', '2001-01-31', NULL)),
                             'c', (SELECT count(*) FROM report_top_words('2001-01-01', '2001-01-31', NULL)))),
  '{"a":0,"b":0,"c":0}');
SELECT pg_temp.chk('hostel filter excludes other hostels',
  (SELECT count(*) FROM report_violations_by_type_hostel('2026-03-01', '2026-04-30', 1) WHERE hostel = 'Fixture Hostel')::TEXT::JSONB, '0');

SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, CASE WHEN ok THEN '' ELSE detail END AS detail FROM t ORDER BY ctid;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total FROM t;
ROLLBACK;
