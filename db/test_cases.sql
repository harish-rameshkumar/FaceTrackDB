-- =====================================================================
-- FaceTrackDB: SQL test cases (Phase 5)
--
-- Attacks every constraint, trigger and stored procedure with bad data
-- and checks that the database answers with the expected error code
-- (or the expected result for the good cases).
--
-- Run on a freshly loaded database (db\load_all.ps1):
--   Get-Content db\test_cases.sql | docker compose exec -T postgres psql -U facetrack -d facetrackdb
--
-- Everything runs inside one transaction that is rolled back at the end,
-- so the database is left exactly as it was and the file can be re-run.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE test_results (
    n        SERIAL,
    label    TEXT,
    expected TEXT,
    got      TEXT,
    passed   BOOLEAN
);

-- Runs one statement and passes when it fails with exactly the expected SQLSTATE.
CREATE FUNCTION pg_temp.expect_error(p_label TEXT, p_sql TEXT, p_expected TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state TEXT := 'no error';
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    END;
    INSERT INTO test_results (label, expected, got, passed)
    VALUES (p_label, p_expected, v_state, v_state = p_expected);
END $$;

-- Runs one statement and passes when it succeeds.
CREATE FUNCTION pg_temp.expect_ok(p_label TEXT, p_sql TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state TEXT := 'ok';
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    END;
    INSERT INTO test_results (label, expected, got, passed)
    VALUES (p_label, 'ok', v_state, v_state = 'ok');
END $$;

-- Runs a query that returns one value and passes when it equals the expected text.
CREATE FUNCTION pg_temp.expect_value(p_label TEXT, p_query TEXT, p_expected TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_got TEXT;
BEGIN
    BEGIN
        EXECUTE p_query INTO v_got;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_got = RETURNED_SQLSTATE;
    END;
    INSERT INTO test_results (label, expected, got, passed)
    VALUES (p_label, p_expected, COALESCE(v_got, 'null'), v_got IS NOT DISTINCT FROM p_expected);
END $$;

-- Lookup helpers so the tests do not depend on generated ids
CREATE FUNCTION pg_temp.ev(p_student INT, p_time TEXT) RETURNS INT
LANGUAGE sql AS $$
    SELECT event_id FROM face_events WHERE student_id = p_student AND event_time = p_time::timestamp
$$;
CREATE FUNCTION pg_temp.sess(p_hostel INT, p_date TEXT, p_start TEXT) RETURNS INT
LANGUAGE sql AS $$
    SELECT session_id FROM attendance_sessions
    WHERE hostel_id = p_hostel AND session_date = p_date::date AND start_time = p_start::time
$$;
CREATE FUNCTION pg_temp.leave_id(p_reason TEXT) RETURNS INT
LANGUAGE sql AS $$
    SELECT leave_id FROM leave_requests WHERE reason = p_reason
$$;

\o /dev/null

-- =====================================================================
-- 1. CONSTRAINTS (keys, CHECK, UNIQUE, NOT NULL, foreign keys)
-- =====================================================================
SELECT pg_temp.expect_error('[constraint] leave end date before start date',
  $q$INSERT INTO leave_requests (student_id, start_date, end_date) VALUES (1, '2027-01-10', '2027-01-05')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] duplicate attendance row (same student and session)',
  $q$INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES (1, 1, 'present', '2026-10-20 22:10')$q$, '23505');
SELECT pg_temp.expect_error('[constraint] unknown user role',
  $q$INSERT INTO users (email, password_hash, role) VALUES ('x@y.test', 'h', 'principal')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] duplicate email',
  $q$INSERT INTO users (email, password_hash, role) VALUES ('warden1@facetrack.test', 'h', 'admin')$q$, '23505');
SELECT pg_temp.expect_error('[constraint] email without @',
  $q$INSERT INTO users (email, password_hash, role) VALUES ('not-an-email', 'h', 'admin')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] NOT NULL: student without a name',
  $q$INSERT INTO students (user_id, roll_no, name, hostel_id) VALUES (4, 'N1', NULL, 1)$q$, '23502');
SELECT pg_temp.expect_error('[constraint] foreign key: gate for a hostel that does not exist',
  $q$INSERT INTO gates (hostel_id, name) VALUES (99, 'Ghost Gate')$q$, '23503');
SELECT pg_temp.expect_error('[constraint] attendance cannot point to another student''s face event',
  $q$INSERT INTO attendance (session_id, student_id, event_id, status, marked_at) VALUES (4, 2, 6, 'present', '2026-10-22 22:10')$q$, '23503');
SELECT pg_temp.expect_error('[constraint] matched face event must name a student',
  $q$INSERT INTO face_events (camera_id, student_id, confidence, outcome) VALUES (1, NULL, 0.9, 'matched')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] confidence above 1',
  $q$INSERT INTO face_events (camera_id, student_id, confidence, outcome) VALUES (1, 1, 1.5, 'matched')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] violation must point at a log or a session',
  $q$INSERT INTO violations (student_id, type, details) VALUES (1, 'no_leave', 'x')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] resolved violation needs a resolver',
  $q$INSERT INTO violations (student_id, session_id, type, status) VALUES (1, 1, 'missed_attendance', 'resolved')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] session end before start',
  $q$INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (1, '2027-01-01', '23:00', '22:00')$q$, '23514');
SELECT pg_temp.expect_error('[constraint] two sessions in the same slot',
  $q$INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (1, '2026-10-20', '22:00', '22:30')$q$, '23505');
SELECT pg_temp.expect_error('[constraint] parent phone format',
  $q$UPDATE parents SET phone = 'abc' WHERE parent_id = 1$q$, '23514');
SELECT pg_temp.expect_error('[constraint] two gates with the same name in one hostel',
  $q$INSERT INTO gates (hostel_id, name) VALUES (1, 'Main Gate')$q$, '23505');
SELECT pg_temp.expect_error('[constraint] pending leave cannot already have a decider',
  $q$INSERT INTO leave_requests (student_id, start_date, end_date, status, decided_by, decided_at) VALUES (1, '2027-01-01', '2027-01-02', 'pending', 1, now())$q$, '23514');
SELECT pg_temp.expect_error('[constraint] leave decided by a parent of another student',
  $q$INSERT INTO leave_requests (student_id, start_date, end_date, status, decided_by, decided_at) VALUES (1, '2027-01-01', '2027-01-02', 'approved', 3, now())$q$, '23503');
SELECT pg_temp.expect_error('[constraint] overlapping approved leave (exclusion constraint)',
  $q$INSERT INTO leave_requests (student_id, start_date, end_date, status, decided_by, decided_at) VALUES (1, '2026-10-24', '2026-10-26', 'approved', 1, now())$q$, '23P01');

-- =====================================================================
-- 2. TRIGGERS
-- =====================================================================
SELECT pg_temp.expect_error('[trigger FT003] attendance for a student of another hostel',
  $q$INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES (1, 4, 'present', '2026-10-20 22:10')$q$, 'FT003');
SELECT pg_temp.expect_error('[trigger FT004] attendance mark outside the roll-call window',
  $q$INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES (4, 1, 'present', '2026-10-22 21:00')$q$, 'FT004');
SELECT pg_temp.expect_error('[trigger FT005] present cannot be downgraded to absent',
  $q$UPDATE attendance SET status = 'absent' WHERE session_id = 1 AND student_id = 1$q$, 'FT005');
SELECT pg_temp.expect_ok('[trigger] warden review: low_confidence becomes present',
  $q$UPDATE attendance SET status = 'present' WHERE session_id = 2 AND student_id = 2$q$);
SELECT pg_temp.expect_error('[trigger FT010] a decided leave request cannot be edited',
  $q$UPDATE leave_requests SET reason = 'sneaky edit' WHERE leave_id = 1$q$, 'FT010');
SELECT pg_temp.expect_ok('[trigger] create an old pending leave for the next test',
  $q$INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES (2, '2026-09-01', '2026-09-02', 'old leave')$q$);
SELECT pg_temp.expect_error('[trigger FT011] a leave that already ended cannot be approved',
  $q$UPDATE leave_requests SET status = 'approved', decided_by = 3, decided_at = now() WHERE reason = 'old leave'$q$, 'FT011');
SELECT pg_temp.expect_error('[trigger FT021] gate of another hostel',
  $q$INSERT INTO entry_exit_log (student_id, gate_id, direction, event_time) VALUES (1, 3, 'OUT', '2026-10-22 18:00:00')$q$, 'FT021');
SELECT pg_temp.expect_ok('[trigger] first gate event of a student (OUT)',
  $q$INSERT INTO entry_exit_log (student_id, gate_id, direction, event_time) VALUES (5, 3, 'OUT', '2026-10-22 18:00:00')$q$);
SELECT pg_temp.expect_error('[trigger FT022] OUT twice in a row',
  $q$INSERT INTO entry_exit_log (student_id, gate_id, direction, event_time) VALUES (5, 3, 'OUT', '2026-10-22 18:05:00')$q$, 'FT022');
SELECT pg_temp.expect_error('[trigger FT023] gate event older than the last one',
  $q$INSERT INTO entry_exit_log (student_id, gate_id, direction, event_time) VALUES (5, 3, 'IN', '2026-10-22 17:00:00')$q$, 'FT023');
SELECT pg_temp.expect_error('[trigger FT040] a parent account cannot be used as a student',
  $q$INSERT INTO students (user_id, roll_no, name, hostel_id) VALUES (10, 'X1', 'Bad', 1)$q$, 'FT040');
SELECT pg_temp.expect_error('[trigger FT040] only a warden or admin can review a scan',
  $q$UPDATE face_events SET reviewed_by = 4 WHERE event_id = 13$q$, 'FT040');

-- =====================================================================
-- 3. STORED PROCEDURES
-- =====================================================================
-- face events the tests will use
INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time) VALUES
  (1, 1, 0.931, 'matched',        '2026-10-22 22:10:00'),
  (1, 1, 0.925, 'matched',        '2026-10-22 22:11:00'),
  (1, 2, 0.702, 'low_confidence', '2026-10-22 22:12:00'),
  (4, 4, 0.918, 'matched',        '2026-10-22 21:00:00'),
  (4, 4, 0.922, 'matched',        '2026-10-22 22:00:00'),
  (2, 3, 0.905, 'matched',        '2026-10-22 18:00:00'),
  (1, 3, 0.899, 'matched',        '2026-10-22 23:10:00'),
  (2, 1, 0.940, 'matched',        '2026-10-24 23:30:00');

-- mark_attendance
SELECT pg_temp.expect_ok('[mark_attendance] matched scan is accepted',
  format($q$CALL mark_attendance(1, 4, %s, NULL)$q$, pg_temp.ev(1, '2026-10-22 22:10:00')));
SELECT pg_temp.expect_value('[mark_attendance] stored status is present',
  $q$SELECT status FROM attendance WHERE session_id = 4 AND student_id = 1$q$, 'present');
SELECT pg_temp.expect_error('[mark_attendance FT001] second scan of the same student',
  format($q$CALL mark_attendance(1, 4, %s, NULL)$q$, pg_temp.ev(1, '2026-10-22 22:11:00')), 'FT001');
SELECT pg_temp.expect_ok('[mark_attendance] low-confidence scan is accepted',
  format($q$CALL mark_attendance(2, 4, %s, NULL)$q$, pg_temp.ev(2, '2026-10-22 22:12:00')));
SELECT pg_temp.expect_value('[mark_attendance] stored status is low_confidence',
  $q$SELECT status FROM attendance WHERE session_id = 4 AND student_id = 2$q$, 'low_confidence');
SELECT pg_temp.expect_error('[mark_attendance FT002] session does not exist',
  $q$CALL mark_attendance(1, 99, NULL, NULL)$q$, 'FT002');
SELECT pg_temp.expect_error('[mark_attendance FT009] student does not exist',
  $q$CALL mark_attendance(99, 4, NULL, NULL)$q$, 'FT009');
SELECT pg_temp.expect_error('[mark_attendance FT006] face event does not exist',
  $q$CALL mark_attendance(3, 4, 99999, NULL)$q$, 'FT006');
SELECT pg_temp.expect_error('[mark_attendance FT007] face event belongs to another student',
  format($q$CALL mark_attendance(3, 4, %s, NULL)$q$, pg_temp.ev(1, '2026-10-22 22:11:00')), 'FT007');
SELECT pg_temp.expect_error('[mark_attendance FT003] student of another hostel',
  $q$CALL mark_attendance(4, 1, NULL, NULL)$q$, 'FT003');

-- record_entry_exit
SELECT pg_temp.expect_ok('[record_entry_exit] night exit without leave is recorded',
  format($q$CALL record_entry_exit(4, 3, %s, 'OUT', NULL, NULL)$q$, pg_temp.ev(4, '2026-10-22 21:00:00')));
SELECT pg_temp.expect_value('[record_entry_exit] ...and a no_leave violation is raised',
  $q$SELECT v.type FROM violations v WHERE v.log_id = (SELECT max(log_id) FROM entry_exit_log WHERE student_id = 4)$q$, 'no_leave');
SELECT pg_temp.expect_ok('[record_entry_exit] return before curfew is recorded',
  format($q$CALL record_entry_exit(4, 3, %s, 'IN', NULL, NULL)$q$, pg_temp.ev(4, '2026-10-22 22:00:00')));
SELECT pg_temp.expect_value('[record_entry_exit] ...with no violation',
  $q$SELECT count(*) FROM violations WHERE log_id = (SELECT max(log_id) FROM entry_exit_log WHERE student_id = 4)$q$, '0');
SELECT pg_temp.expect_ok('[record_entry_exit] evening exit before 20:00 is recorded',
  format($q$CALL record_entry_exit(3, 1, %s, 'OUT', NULL, NULL)$q$, pg_temp.ev(3, '2026-10-22 18:00:00')));
SELECT pg_temp.expect_ok('[record_entry_exit] return at 23:10 is recorded',
  format($q$CALL record_entry_exit(3, 1, %s, 'IN', NULL, NULL)$q$, pg_temp.ev(3, '2026-10-22 23:10:00')));
SELECT pg_temp.expect_value('[record_entry_exit] ...and a late_return violation is raised',
  $q$SELECT v.type FROM violations v WHERE v.log_id = (SELECT max(log_id) FROM entry_exit_log WHERE student_id = 3)$q$, 'late_return');
SELECT pg_temp.expect_ok('[record_entry_exit] night exit during approved leave is recorded',
  format($q$CALL record_entry_exit(1, 1, %s, 'OUT', NULL, NULL)$q$, pg_temp.ev(1, '2026-10-24 23:30:00')));
SELECT pg_temp.expect_value('[record_entry_exit] ...with no violation (leave covers the date)',
  $q$SELECT count(*) FROM violations WHERE log_id = (SELECT max(log_id) FROM entry_exit_log WHERE student_id = 1)$q$, '0');
SELECT pg_temp.expect_error('[record_entry_exit FT020] invalid direction',
  $q$CALL record_entry_exit(1, 1, NULL, 'SIDEWAYS', NULL, NULL)$q$, 'FT020');
SELECT pg_temp.expect_error('[record_entry_exit FT024] face event captured at another gate',
  format($q$CALL record_entry_exit(3, 2, %s, 'IN', NULL, NULL)$q$, pg_temp.ev(3, '2026-10-22 23:10:00')), 'FT024');
SELECT pg_temp.expect_error('[record_entry_exit FT007] face event belongs to another student',
  format($q$CALL record_entry_exit(2, 1, %s, 'IN', NULL, NULL)$q$, pg_temp.ev(3, '2026-10-22 23:10:00')), 'FT007');

-- decide_leave (two overlapping pending requests for Arun)
SELECT pg_temp.expect_ok('[decide_leave] create two overlapping pending requests',
  $q$INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES
       (1, '2027-02-01', '2027-02-03', 'test A'), (1, '2027-02-02', '2027-02-04', 'test B')$q$);
SELECT pg_temp.expect_error('[decide_leave FT033] parent of a different student',
  format($q$CALL decide_leave(%s, 3, 'approved')$q$, pg_temp.leave_id('test A')), 'FT033');
SELECT pg_temp.expect_error('[decide_leave FT030] invalid decision',
  format($q$CALL decide_leave(%s, 1, 'maybe')$q$, pg_temp.leave_id('test A')), 'FT030');
SELECT pg_temp.expect_error('[decide_leave FT031] request does not exist',
  $q$CALL decide_leave(99999, 1, 'approved')$q$, 'FT031');
SELECT pg_temp.expect_ok('[decide_leave] the right parent approves',
  format($q$CALL decide_leave(%s, 1, 'approved')$q$, pg_temp.leave_id('test A')));
SELECT pg_temp.expect_value('[decide_leave] request is now approved',
  format($q$SELECT status FROM leave_requests WHERE leave_id = %s$q$, pg_temp.leave_id('test A')), 'approved');
SELECT pg_temp.expect_error('[decide_leave FT032] second decision on the same request',
  format($q$CALL decide_leave(%s, 2, 'rejected')$q$, pg_temp.leave_id('test A')), 'FT032');
SELECT pg_temp.expect_error('[decide_leave FT034] approving would overlap an approved leave',
  format($q$CALL decide_leave(%s, 2, 'approved')$q$, pg_temp.leave_id('test B')), 'FT034');

-- close_attendance_session
SELECT pg_temp.expect_ok('[close_attendance_session] create a past session for hostel 2',
  $q$INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (2, '2026-10-21', '20:00', '20:30')$q$);
SELECT pg_temp.expect_ok('[close_attendance_session] close it',
  format($q$CALL close_attendance_session(%s, NULL, NULL)$q$, pg_temp.sess(2, '2026-10-21', '20:00')));
SELECT pg_temp.expect_value('[close_attendance_session] everyone who did not scan is absent',
  format($q$SELECT count(*) FROM attendance WHERE session_id = %s AND status = 'absent'$q$, pg_temp.sess(2, '2026-10-21', '20:00')), '3');
SELECT pg_temp.expect_value('[close_attendance_session] ...with a missed_attendance violation each',
  format($q$SELECT count(*) FROM violations WHERE session_id = %s$q$, pg_temp.sess(2, '2026-10-21', '20:00')), '3');
SELECT pg_temp.expect_ok('[close_attendance_session] closing twice is harmless',
  format($q$CALL close_attendance_session(%s, NULL, NULL)$q$, pg_temp.sess(2, '2026-10-21', '20:00')));
SELECT pg_temp.expect_value('[close_attendance_session] ...and adds nothing',
  format($q$SELECT count(*) FROM violations WHERE session_id = %s$q$, pg_temp.sess(2, '2026-10-21', '20:00')), '3');
SELECT pg_temp.expect_ok('[close_attendance_session] create a future session',
  $q$INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (1, '2027-03-01', '22:00', '22:30')$q$);
SELECT pg_temp.expect_error('[close_attendance_session FT008] session has not ended yet',
  format($q$CALL close_attendance_session(%s, NULL, NULL)$q$, pg_temp.sess(1, '2027-03-01', '22:00')), 'FT008');
SELECT pg_temp.expect_error('[close_attendance_session FT002] session does not exist',
  $q$CALL close_attendance_session(99999, NULL, NULL)$q$, 'FT002');

-- =====================================================================
-- 6. HARDENING (migrations 001-003): resolved_at, token_version, login limits
-- =====================================================================
-- violations.resolved_at must be set exactly when a violation is resolved
SELECT pg_temp.expect_error('[resolved_at] resolving without a resolved_at is refused',
  $q$UPDATE violations SET status = 'resolved', resolved_by = 1 WHERE violation_id = 1$q$, '23514');
SELECT pg_temp.expect_error('[resolved_at] an open violation cannot have a resolved_at',
  $q$UPDATE violations SET resolved_at = localtimestamp WHERE violation_id = 3$q$, '23514');
SELECT pg_temp.expect_ok('[resolved_at] resolving with resolved_by and resolved_at works',
  $q$UPDATE violations SET status = 'resolved', resolved_by = 1, resolved_at = localtimestamp WHERE violation_id = 1$q$);
SELECT pg_temp.expect_value('[resolved_at] ...and the time is stored',
  $q$SELECT (resolved_at IS NOT NULL)::text FROM violations WHERE violation_id = 1$q$, 'true');
SELECT pg_temp.expect_value('[resolved_at] the violation resolved before the column existed has one (seed value or migration backfill)',
  $q$SELECT (resolved_at IS NOT NULL)::text FROM violations WHERE violation_id = 2$q$, 'true');
SELECT pg_temp.expect_value('[resolved_at] open violations have none',
  $q$SELECT count(*)::text FROM violations WHERE status = 'open' AND resolved_at IS NOT NULL$q$, '0');

-- users.token_version (session revocation)
SELECT pg_temp.expect_value('[token_version] starts at 0',
  $q$SELECT token_version::text FROM users WHERE user_id = 1$q$, '0');
SELECT pg_temp.expect_error('[token_version] cannot be NULL',
  $q$UPDATE users SET token_version = NULL WHERE user_id = 1$q$, '23502');
SELECT pg_temp.expect_value('[token_version] adding 1 changes it',
  $q$UPDATE users SET token_version = token_version + 1 WHERE user_id = 1 RETURNING token_version::text$q$, '1');

-- login rate limiting (login_attempts, login_retry_after, login_record)
SELECT pg_temp.expect_value('[login limit] a clean email is allowed',
  $q$SELECT login_retry_after('lock@x.test', '10.0.0.9')::text$q$, '0');
SELECT pg_temp.expect_ok('[login limit] record 4 failures',
  $q$SELECT login_record('lock@x.test', '10.0.0.9', false) FROM generate_series(1, 4)$q$);
SELECT pg_temp.expect_value('[login limit] 4 failures do not lock yet',
  $q$SELECT login_retry_after('lock@x.test', '10.0.0.9')::text$q$, '0');
SELECT pg_temp.expect_ok('[login limit] record the 5th failure',
  $q$SELECT login_record('lock@x.test', '10.0.0.9', false)$q$);
SELECT pg_temp.expect_value('[login limit] 5 failures lock the email for up to 15 minutes',
  $q$SELECT (login_retry_after('lock@x.test', '10.0.0.9') BETWEEN 1 AND 900)::text$q$, 'true');
SELECT pg_temp.expect_value('[login limit] the lock ignores letter case',
  $q$SELECT (login_retry_after('LOCK@X.test', '10.0.0.8') > 0)::text$q$, 'true');
SELECT pg_temp.expect_value('[login limit] another email from the same address is not locked',
  $q$SELECT login_retry_after('other@x.test', '10.0.0.9')::text$q$, '0');
SELECT pg_temp.expect_ok('[login limit] a successful login is recorded',
  $q$SELECT login_record('lock@x.test', '10.0.0.9', true)$q$);
SELECT pg_temp.expect_value('[login limit] ...and clears the email counter',
  $q$SELECT login_retry_after('lock@x.test', '10.0.0.9')::text$q$, '0');
SELECT pg_temp.expect_ok('[login limit] 5 failures for another email',
  $q$SELECT login_record('old@x.test', '10.0.0.5', false) FROM generate_series(1, 5)$q$);
SELECT pg_temp.expect_value('[login limit] that email is locked',
  $q$SELECT (login_retry_after('old@x.test', '10.0.0.5') > 0)::text$q$, 'true');
SELECT pg_temp.expect_ok('[login limit] 16 minutes pass',
  $q$UPDATE login_attempts SET attempted_at = attempted_at - interval '16 minutes' WHERE email = 'old@x.test'$q$);
SELECT pg_temp.expect_value('[login limit] the lock has expired',
  $q$SELECT login_retry_after('old@x.test', '10.0.0.5')::text$q$, '0');
SELECT pg_temp.expect_ok('[login limit] 5 failures for an email that exists and 5 for one that does not',
  $q$SELECT login_record(e, '10.0.0.3', false) FROM unnest(ARRAY['warden1@facetrack.test', 'nobody@x.test']) e, generate_series(1, 5)$q$);
SELECT pg_temp.expect_value('[login limit] known and unknown emails are locked the same way',
  $q$SELECT (login_retry_after('warden1@facetrack.test', '10.0.0.4') > 0 AND login_retry_after('nobody@x.test', '10.0.0.4') > 0)::text$q$, 'true');
SELECT pg_temp.expect_ok('[login limit] 20 failures from one address, 20 different emails',
  $q$SELECT login_record('u' || g || '@x.test', '10.0.0.77', false) FROM generate_series(1, 20) g$q$);
SELECT pg_temp.expect_value('[login limit] that address is locked for a new email',
  $q$SELECT (login_retry_after('fresh@x.test', '10.0.0.77') > 0)::text$q$, 'true');
SELECT pg_temp.expect_value('[login limit] another address is not',
  $q$SELECT login_retry_after('fresh@x.test', '10.0.0.78')::text$q$, '0');

\o

-- =====================================================================
-- REPORT
-- =====================================================================
\echo
\echo '=== TEST RESULTS ==='
SELECT n, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, label, expected, got
FROM test_results
ORDER BY n;

\echo
\echo '=== SUMMARY ==='
SELECT count(*) FILTER (WHERE passed)     AS passed,
       count(*) FILTER (WHERE NOT passed) AS failed,
       count(*)                           AS total
FROM test_results;

ROLLBACK;
\echo 'All test changes were rolled back: the database is unchanged.'
