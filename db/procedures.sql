-- =====================================================================
-- FaceTrackDB: stored procedures (Phase 3)
-- Load after triggers.sql. Safe to re-run.
--
-- How the app calls them (OUT parameters are passed as NULL):
--   CALL mark_attendance(student_id, session_id, event_id, NULL);
--   CALL record_entry_exit(student_id, gate_id, event_id, 'IN'|'OUT', NULL, NULL);
--   CALL close_attendance_session(session_id, NULL, NULL);
--   CALL decide_leave(leave_id, parent_id, 'approved'|'rejected');
--
-- Each CALL runs as one transaction: if any step raises an error,
-- everything the procedure did is undone. Expected business problems
-- are raised as errors with a custom SQLSTATE (FTnnn) so the app can
-- map them to HTTP responses. See db/docs/phase3-logic.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- mark_attendance: record one student's roll-call result
--   p_event_id is the face_events row from the matching endpoint
--   (NULL means a warden marked the student manually).
--   OUT p_status: 'present' or 'low_confidence'
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS mark_attendance;
CREATE PROCEDURE mark_attendance(
    p_student_id INT,
    p_session_id INT,
    p_event_id   INT,
    OUT p_status TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_event    face_events%ROWTYPE;
    v_marked   TIMESTAMP;
    v_rows     INT;
    v_existing TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM students WHERE student_id = p_student_id) THEN
        RAISE EXCEPTION 'Student % not found', p_student_id USING ERRCODE = 'FT009';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM attendance_sessions WHERE session_id = p_session_id) THEN
        RAISE EXCEPTION 'Attendance session % not found', p_session_id USING ERRCODE = 'FT002';
    END IF;

    IF p_event_id IS NULL THEN
        v_marked := localtimestamp;                     -- manual mark
        p_status := 'present';
    ELSE
        SELECT * INTO v_event FROM face_events WHERE event_id = p_event_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Face event % not found', p_event_id USING ERRCODE = 'FT006';
        END IF;
        IF v_event.student_id IS DISTINCT FROM p_student_id THEN
            RAISE EXCEPTION 'Face event % does not belong to student %',
                p_event_id, p_student_id USING ERRCODE = 'FT007';
        END IF;
        v_marked := v_event.event_time;
        p_status := CASE v_event.outcome WHEN 'matched' THEN 'present'
                                         ELSE 'low_confidence' END;
    END IF;

    -- The window and hostel checks run in the attendance trigger.
    -- ON CONFLICT makes two simultaneous scans safe: the second one waits
    -- for the first to commit, then inserts nothing and reports a duplicate.
    INSERT INTO attendance (session_id, student_id, event_id, status, marked_at)
    VALUES (p_session_id, p_student_id, p_event_id, p_status, v_marked)
    ON CONFLICT (session_id, student_id) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        SELECT status INTO v_existing
        FROM attendance
        WHERE session_id = p_session_id AND student_id = p_student_id;
        RAISE EXCEPTION 'Student % already has attendance for session % (%)',
            p_student_id, p_session_id, v_existing USING ERRCODE = 'FT001';
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- record_entry_exit: record a gate crossing and apply the hostel rules
--   Rules (change the constants to change the policy):
--     * leaving at or after 20:00 (or before 05:00) needs approved leave
--     * returning at or after 22:30 (or before 05:00) is a late return
--     * a student with approved leave covering that date is never flagged
--   The log row and any violation are written together or not at all.
--   OUT p_log_id: the new log row
--   OUT p_violation_type: 'late_return', 'no_leave' or NULL
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS record_entry_exit;
CREATE PROCEDURE record_entry_exit(
    p_student_id INT,
    p_gate_id    INT,
    p_event_id   INT,
    p_direction  TEXT,
    OUT p_log_id         INT,
    OUT p_violation_type TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    c_curfew     CONSTANT TIME := '22:30';
    c_exit_limit CONSTANT TIME := '20:00';
    c_night_end  CONSTANT TIME := '05:00';
    v_event      face_events%ROWTYPE;
    v_camera_gate INT;
    v_when       TIMESTAMP;
    v_time       TIME;
    v_on_leave   BOOLEAN;
BEGIN
    IF p_direction NOT IN ('IN', 'OUT') THEN
        RAISE EXCEPTION 'Direction must be IN or OUT, got %', p_direction
            USING ERRCODE = 'FT020';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM students WHERE student_id = p_student_id) THEN
        RAISE EXCEPTION 'Student % not found', p_student_id USING ERRCODE = 'FT009';
    END IF;

    IF p_event_id IS NULL THEN
        v_when := localtimestamp;                       -- manual entry by security
    ELSE
        SELECT * INTO v_event FROM face_events WHERE event_id = p_event_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Face event % not found', p_event_id USING ERRCODE = 'FT006';
        END IF;
        IF v_event.student_id IS DISTINCT FROM p_student_id THEN
            RAISE EXCEPTION 'Face event % does not belong to student %',
                p_event_id, p_student_id USING ERRCODE = 'FT007';
        END IF;
        SELECT gate_id INTO v_camera_gate FROM cameras WHERE camera_id = v_event.camera_id;
        IF v_camera_gate IS DISTINCT FROM p_gate_id THEN
            RAISE EXCEPTION 'Face event % was captured at gate %, not gate %',
                p_event_id, v_camera_gate, p_gate_id USING ERRCODE = 'FT024';
        END IF;
        v_when := v_event.event_time;
    END IF;

    -- gate, ordering and alternation checks run in the entry_exit_log trigger
    INSERT INTO entry_exit_log (student_id, gate_id, event_id, direction, event_time)
    VALUES (p_student_id, p_gate_id, p_event_id, p_direction, v_when)
    RETURNING log_id INTO p_log_id;

    v_time := v_when::time;

    SELECT EXISTS (
        SELECT 1 FROM leave_requests l
        WHERE l.student_id = p_student_id
          AND l.status = 'approved'
          AND v_when::date BETWEEN l.start_date AND l.end_date
    ) INTO v_on_leave;

    IF NOT v_on_leave THEN
        IF p_direction = 'IN' AND (v_time >= c_curfew OR v_time < c_night_end) THEN
            p_violation_type := 'late_return';
        ELSIF p_direction = 'OUT' AND (v_time >= c_exit_limit OR v_time < c_night_end) THEN
            p_violation_type := 'no_leave';
        END IF;
    END IF;

    IF p_violation_type IS NOT NULL THEN
        INSERT INTO violations (student_id, log_id, type, details)
        VALUES (
            p_student_id, p_log_id, p_violation_type,
            CASE p_violation_type
                WHEN 'late_return' THEN format(
                    'Returned at %s, after the %s curfew, without approved leave',
                    to_char(v_when, 'HH24:MI'), substr(c_curfew::text, 1, 5))
                ELSE format(
                    'Left the hostel at %s without approved leave',
                    to_char(v_when, 'HH24:MI'))
            END);
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- close_attendance_session: after a roll call ends, mark everyone who
--   did not scan as absent, and raise a missed_attendance violation for
--   each of them who has no approved leave that day. Safe to call twice.
--   OUT p_absent: students newly marked absent
--   OUT p_violations: violations raised
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS close_attendance_session;
CREATE PROCEDURE close_attendance_session(
    p_session_id INT,
    OUT p_absent     INT,
    OUT p_violations INT)
LANGUAGE plpgsql AS $$
DECLARE
    v_sess attendance_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_sess
    FROM attendance_sessions
    WHERE session_id = p_session_id
    FOR UPDATE;                                   -- one closer at a time

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % not found', p_session_id
            USING ERRCODE = 'FT002';
    END IF;
    IF (v_sess.session_date + v_sess.end_time) > localtimestamp THEN
        RAISE EXCEPTION 'Session % has not ended yet', p_session_id
            USING ERRCODE = 'FT008';
    END IF;

    WITH new_absent AS (
        INSERT INTO attendance (session_id, student_id, status, marked_at)
        SELECT v_sess.session_id, s.student_id, 'absent',
               v_sess.session_date + v_sess.end_time
        FROM students s
        WHERE s.hostel_id = v_sess.hostel_id
          AND NOT EXISTS (
                SELECT 1 FROM attendance a
                WHERE a.session_id = v_sess.session_id
                  AND a.student_id = s.student_id)
        RETURNING student_id
    ), new_violations AS (
        INSERT INTO violations (student_id, session_id, type, details)
        SELECT n.student_id, v_sess.session_id, 'missed_attendance',
               'Absent at the roll call on ' || to_char(v_sess.session_date, 'DD Mon YYYY')
        FROM new_absent n
        WHERE NOT EXISTS (
                SELECT 1 FROM leave_requests l
                WHERE l.student_id = n.student_id
                  AND l.status = 'approved'
                  AND v_sess.session_date BETWEEN l.start_date AND l.end_date)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM new_absent),
           (SELECT count(*) FROM new_violations)
    INTO p_absent, p_violations;
END $$;

-- ---------------------------------------------------------------------
-- decide_leave: a parent approves or rejects a pending leave request
--   Only a parent linked to the student may decide, a request can be
--   decided once, and approved dates cannot overlap another approved leave.
--   Two parents deciding at the same moment take turns: the second one
--   gets "already decided".
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS decide_leave;
CREATE PROCEDURE decide_leave(
    p_leave_id  INT,
    p_parent_id INT,
    p_decision  TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_leave leave_requests%ROWTYPE;
BEGIN
    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be approved or rejected, got %', p_decision
            USING ERRCODE = 'FT030';
    END IF;

    SELECT * INTO v_leave
    FROM leave_requests
    WHERE leave_id = p_leave_id
    FOR UPDATE;                                   -- serialises competing deciders

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Leave request % not found', p_leave_id USING ERRCODE = 'FT031';
    END IF;
    IF v_leave.status <> 'pending' THEN
        RAISE EXCEPTION 'Leave request % was already %', p_leave_id, v_leave.status
            USING ERRCODE = 'FT032';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM student_parent
                   WHERE student_id = v_leave.student_id AND parent_id = p_parent_id) THEN
        RAISE EXCEPTION 'Parent % is not a parent of student %',
            p_parent_id, v_leave.student_id USING ERRCODE = 'FT033';
    END IF;

    BEGIN
        UPDATE leave_requests
        SET status = p_decision, decided_by = p_parent_id, decided_at = localtimestamp
        WHERE leave_id = p_leave_id;
    EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'Leave request % overlaps another approved leave of student %',
            p_leave_id, v_leave.student_id USING ERRCODE = 'FT034';
    END;
END $$;

-- ---------------------------------------------------------------------
-- Login rate limiting (table login_attempts). Used by POST /api/login.
--   login_retry_after(email, ip): seconds to wait, 0 = may try.
--     5 failures per email within 15 minutes, or 20 per IP, lock; a successful
--     login clears the email's counter.
--   login_record(email, ip, succeeded): records one evaluated attempt.
-- The same text lives in db/migrations/003_login_attempts.sql (for databases that
-- must not be reloaded); db/test_cases.sql checks both.
-- ---------------------------------------------------------------------
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
