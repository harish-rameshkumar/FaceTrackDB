-- Tests for db/b_demo.sql (demo_reset). One transaction, rolled back at the end.
-- Run: docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < db/b_demo_tests.sql
-- Scenario: a REAL student (with a real face profile, real attendance, scan, gate log, leave) lives in
-- the same hostel as demo rows. After demo_reset() every demo row is gone and every real row is still there.
BEGIN;
CREATE TEMP TABLE t (name TEXT, ok BOOLEAN, detail TEXT);
CREATE TEMP TABLE base (tbl TEXT PRIMARY KEY, n BIGINT);
INSERT INTO base SELECT x.tbl, x.n FROM (VALUES
  ('users', (SELECT count(*) FROM users)), ('students', (SELECT count(*) FROM students)), ('parents', (SELECT count(*) FROM parents)),
  ('attendance', (SELECT count(*) FROM attendance)), ('sessions', (SELECT count(*) FROM attendance_sessions)),
  ('gate_log', (SELECT count(*) FROM entry_exit_log)), ('face_events', (SELECT count(*) FROM face_events)),
  ('leave', (SELECT count(*) FROM leave_requests)), ('violations', (SELECT count(*) FROM violations)),
  ('hostels', (SELECT count(*) FROM hostels)), ('gates', (SELECT count(*) FROM gates)), ('cameras', (SELECT count(*) FROM cameras)),
  ('face_profiles', (SELECT count(*) FROM face_profiles))) AS x(tbl, n);

CREATE FUNCTION pg_temp.chk(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE sql AS
$$ INSERT INTO t VALUES (p_name, COALESCE(p_ok, FALSE), p_detail) $$;
CREATE FUNCTION pg_temp.cnt(p_tbl TEXT) RETURNS BIGINT LANGUAGE sql AS
$$ SELECT CASE p_tbl WHEN 'users' THEN (SELECT count(*) FROM users) WHEN 'students' THEN (SELECT count(*) FROM students)
   WHEN 'parents' THEN (SELECT count(*) FROM parents) WHEN 'attendance' THEN (SELECT count(*) FROM attendance)
   WHEN 'sessions' THEN (SELECT count(*) FROM attendance_sessions) WHEN 'gate_log' THEN (SELECT count(*) FROM entry_exit_log)
   WHEN 'face_events' THEN (SELECT count(*) FROM face_events) WHEN 'leave' THEN (SELECT count(*) FROM leave_requests)
   WHEN 'violations' THEN (SELECT count(*) FROM violations) WHEN 'hostels' THEN (SELECT count(*) FROM hostels)
   WHEN 'gates' THEN (SELECT count(*) FROM gates) WHEN 'cameras' THEN (SELECT count(*) FROM cameras)
   WHEN 'face_profiles' THEN (SELECT count(*) FROM face_profiles) END $$;
CREATE FUNCTION pg_temp.track(p_kind TEXT, p_id INT) RETURNS VOID LANGUAGE sql AS $$ INSERT INTO b_demo_rows VALUES (p_kind, p_id) ON CONFLICT DO NOTHING $$;

DO $$
DECLARE
    h3 INT; g3 INT; c3 INT; r JSONB; real_id INT; d1 INT; d2 INT;
    s_past INT; s_real INT; e1 INT; e2 INT; log1 INT; absent INT; viol INT; real_ev INT; real_log INT; real_hash TEXT;
    stu JSONB; par JSONB; st TEXT; vt TEXT;
BEGIN
    -- a hostel, gate and camera the "seeder" adds (tracked) ...
    INSERT INTO hostels (name) VALUES ('Demo Test Hostel') RETURNING hostel_id INTO h3;
    INSERT INTO gates (hostel_id, name) VALUES (h3, 'Main Gate') RETURNING gate_id INTO g3;
    INSERT INTO cameras (gate_id, location, status) VALUES (g3, 'test', 'active') RETURNING camera_id INTO c3;
    PERFORM pg_temp.track('hostel', h3); PERFORM pg_temp.track('gate', g3); PERFORM pg_temp.track('camera', c3);

    -- ... a REAL student who lives there, with a real face profile, scan, gate log, roll call, mark and leave
    r := register_student(jsonb_build_object('email','real.one@t.test','hash','x','roll_no','R-REAL-1','name','Real One','hostel_id',h3,'room_no','R1'),
         jsonb_build_array(jsonb_build_object('email','real.parent@t.test','hash','x','name','Real Parent','phone','','relation','father')), TRUE, 3);
    real_id := (r ->> 'student_id')::INT;
    INSERT INTO face_profiles (student_id, qdrant_point_id) VALUES (real_id, gen_random_uuid());
    INSERT INTO face_events (camera_id, student_id, confidence, outcome) VALUES (c3, real_id, 0.9, 'matched') RETURNING event_id INTO real_ev;
    INSERT INTO entry_exit_log (student_id, gate_id, event_id, direction, event_time) VALUES (real_id, g3, real_ev, 'OUT', now()) RETURNING log_id INTO real_log;
    INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (h3, current_date + 30, '20:00', '20:30') RETURNING session_id INTO s_real;
    INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES (s_real, real_id, 'present', (current_date + 30) + time '20:10');
    INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES (real_id, current_date + 40, current_date + 41, 'real leave');

    -- demo students (tracked), registered the way the admin page registers them
    stu := jsonb_build_object('email','demo.one@t.test','hash','x','roll_no','D-DEMO-1','name','Demo One','hostel_id',h3,'room_no','D1');
    par := jsonb_build_array(jsonb_build_object('email','demo.parent@t.test','hash','x','name','Demo Parent','phone','','relation','mother'));
    d1 := (register_student(stu, par, TRUE, 3) ->> 'student_id')::INT;
    d2 := (register_student(jsonb_set(jsonb_set(stu,'{email}','"demo.two@t.test"'),'{roll_no}','"D-DEMO-2"'), par, TRUE, 3) ->> 'student_id')::INT;   -- shares the parent
    PERFORM pg_temp.track('student', d1); PERFORM pg_temp.track('student', d2);

    -- a past roll call (tracked) with generated scans, closed with the real procedure
    INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (h3, current_date - 3, '20:00', '20:30') RETURNING session_id INTO s_past;
    PERFORM pg_temp.track('session', s_past);
    INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time) VALUES (c3, d1, 0.8, 'matched', (current_date - 3) + time '20:10') RETURNING event_id INTO e1;
    PERFORM pg_temp.track('face_event', e1);
    CALL mark_attendance(d1, s_past, e1, st);
    INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time) VALUES (c3, d1, 0.8, 'matched', (current_date - 3) + time '21:10') RETURNING event_id INTO e2;
    PERFORM pg_temp.track('face_event', e2);
    CALL record_entry_exit(d1, g3, e2, 'OUT', log1, vt);
    PERFORM pg_temp.track('gate_log', log1);
    CALL close_attendance_session(s_past, absent, viol);
    INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES (d2, current_date + 5, current_date + 6, 'demo leave');
    PERFORM pg_temp.track('leave', (SELECT leave_id FROM leave_requests WHERE reason = 'demo leave'));

    INSERT INTO t VALUES ('Scenario built', d1 IS NOT NULL AND absent >= 1 AND viol >= 1, format('absent=%s violations=%s tracked=%s', absent, viol, (SELECT count(*) FROM b_demo_rows)));
    INSERT INTO t VALUES ('Real mark was not affected by closing the generated roll call',
        EXISTS (SELECT 1 FROM attendance WHERE session_id = s_real AND student_id = real_id), '');
END $$;

-- the reset
CREATE TEMP TABLE reset_out AS SELECT * FROM demo_reset();
SELECT pg_temp.chk('Reset reports what it removed', (SELECT count(*) FROM reset_out) >= 10 AND (SELECT removed FROM reset_out WHERE what = 'demo students (with their logins)') = 2,
  (SELECT string_agg(what || '=' || removed, ', ') FROM reset_out));
SELECT pg_temp.chk('Demo students, the shared parent login and the generated history are gone',
  NOT EXISTS (SELECT 1 FROM students WHERE roll_no LIKE 'D-DEMO-%') AND NOT EXISTS (SELECT 1 FROM users WHERE email IN ('demo.one@t.test','demo.two@t.test','demo.parent@t.test'))
  AND NOT EXISTS (SELECT 1 FROM attendance_sessions WHERE session_date = current_date - 3 AND start_time = '20:00')
  AND NOT EXISTS (SELECT 1 FROM leave_requests WHERE reason = 'demo leave') AND NOT EXISTS (SELECT 1 FROM violations WHERE details LIKE '%Left the hostel at 21:10%'));
SELECT pg_temp.chk('The real student, their login, parent, face profile and rows are untouched',
  EXISTS (SELECT 1 FROM students WHERE roll_no = 'R-REAL-1') AND EXISTS (SELECT 1 FROM users WHERE email IN ('real.one@t.test','real.parent@t.test') GROUP BY () HAVING count(*) = 2)
  AND (SELECT count(*) FROM face_profiles fp JOIN students s USING (student_id) WHERE s.roll_no = 'R-REAL-1') = 1
  AND EXISTS (SELECT 1 FROM leave_requests WHERE reason = 'real leave') AND EXISTS (SELECT 1 FROM attendance a JOIN students s USING (student_id) WHERE s.roll_no = 'R-REAL-1')
  AND EXISTS (SELECT 1 FROM entry_exit_log l JOIN students s USING (student_id) WHERE s.roll_no = 'R-REAL-1'));
SELECT pg_temp.chk('The hostel, gate and camera stay because a real student still uses them',
  EXISTS (SELECT 1 FROM hostels WHERE name = 'Demo Test Hostel') AND (SELECT count(*) FROM gates g JOIN hostels h USING (hostel_id) WHERE h.name = 'Demo Test Hostel') = 1);
SELECT pg_temp.chk('Row counts equal the starting counts plus exactly the real rows added (1 student, 2 users, 1 parent, 1 mark, 1 roll call, 1 scan, 1 gate log, 1 leave, 1 face profile, 1 hostel, 1 gate, 1 camera)',
  pg_temp.cnt('users') = (SELECT n FROM base WHERE tbl = 'users') + 2 AND pg_temp.cnt('students') = (SELECT n FROM base WHERE tbl = 'students') + 1
  AND pg_temp.cnt('parents') = (SELECT n FROM base WHERE tbl = 'parents') + 1 AND pg_temp.cnt('attendance') = (SELECT n FROM base WHERE tbl = 'attendance') + 1
  AND pg_temp.cnt('sessions') = (SELECT n FROM base WHERE tbl = 'sessions') + 1 AND pg_temp.cnt('gate_log') = (SELECT n FROM base WHERE tbl = 'gate_log') + 1
  AND pg_temp.cnt('face_events') = (SELECT n FROM base WHERE tbl = 'face_events') + 1 AND pg_temp.cnt('leave') = (SELECT n FROM base WHERE tbl = 'leave') + 1
  AND pg_temp.cnt('violations') = (SELECT n FROM base WHERE tbl = 'violations') AND pg_temp.cnt('face_profiles') = (SELECT n FROM base WHERE tbl = 'face_profiles') + 1
  AND pg_temp.cnt('hostels') = (SELECT n FROM base WHERE tbl = 'hostels') + 1 AND pg_temp.cnt('gates') = (SELECT n FROM base WHERE tbl = 'gates') + 1
  AND pg_temp.cnt('cameras') = (SELECT n FROM base WHERE tbl = 'cameras') + 1,
  (SELECT string_agg(b.tbl || ':' || b.n || '->' || pg_temp.cnt(b.tbl), ' ' ORDER BY b.tbl) FROM base b));
SELECT pg_temp.chk('The tracking table is empty after a reset', (SELECT count(*) FROM b_demo_rows) = 0);
SELECT pg_temp.chk('A second reset removes nothing and does not fail', (SELECT COALESCE(sum(removed), 0) FROM demo_reset()) = 0);
SELECT pg_temp.chk('Sample data from seed.sql is untouched (6 students, 15 users, 13 seeded scans)',
  (SELECT count(*) FROM students WHERE roll_no IN ('21CS001','21CS007','21EC012','21CS014','21IT003','21EC020')) = 6 AND (SELECT count(*) FROM face_events WHERE event_id <= 13) = 13);

SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, CASE WHEN ok THEN '' ELSE detail END AS detail FROM t ORDER BY ctid;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total FROM t;
ROLLBACK;
