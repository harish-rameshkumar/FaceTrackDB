-- Tests for db/migrations/004_rbac.sql: per role, what is allowed and what fails with "permission denied",
-- plus the row-level rules. Builds a small fixture as the OWNER, then runs each statement as the role
-- (SET LOCAL ROLE, app.user_id set like app/lib/db.ts does). Everything is rolled back.
-- Run on a database loaded with ./db/load_all.sh:
--   docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < db/rbac_tests.sql
-- Result values: ok / rows=N / denied (SQLSTATE 42501: no privilege, or a row-level-security violation) / error SQLSTATE.
BEGIN;
CREATE TEMP TABLE t (n SERIAL, who TEXT, what TEXT, expected TEXT, got TEXT, ok BOOLEAN);
GRANT ALL ON t TO PUBLIC;   -- (the temp table lives only in this session; roles need no access, only the owner writes to it)

-- run one statement as a role: returns 'rows=N' for a SELECT or the affected-row count for DML, 'denied', or 'error <sqlstate>'
CREATE FUNCTION pg_temp.run(p_role TEXT, p_uid INT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; res TEXT;
BEGIN
    PERFORM set_config('app.user_id', COALESCE(p_uid::TEXT, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    BEGIN
        IF p_sql ~* '^\s*(select|with)' THEN
            EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
        ELSE
            EXECUTE p_sql;
            GET DIAGNOSTICS n = ROW_COUNT;
        END IF;
        res := CASE WHEN p_sql ~* '^\s*(call)' THEN 'ok' ELSE 'rows=' || n END;
        RAISE EXCEPTION 'undo' USING ERRCODE = 'FT999';   -- every statement is undone, so the tests do not depend on each other
    EXCEPTION WHEN insufficient_privilege THEN
        res := 'denied';
    WHEN SQLSTATE 'FT999' THEN
        NULL;                                              -- success: keep res
    WHEN OTHERS THEN
        res := 'error ' || SQLSTATE;
    END;
    RESET ROLE;
    RETURN res;
END $$;
CREATE FUNCTION pg_temp.expect(p_who TEXT, p_role TEXT, p_uid INT, p_what TEXT, p_sql TEXT, p_expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE got TEXT;
BEGIN
    got := pg_temp.run(p_role, p_uid, p_sql);
    INSERT INTO t (who, what, expected, got, ok) VALUES (p_who, p_what, p_expected, got, got = p_expected);
END $$;

-- ---------------- fixture (owner) ----------------
INSERT INTO hostels (hostel_id, name) VALUES (96, 'RBAC Fixture Hostel');
INSERT INTO gates (gate_id, hostel_id, name) VALUES (96, 96, 'RBAC Gate');
INSERT INTO cameras (camera_id, gate_id, location, status) VALUES (96, 96, 'rbac', 'active');
INSERT INTO users (user_id, email, password_hash, role) VALUES
  (9601, 'rb.s1@rb.test', 'x', 'student'), (9602, 'rb.s2@rb.test', 'x', 'student'),
  (9611, 'rb.p1@rb.test', 'x', 'parent'), (9612, 'rb.p2@rb.test', 'x', 'parent'),
  (9621, 'rb.w@rb.test', 'x', 'warden'), (9605, 'rb.s3@rb.test', 'x', 'student');
INSERT INTO students (student_id, user_id, roll_no, name, hostel_id) VALUES (9601, 9601, 'RB1', 'Rbac One', 96), (9602, 9602, 'RB2', 'Rbac Two', 96), (9603, 9605, 'RB3', 'Rbac Three (no history)', 96);
INSERT INTO parents (parent_id, user_id, name) VALUES (9611, 9611, 'Rbac Parent One'), (9612, 9612, 'Rbac Parent Two');
INSERT INTO student_parent (student_id, parent_id, relation) VALUES (9601, 9611, 'father'), (9602, 9612, 'mother');
INSERT INTO attendance_sessions (session_id, hostel_id, session_date, start_time, end_time) VALUES (9601, 96, current_date - 1, '20:30', '21:00');
INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES (9601, 9601, 'absent', NULL), (9601, 9602, 'absent', NULL);
INSERT INTO leave_requests (leave_id, student_id, start_date, end_date, reason, status) VALUES
  (9601, 9601, current_date + 20, current_date + 21, 'rbac pending one', 'pending'),
  (9602, 9602, current_date + 30, current_date + 31, 'rbac pending two', 'pending'),
  (9604, 9601, current_date + 50, current_date + 51, 'rbac pending one, to cancel', 'pending');
INSERT INTO leave_requests (leave_id, student_id, start_date, end_date, reason, status, decided_by, decided_at) VALUES
  (9603, 9601, current_date + 40, current_date + 41, 'rbac approved one', 'approved', 9611, now());
INSERT INTO violations (violation_id, student_id, session_id, type, details) VALUES (9601, 9601, 9601, 'missed_attendance', 'rbac one'), (9602, 9602, 9601, 'missed_attendance', 'rbac two');

-- ---------------- the login role is not privileged ----------------
INSERT INTO t (who, what, expected, got, ok)
SELECT 'ft_app', 'is neither superuser nor BYPASSRLS, cannot create roles or databases', 'f,f,f,f',
       rolsuper || ',' || rolbypassrls || ',' || rolcreaterole || ',' || rolcreatedb, (rolsuper, rolbypassrls, rolcreaterole, rolcreatedb) = (false, false, false, false)
FROM pg_roles WHERE rolname = 'ft_app';
INSERT INTO t (who, what, expected, got, ok)
SELECT 'ft_*', 'the five role roles cannot log in', '5 x NOLOGIN', count(*) || ' x NOLOGIN', count(*) = 5 FROM pg_roles WHERE rolname IN ('ft_student','ft_parent','ft_warden','ft_security','ft_admin') AND NOT rolcanlogin;
INSERT INTO t (who, what, expected, got, ok)
SELECT 'PUBLIC', 'no table in public is readable by PUBLIC', '0', count(*)::TEXT, count(*) = 0
FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'PUBLIC';

-- ---------------- ft_app (what sign-in needs) ----------------
SELECT pg_temp.expect('ft_app', 'ft_app', NULL, 'read a password hash for login', 'SELECT password_hash FROM users WHERE email = ''rb.s1@rb.test''', 'rows=1');
SELECT pg_temp.expect('ft_app', 'ft_app', NULL, 'record a login attempt', 'SELECT login_record(''rb.s1@rb.test'', ''127.0.0.1'', false)', 'rows=1');
SELECT pg_temp.expect('ft_app', 'ft_app', NULL, 'cannot drop a table', 'DROP TABLE hostels', 'denied');   -- not the owner

-- ---------------- ft_student (user 9601 = student RB1) ----------------
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'sees only their own student row', 'SELECT student_id FROM students', 'rows=1');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'sees only their own leave (3 of the 4 fixture rows belong to them)', 'SELECT leave_id FROM leave_requests WHERE leave_id BETWEEN 9601 AND 9604', 'rows=3');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot read the other student''s leave by id', 'SELECT leave_id FROM leave_requests WHERE leave_id = 9602', 'rows=0');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'sees only their own violation', 'SELECT violation_id FROM violations WHERE violation_id IN (9601, 9602)', 'rows=1');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'sees only their own attendance', 'SELECT student_id FROM attendance WHERE session_id = 9601', 'rows=1');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'sees their own parents'' names, not other parents', 'SELECT parent_id FROM parents', 'rows=1');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot read password hashes', 'SELECT password_hash FROM users', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot read token versions', 'SELECT token_version FROM users', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'can read their own email and the emails of staff only', 'SELECT user_id FROM users WHERE user_id IN (9601, 9602, 9611, 9621)', 'rows=2');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot read face events', 'SELECT * FROM face_events', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot read face samples', 'SELECT * FROM face_profiles', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot read the login attempts table', 'SELECT * FROM login_attempts', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'can request leave for themselves', 'INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES (9601, current_date + 60, current_date + 61, ''rbac new'')', 'rows=1');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot request leave for someone else (row-level security)', 'INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES (9602, current_date + 62, current_date + 63, ''rbac other'')', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot set a decision when requesting', 'INSERT INTO leave_requests (student_id, start_date, end_date, reason, status) VALUES (9601, current_date + 64, current_date + 65, ''x'', ''approved'')', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'can cancel their own PENDING leave', 'DELETE FROM leave_requests WHERE leave_id = 9604', 'rows=1');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot cancel their own APPROVED leave', 'DELETE FROM leave_requests WHERE leave_id = 9603', 'rows=0');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot cancel someone else''s leave', 'DELETE FROM leave_requests WHERE leave_id = 9602', 'rows=0');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot change a leave decision', 'UPDATE leave_requests SET status = ''approved'' WHERE leave_id = 9602', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot resolve a violation', 'UPDATE violations SET status = ''resolved'' WHERE violation_id = 9601', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot create users', 'INSERT INTO users (email, password_hash, role) VALUES (''a@b.cc'', ''x'', ''admin'')', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot register students', 'SELECT register_student(''{}''::jsonb, ''[]''::jsonb, true, 1)', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot run the report functions', 'SELECT * FROM report_top_words(current_date - 30, current_date, NULL)', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', 9601, 'cannot call mark_attendance', 'CALL mark_attendance(9601, 9601, NULL, NULL)', 'denied');
SELECT pg_temp.expect('ft_student', 'ft_student', NULL, 'with no user id set, the student sees no rows', 'SELECT student_id FROM students', 'rows=0');

-- ---------------- ft_parent (user 9611 = parent of student RB1 only) ----------------
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'sees only the linked child', 'SELECT student_id FROM students', 'rows=1');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'sees only the child''s leave (3 of the 4 fixture rows)', 'SELECT leave_id FROM leave_requests WHERE leave_id BETWEEN 9601 AND 9604', 'rows=3');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'sees only the child''s violations', 'SELECT violation_id FROM violations WHERE violation_id IN (9601, 9602)', 'rows=1');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'sees only the child''s gate and attendance rows', 'SELECT student_id FROM attendance WHERE session_id = 9601', 'rows=1');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'sees only their own links', 'SELECT student_id FROM student_parent WHERE parent_id IN (9611, 9612)', 'rows=1');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot request leave', 'INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES (9601, current_date + 70, current_date + 71, ''x'')', 'denied');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot delete leave', 'DELETE FROM leave_requests WHERE leave_id = 9601', 'denied');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot read password hashes', 'SELECT password_hash FROM users', 'denied');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot touch violations', 'UPDATE violations SET status = ''resolved'' WHERE violation_id = 9601', 'denied');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'can decide a linked child''s leave (decide_leave)', 'CALL decide_leave(9601, 9611, ''approved'')', 'ok');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot decide another family''s leave (row not visible: FT031)', 'CALL decide_leave(9602, 9611, ''approved'')', 'error FT031');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot change a decision directly', 'UPDATE leave_requests SET reason = ''edited'' WHERE leave_id = 9603', 'denied');
SELECT pg_temp.expect('ft_parent', 'ft_parent', 9611, 'cannot read face events', 'SELECT * FROM face_events', 'denied');

-- ---------------- ft_warden ----------------
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'sees every student', 'SELECT student_id FROM students WHERE student_id IN (9601, 9602)', 'rows=2');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'reads leave requests', 'SELECT leave_id FROM leave_requests WHERE leave_id BETWEEN 9601 AND 9604', 'rows=4');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'resolves a violation', 'UPDATE violations SET status = ''resolved'', resolved_by = 9621, resolved_at = now() WHERE violation_id = 9601', 'rows=1');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot edit a violation''s details', 'UPDATE violations SET details = ''changed'' WHERE violation_id = 9602', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot delete violations', 'DELETE FROM violations WHERE violation_id = 9602', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot register or delete students', 'DELETE FROM students WHERE student_id = 9602', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot read password hashes', 'SELECT password_hash FROM users', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot read face samples (biometric link)', 'SELECT * FROM face_profiles', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot approve or reject leave', 'UPDATE leave_requests SET status = ''approved'' WHERE leave_id = 9602', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'runs a report', 'SELECT * FROM report_top_words(current_date - 30, current_date, NULL)', 'rows=' || (SELECT count(*) FROM report_top_words(current_date - 30, current_date, NULL)));
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'reads the dashboard views', 'SELECT * FROM v_current_presence WHERE hostel_id = 96', 'rows=3');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'creates a roll call', 'SELECT create_attendance_session(96, current_date + 3, ''20:00'', ''20:30'')', 'rows=1');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'closes a roll call (marks absentees, raises violations)', 'CALL close_attendance_session(9601, NULL, NULL)', 'ok');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'cannot scan (no face event rights)', 'INSERT INTO face_events (camera_id, outcome) VALUES (96, ''no_match'')', 'denied');
SELECT pg_temp.expect('ft_warden', 'ft_warden', 9621, 'reviews a scan (update face event)', 'UPDATE face_events SET reviewed_by = 9621 WHERE event_id = -1', 'rows=0');

-- ---------------- ft_security (the gate) ----------------
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'writes a scan', 'INSERT INTO face_events (camera_id, student_id, confidence, outcome) VALUES (96, 9601, 0.9, ''matched'')', 'rows=1');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'records a gate crossing', 'CALL record_entry_exit(9601, 96, NULL, ''OUT'', NULL, NULL)', 'ok');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'reads students and leave (the leave check)', 'SELECT student_id FROM students WHERE student_id IN (9601, 9602)', 'rows=2');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'cannot resolve violations', 'UPDATE violations SET status = ''resolved'' WHERE violation_id = 9602', 'denied');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'cannot run reports', 'SELECT * FROM report_top_words(current_date - 30, current_date, NULL)', 'denied');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'cannot create roll calls', 'SELECT create_attendance_session(96, current_date + 4, ''20:00'', ''20:30'')', 'denied');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'cannot read password hashes', 'SELECT password_hash FROM users', 'denied');
SELECT pg_temp.expect('ft_security', 'ft_security', 9621, 'cannot read face samples', 'SELECT * FROM face_profiles', 'denied');

-- ---------------- ft_admin ----------------
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'registers a student with a parent (register_student)',
  'SELECT register_student(''{"email":"rb.new@rb.test","hash":"x","roll_no":"RBN1","name":"Rbac New","hostel_id":96}''::jsonb, ''[{"email":"rb.np@rb.test","hash":"x","name":"Rbac NP","relation":"father"}]''::jsonb, true, 9621)', 'rows=1');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'deletes a student without history (delete_student)', 'SELECT delete_student(9603)', 'rows=1');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'reads face samples', 'SELECT * FROM face_profiles', 'rows=' || (SELECT count(*) FROM face_profiles));
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'signs a user out everywhere', 'UPDATE users SET token_version = token_version + 1 WHERE user_id = 9602', 'rows=1');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'cannot read password hashes', 'SELECT password_hash FROM users', 'denied');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'cannot change a password hash', 'UPDATE users SET password_hash = ''x'' WHERE user_id = 9602', 'denied');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'cannot change a violation''s text', 'UPDATE violations SET details = ''x'' WHERE violation_id = 9602', 'denied');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'cannot decide leave (only a linked parent can)', 'CALL decide_leave(9602, 9612, ''approved'')', 'denied');
SELECT pg_temp.expect('ft_admin', 'ft_admin', 9621, 'cannot drop or alter tables', 'ALTER TABLE hostels ADD COLUMN x INT', 'denied');

SELECT n, who, what, expected, got, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM t ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total FROM t;
ROLLBACK;
