-- =====================================================================
-- FaceTrackDB (Person B): registration, deletion rules, consent record and
-- roll-call session functions. Load after schema, triggers and procedures:
--   ./db/load_b.sh
-- Safe to re-run. It changes no existing table: it only adds b_consents and
-- functions. Passwords arrive here already hashed (bcrypt, cost 10, by the
-- app); this file never sees a plain password.
--
-- Error codes (SQLSTATE) raised here, mapped to fixed messages by the app:
--   FT050 student login email already used      FT051 SRN / roll number already used
--   FT052 parent email belongs to a non-parent  FT053 invalid registration input
--   FT054 hostel not found                      FT055 student has history, cannot delete
--   FT060 roll call overlaps another one        FT061 roll call date/time is in the past
-- =====================================================================

BEGIN;

-- Consent to store face data, one row per student (removed with the student).
CREATE TABLE IF NOT EXISTS b_consents (
    student_id   INT       PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    consented_at TIMESTAMP NOT NULL DEFAULT now(),
    recorded_by  INT       REFERENCES users(user_id)
);

-- ---------------------------------------------------------------------
-- register_student: one transaction creates the student's login, the student,
-- and one or two parents (login + parent row, or links an existing parent
-- account), plus the student_parent rows and the consent record.
--   p_student  {email, hash, roll_no, name, hostel_id, room_no}
--   p_parents  [{email, hash, name, phone, relation}, ...]  (1 or 2)
-- A parent whose email already belongs to a parent account is linked, not
-- duplicated (a parent can have several wards); the passed hash is ignored.
-- Returns {student_id, parents: [{parent_id, user_id, email, created}]}.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_student(
    p_student  JSONB,
    p_parents  JSONB,
    p_consent  BOOLEAN,
    p_admin_id INT)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
    v_email      TEXT := lower(btrim(p_student ->> 'email'));
    v_roll       TEXT := btrim(p_student ->> 'roll_no');
    v_user_id    INT;
    v_student_id INT;
    v_parent     JSONB;
    v_pemail     TEXT;
    v_prole      TEXT;
    v_puser      INT;
    v_pid        INT;
    v_created    BOOLEAN;
    v_seen       TEXT[] := ARRAY[v_email];
    v_out        JSONB := '[]'::jsonb;
BEGIN
    IF p_consent IS NOT TRUE THEN
        RAISE EXCEPTION 'Consent to store face data is required' USING ERRCODE = 'FT053';
    END IF;
    IF p_parents IS NULL OR jsonb_typeof(p_parents) <> 'array'
       OR jsonb_array_length(p_parents) NOT BETWEEN 1 AND 2 THEN
        RAISE EXCEPTION 'One or two parents are required' USING ERRCODE = 'FT053';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM hostels WHERE hostel_id = (p_student ->> 'hostel_id')::INT) THEN
        RAISE EXCEPTION 'Hostel not found' USING ERRCODE = 'FT054';
    END IF;
    IF EXISTS (SELECT 1 FROM users WHERE lower(email) = v_email) THEN
        RAISE EXCEPTION 'Student email already in use' USING ERRCODE = 'FT050';
    END IF;
    IF EXISTS (SELECT 1 FROM students WHERE upper(roll_no) = upper(v_roll)) THEN
        RAISE EXCEPTION 'SRN already in use' USING ERRCODE = 'FT051';
    END IF;

    INSERT INTO users (email, password_hash, role)
    VALUES (v_email, p_student ->> 'hash', 'student')
    RETURNING user_id INTO v_user_id;

    INSERT INTO students (user_id, roll_no, name, hostel_id, room_no)
    VALUES (v_user_id, v_roll, btrim(p_student ->> 'name'),
            (p_student ->> 'hostel_id')::INT, NULLIF(btrim(p_student ->> 'room_no'), ''))
    RETURNING student_id INTO v_student_id;

    FOR v_parent IN SELECT * FROM jsonb_array_elements(p_parents) LOOP
        v_pemail := lower(btrim(v_parent ->> 'email'));
        IF v_pemail = ANY (v_seen) THEN
            RAISE EXCEPTION 'The same email is used twice' USING ERRCODE = 'FT053';
        END IF;
        v_seen := v_seen || v_pemail;
        IF (v_parent ->> 'relation') IS NULL
           OR (v_parent ->> 'relation') NOT IN ('father', 'mother', 'guardian') THEN
            RAISE EXCEPTION 'Invalid parent relation' USING ERRCODE = 'FT053';
        END IF;

        SELECT user_id, role INTO v_puser, v_prole FROM users WHERE lower(email) = v_pemail;
        IF FOUND THEN
            IF v_prole <> 'parent' THEN
                RAISE EXCEPTION 'Parent email belongs to a non-parent account' USING ERRCODE = 'FT052';
            END IF;
            SELECT parent_id INTO v_pid FROM parents WHERE user_id = v_puser;
            v_created := FALSE;
        ELSE
            INSERT INTO users (email, password_hash, role)
            VALUES (v_pemail, v_parent ->> 'hash', 'parent')
            RETURNING user_id INTO v_puser;
            INSERT INTO parents (user_id, name, phone)
            VALUES (v_puser, btrim(v_parent ->> 'name'), NULLIF(btrim(v_parent ->> 'phone'), ''))
            RETURNING parent_id INTO v_pid;
            v_created := TRUE;
        END IF;

        INSERT INTO student_parent (student_id, parent_id, relation)
        VALUES (v_student_id, v_pid, v_parent ->> 'relation');

        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'parent_id', v_pid, 'user_id', v_puser, 'email', v_pemail, 'created', v_created));
    END LOOP;

    INSERT INTO b_consents (student_id, recorded_by) VALUES (v_student_id, p_admin_id);

    RETURN jsonb_build_object('student_id', v_student_id, 'user_id', v_user_id, 'parents', v_out);
END $$;

-- ---------------------------------------------------------------------
-- student_delete_blockers: why a student cannot be deleted (empty = can).
-- History that other records depend on is never deleted silently.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION student_delete_blockers(p_student_id INT)
RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM attendance      WHERE student_id = p_student_id) THEN 'attendance records' END,
        CASE WHEN EXISTS (SELECT 1 FROM entry_exit_log  WHERE student_id = p_student_id) THEN 'gate entry/exit records' END,
        CASE WHEN EXISTS (SELECT 1 FROM violations      WHERE student_id = p_student_id) THEN 'violations' END,
        CASE WHEN EXISTS (SELECT 1 FROM leave_requests  WHERE student_id = p_student_id) THEN 'leave requests' END,
        CASE WHEN EXISTS (SELECT 1 FROM face_events     WHERE student_id = p_student_id) THEN 'face scan events' END
    ], NULL);
$$;

-- ---------------------------------------------------------------------
-- delete_student: removes the student, their face profile rows, their login,
-- and any parent login that has no other ward. Refuses when there is history
-- (FT055). The app removes the Qdrant points in the same transaction.
-- Returns the number of parent logins removed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_student(p_student_id INT)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_user_id    INT;
    v_parents    INT[];
    v_pid        INT;
    v_puser      INT;
    v_removed    INT := 0;
BEGIN
    SELECT user_id INTO v_user_id FROM students WHERE student_id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found' USING ERRCODE = 'FT009';
    END IF;
    IF cardinality(student_delete_blockers(p_student_id)) > 0 THEN
        RAISE EXCEPTION 'Student has history' USING ERRCODE = 'FT055';
    END IF;

    SELECT array_agg(parent_id) INTO v_parents FROM student_parent WHERE student_id = p_student_id;

    DELETE FROM students WHERE student_id = p_student_id;  -- cascades face_profiles, student_parent, b_consents
    DELETE FROM users WHERE user_id = v_user_id;

    FOREACH v_pid IN ARRAY COALESCE(v_parents, ARRAY[]::INT[]) LOOP
        IF NOT EXISTS (SELECT 1 FROM student_parent WHERE parent_id = v_pid) THEN
            DELETE FROM parents WHERE parent_id = v_pid RETURNING user_id INTO v_puser;
            DELETE FROM users WHERE user_id = v_puser;
            v_removed := v_removed + 1;
        END IF;
    END LOOP;
    RETURN v_removed;
END $$;

-- ---------------------------------------------------------------------
-- create_attendance_session: a roll call for a hostel on a date between two
-- times. Rejects the past (FT061) and overlap with another roll call of the
-- same hostel and date (FT060). The table's own CHECK (end after start) and
-- UNIQUE (hostel, date, start) still apply. Creating two at once for one
-- hostel takes turns on an advisory lock, so they cannot both pass the check.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_attendance_session(
    p_hostel_id INT, p_date DATE, p_start TIME, p_end TIME)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_id INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM hostels WHERE hostel_id = p_hostel_id) THEN
        RAISE EXCEPTION 'Hostel not found' USING ERRCODE = 'FT054';
    END IF;
    IF (p_date + p_end) <= localtimestamp THEN
        RAISE EXCEPTION 'Roll call is in the past' USING ERRCODE = 'FT061';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('roll_call_slot'), p_hostel_id);
    IF EXISTS (SELECT 1 FROM attendance_sessions
               WHERE hostel_id = p_hostel_id AND session_date = p_date
                 AND p_start < end_time AND p_end > start_time) THEN
        RAISE EXCEPTION 'Roll call overlaps another one' USING ERRCODE = 'FT060';
    END IF;
    INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time)
    VALUES (p_hostel_id, p_date, p_start, p_end)
    RETURNING session_id INTO v_id;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- session_close_preview: what close_attendance_session would do right now:
-- students of the hostel with no attendance row become absent, and those
-- without approved leave that day also get a missed_attendance violation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION session_close_preview(p_session_id INT)
RETURNS TABLE (will_be_absent INT, will_get_violation INT)
LANGUAGE sql STABLE AS $$
    WITH s AS (SELECT * FROM attendance_sessions WHERE session_id = p_session_id),
    missing AS (
        SELECT st.student_id
        FROM s JOIN students st ON st.hostel_id = s.hostel_id
        WHERE NOT EXISTS (SELECT 1 FROM attendance a
                          WHERE a.session_id = s.session_id AND a.student_id = st.student_id)
    )
    SELECT (SELECT count(*) FROM missing)::INT,
           (SELECT count(*) FROM missing m, s
            WHERE NOT EXISTS (SELECT 1 FROM leave_requests l
                              WHERE l.student_id = m.student_id AND l.status = 'approved'
                                AND s.session_date BETWEEN l.start_date AND l.end_date))::INT;
$$;

COMMIT;
