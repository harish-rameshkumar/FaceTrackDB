-- Tests for db/b_register.sql. Everything runs inside one transaction that is
-- rolled back at the end, so the database is left unchanged.
-- Run: docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < db/b_register_tests.sql
BEGIN;
CREATE TEMP TABLE t (name TEXT, ok BOOLEAN, detail TEXT);

CREATE FUNCTION pg_temp.expect_err(p_name TEXT, p_sql TEXT, p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        INSERT INTO t VALUES (p_name, FALSE, 'no error');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t VALUES (p_name, SQLSTATE = p_code, SQLSTATE);
    END;
END $$;

-- helpers: JSON for a student and parents
CREATE FUNCTION pg_temp.stu(e TEXT, r TEXT) RETURNS JSONB LANGUAGE sql AS
$$ SELECT jsonb_build_object('email', e, 'hash', '$2a$10$x', 'roll_no', r, 'name', 'Test Student', 'hostel_id', 1, 'room_no', 'T-1') $$;
CREATE FUNCTION pg_temp.par(e TEXT, rel TEXT) RETURNS JSONB LANGUAGE sql AS
$$ SELECT jsonb_build_object('email', e, 'hash', '$2a$10$y', 'name', 'Test Parent', 'phone', '+910000000000', 'relation', rel) $$;

DO $$
DECLARE r JSONB; r2 JSONB; n0 INT; sid INT; sid2 INT;
BEGIN
    SELECT count(*) INTO n0 FROM users;

    -- 1. two parents
    r := register_student(pg_temp.stu('new.one@t.test', 'T001'), jsonb_build_array(pg_temp.par('pa@t.test','father'), pg_temp.par('pb@t.test','mother')), TRUE, 3);
    sid := (r ->> 'student_id')::INT;
    INSERT INTO t VALUES ('Register with two parents', (SELECT count(*) FROM users) = n0 + 3
        AND (SELECT count(*) FROM student_parent WHERE student_id = sid) = 2
        AND EXISTS (SELECT 1 FROM b_consents WHERE student_id = sid), r::text);

    -- 2. a parent shared by a second ward is reused, not duplicated
    r2 := register_student(pg_temp.stu('new.two@t.test', 'T002'), jsonb_build_array(pg_temp.par('PA@t.test','guardian')), TRUE, 3);
    sid2 := (r2 ->> 'student_id')::INT;
    INSERT INTO t VALUES ('Shared parent is reused', (SELECT count(*) FROM parents p JOIN users u USING (user_id) WHERE u.email = 'pa@t.test') = 1
        AND (SELECT count(*) FROM student_parent sp JOIN parents p USING (parent_id) JOIN users u USING (user_id) WHERE u.email = 'pa@t.test') = 2
        AND (r2 -> 'parents' -> 0 ->> 'created')::boolean = FALSE, r2::text);
END $$;

SELECT pg_temp.expect_err('Duplicate student email', $q$SELECT register_student(pg_temp.stu('new.one@t.test','T900'), jsonb_build_array(pg_temp.par('x@t.test','father')), TRUE, 3)$q$, 'FT050');
SELECT pg_temp.expect_err('Duplicate SRN (case-insensitive)', $q$SELECT register_student(pg_temp.stu('other@t.test','t001'), jsonb_build_array(pg_temp.par('x@t.test','father')), TRUE, 3)$q$, 'FT051');
SELECT pg_temp.expect_err('Parent email of a staff account', $q$SELECT register_student(pg_temp.stu('o2@t.test','T901'), jsonb_build_array(pg_temp.par('warden1@facetrack.test','father')), TRUE, 3)$q$, 'FT052');
SELECT pg_temp.expect_err('Consent required', $q$SELECT register_student(pg_temp.stu('o3@t.test','T902'), jsonb_build_array(pg_temp.par('x@t.test','father')), FALSE, 3)$q$, 'FT053');
SELECT pg_temp.expect_err('Zero parents', $q$SELECT register_student(pg_temp.stu('o4@t.test','T903'), '[]'::jsonb, TRUE, 3)$q$, 'FT053');
SELECT pg_temp.expect_err('Three parents', $q$SELECT register_student(pg_temp.stu('o5@t.test','T904'), jsonb_build_array(pg_temp.par('a1@t.test','father'), pg_temp.par('a2@t.test','mother'), pg_temp.par('a3@t.test','guardian')), TRUE, 3)$q$, 'FT053');
SELECT pg_temp.expect_err('Bad relation', $q$SELECT register_student(pg_temp.stu('o6@t.test','T905'), jsonb_build_array(pg_temp.par('a4@t.test','uncle')), TRUE, 3)$q$, 'FT053');
SELECT pg_temp.expect_err('Same email for both parents', $q$SELECT register_student(pg_temp.stu('o7@t.test','T906'), jsonb_build_array(pg_temp.par('a5@t.test','father'), pg_temp.par('a5@t.test','mother')), TRUE, 3)$q$, 'FT053');
SELECT pg_temp.expect_err('Unknown hostel', $q$SELECT register_student(jsonb_set(pg_temp.stu('o8@t.test','T907'), '{hostel_id}', '99'), jsonb_build_array(pg_temp.par('a6@t.test','father')), TRUE, 3)$q$, 'FT054');

-- failure halfway rolls everything back: second parent is invalid, so nothing may remain
DO $$
DECLARE n0 INT; n1 INT; s0 INT; s1 INT;
BEGIN
    SELECT count(*) INTO n0 FROM users; SELECT count(*) INTO s0 FROM students;
    BEGIN
        PERFORM register_student(pg_temp.stu('half@t.test','T950'), jsonb_build_array(pg_temp.par('half.p@t.test','father'), pg_temp.par('half.q@t.test','uncle')), TRUE, 3);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    SELECT count(*) INTO n1 FROM users; SELECT count(*) INTO s1 FROM students;
    INSERT INTO t VALUES ('Failure halfway leaves no orphan users', n0 = n1 AND s0 = s1, format('users %s->%s students %s->%s', n0, n1, s0, s1));
END $$;

-- delete rules
DO $$
DECLARE sid INT := (SELECT student_id FROM students WHERE roll_no = 'T001'); sid2 INT := (SELECT student_id FROM students WHERE roll_no = 'T002');
        removed INT; u INT := (SELECT count(*) FROM users);
BEGIN
    INSERT INTO t VALUES ('Seeded student with history cannot be deleted', cardinality(student_delete_blockers(1)) > 0, student_delete_blockers(1)::text);
    -- T001 first: parent pa is still a ward-parent of T002, pb is only T001's
    removed := delete_student(sid);
    INSERT INTO t VALUES ('Delete: only the parent with no other ward is removed', removed = 1
        AND EXISTS (SELECT 1 FROM users WHERE email = 'pa@t.test') AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'pb@t.test')
        AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'new.one@t.test'), 'removed=' || removed);
    removed := delete_student(sid2);
    INSERT INTO t VALUES ('Delete last ward removes the shared parent too', removed = 1 AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'pa@t.test')
        AND (SELECT count(*) FROM users) = u - 4, 'users=' || (SELECT count(*) FROM users));
END $$;
SELECT pg_temp.expect_err('Delete with history refused (FT055)', 'SELECT delete_student(1)', 'FT055');
SELECT pg_temp.expect_err('Delete unknown student (FT009)', 'SELECT delete_student(9999)', 'FT009');

-- roll-call sessions
DO $$ DECLARE a INT; BEGIN a := create_attendance_session(1, current_date + 5, '20:00', '20:30'); INSERT INTO t VALUES ('Create roll call', a IS NOT NULL, a::text); END $$;
SELECT pg_temp.expect_err('Overlapping roll call (FT060)', $q$SELECT create_attendance_session(1, current_date + 5, '20:15', '20:45')$q$, 'FT060');
SELECT pg_temp.expect_err('Contained roll call (FT060)', $q$SELECT create_attendance_session(1, current_date + 5, '20:05', '20:10')$q$, 'FT060');
SELECT pg_temp.expect_err('Back-to-back is allowed, but end before start is a CHECK', $q$SELECT create_attendance_session(1, current_date + 5, '21:00', '20:50')$q$, '23514');
SELECT pg_temp.expect_err('Roll call in the past (FT061)', $q$SELECT create_attendance_session(1, current_date - 1, '20:00', '20:30')$q$, 'FT061');
SELECT pg_temp.expect_err('Roll call for unknown hostel (FT054)', $q$SELECT create_attendance_session(99, current_date + 5, '20:00', '20:30')$q$, 'FT054');
DO $$ DECLARE a INT; BEGIN a := create_attendance_session(1, current_date + 5, '20:30', '21:00'); INSERT INTO t VALUES ('Adjacent roll call is allowed', a IS NOT NULL, a::text);
    a := create_attendance_session(2, current_date + 5, '20:00', '20:30'); INSERT INTO t VALUES ('Same time at another hostel is allowed', a IS NOT NULL, a::text); END $$;

-- preview matches what close does (session 1 of the seed data is in the past)
DO $$
DECLARE sess INT; p RECORD; a INT; v INT;
BEGIN
    INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (2, current_date - 3, '20:00', '20:30') RETURNING session_id INTO sess;
    SELECT * INTO p FROM session_close_preview(sess);
    CALL close_attendance_session(sess, a, v);
    INSERT INTO t VALUES ('Close preview equals the real result', a > 0 AND p.will_be_absent = a AND p.will_get_violation = v, format('preview %s/%s, real %s/%s', p.will_be_absent, p.will_get_violation, a, v));
END $$;

SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM t ORDER BY ctid;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total FROM t;
ROLLBACK;
