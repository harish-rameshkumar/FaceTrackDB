-- =====================================================================
-- FaceTrackDB: triggers and supporting constraints (Phase 3)
-- Load order: settings.sql, schema.sql, seed.sql, triggers.sql, procedures.sql
-- Safe to re-run. Every rule here is enforced by the database itself,
-- so it holds no matter which code (or person) writes the data.
-- Custom error codes (SQLSTATE FTnnn) are listed in db/docs/phase3-logic.md
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Constraints that support the logic
-- ---------------------------------------------------------------------

-- A student cannot have two approved leaves with overlapping dates.
-- An exclusion constraint is used instead of a trigger because it stays
-- correct even when two parents approve at the same moment.
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_no_overlap;
ALTER TABLE leave_requests
    ADD CONSTRAINT leave_no_overlap
    EXCLUDE USING gist (
        student_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status = 'approved');

-- The same violation cannot be raised twice for the same gate event, or
-- for the same student and roll call.
DROP INDEX IF EXISTS ux_violation_log_type;
CREATE UNIQUE INDEX ux_violation_log_type
    ON violations (log_id, type) WHERE log_id IS NOT NULL;

DROP INDEX IF EXISTS ux_violation_session_type;
CREATE UNIQUE INDEX ux_violation_session_type
    ON violations (student_id, session_id, type) WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Trigger: a user id must belong to a user with the right role
--    Used on students, parents, face_events.reviewed_by and
--    violations.resolved_by. Arguments: column name, allowed roles.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_user_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_user_id INT;
    v_role    TEXT;
BEGIN
    v_user_id := (to_jsonb(NEW) ->> TG_ARGV[0])::INT;
    IF v_user_id IS NULL THEN
        RETURN NEW;                     -- optional column left empty
    END IF;

    SELECT role INTO v_role FROM users WHERE user_id = v_user_id;

    IF v_role IS NULL OR NOT (v_role = ANY (string_to_array(TG_ARGV[1], ','))) THEN
        RAISE EXCEPTION 'User % has role %, but %.% needs a user with role: %',
            v_user_id, COALESCE(v_role, 'none'), TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1]
            USING ERRCODE = 'FT040';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_students_role ON students;
CREATE TRIGGER trg_students_role
    BEFORE INSERT OR UPDATE OF user_id ON students
    FOR EACH ROW EXECUTE FUNCTION fn_check_user_role('user_id', 'student');

DROP TRIGGER IF EXISTS trg_parents_role ON parents;
CREATE TRIGGER trg_parents_role
    BEFORE INSERT OR UPDATE OF user_id ON parents
    FOR EACH ROW EXECUTE FUNCTION fn_check_user_role('user_id', 'parent');

DROP TRIGGER IF EXISTS trg_face_events_reviewer_role ON face_events;
CREATE TRIGGER trg_face_events_reviewer_role
    BEFORE INSERT OR UPDATE OF reviewed_by ON face_events
    FOR EACH ROW EXECUTE FUNCTION fn_check_user_role('reviewed_by', 'warden,admin');

DROP TRIGGER IF EXISTS trg_violations_resolver_role ON violations;
CREATE TRIGGER trg_violations_resolver_role
    BEFORE INSERT OR UPDATE OF resolved_by ON violations
    FOR EACH ROW EXECUTE FUNCTION fn_check_user_role('resolved_by', 'warden,admin');

-- ---------------------------------------------------------------------
-- 3. Trigger: attendance rules
--    * the student must live in the session's hostel
--    * a present/low_confidence mark must fall inside the session window
--    * a present mark can never be downgraded
--    (duplicate rows are blocked by the primary key on session+student)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_attendance_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_hostel INT;
    v_sess   attendance_sessions%ROWTYPE;
BEGIN
    SELECT hostel_id INTO v_hostel FROM students WHERE student_id = NEW.student_id;
    SELECT * INTO v_sess FROM attendance_sessions WHERE session_id = NEW.session_id;

    IF v_sess.session_id IS NULL THEN
        RETURN NEW;                     -- foreign key reports the bad session
    END IF;

    IF v_hostel IS DISTINCT FROM v_sess.hostel_id THEN
        RAISE EXCEPTION 'Student % does not live in the hostel of session %',
            NEW.student_id, NEW.session_id USING ERRCODE = 'FT003';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'present' AND NEW.status <> 'present' THEN
        RAISE EXCEPTION 'Attendance of student % in session % is present and cannot be changed to %',
            NEW.student_id, NEW.session_id, NEW.status USING ERRCODE = 'FT005';
    END IF;

    IF NEW.status <> 'absent'
       AND (TG_OP = 'INSERT' OR NEW.marked_at IS DISTINCT FROM OLD.marked_at) THEN
        IF NEW.marked_at::date <> v_sess.session_date
           OR NEW.marked_at::time NOT BETWEEN v_sess.start_time AND v_sess.end_time THEN
            RAISE EXCEPTION 'Mark time % is outside session % (% % to %)',
                NEW.marked_at, NEW.session_id, v_sess.session_date,
                v_sess.start_time, v_sess.end_time USING ERRCODE = 'FT004';
        END IF;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_attendance_validate ON attendance;
CREATE TRIGGER trg_attendance_validate
    BEFORE INSERT OR UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION fn_attendance_validate();

-- ---------------------------------------------------------------------
-- 4. Trigger: leave rules
--    * a decided request (approved/rejected) is final
--    * a request that has already ended cannot be approved
--    (overlaps are blocked by the exclusion constraint above)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_leave_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'Leave request % is already % and cannot be changed',
            OLD.leave_id, OLD.status USING ERRCODE = 'FT010';
    END IF;

    IF NEW.status = 'approved' AND NEW.end_date < current_date THEN
        RAISE EXCEPTION 'Leave request % ended on % and can no longer be approved',
            NEW.leave_id, NEW.end_date USING ERRCODE = 'FT011';
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leave_guard ON leave_requests;
CREATE TRIGGER trg_leave_guard
    BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION fn_leave_guard();

-- ---------------------------------------------------------------------
-- 5. Trigger: gate log rules
--    * the gate must belong to the student's hostel
--    * events must arrive in time order for each student
--    * directions must alternate (no OUT twice in a row)
--    A per-student advisory lock makes two simultaneous scans of the
--    same student take turns, so the alternation check cannot be raced.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_entry_exit_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_student_hostel INT;
    v_gate_hostel    INT;
    v_last           entry_exit_log%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(7001, NEW.student_id);

    SELECT hostel_id INTO v_student_hostel FROM students WHERE student_id = NEW.student_id;
    SELECT hostel_id INTO v_gate_hostel    FROM gates    WHERE gate_id    = NEW.gate_id;

    IF v_student_hostel IS DISTINCT FROM v_gate_hostel THEN
        RAISE EXCEPTION 'Gate % does not belong to the hostel of student %',
            NEW.gate_id, NEW.student_id USING ERRCODE = 'FT021';
    END IF;

    SELECT * INTO v_last
    FROM entry_exit_log
    WHERE student_id = NEW.student_id
    ORDER BY event_time DESC, log_id DESC
    LIMIT 1;

    IF FOUND THEN
        IF NEW.event_time <= v_last.event_time THEN
            RAISE EXCEPTION 'Event at % is not after the last gate event of student % (%)',
                NEW.event_time, NEW.student_id, v_last.event_time USING ERRCODE = 'FT023';
        END IF;
        IF NEW.direction = v_last.direction THEN
            RAISE EXCEPTION 'Student % is already marked % (since %)',
                NEW.student_id, v_last.direction, v_last.event_time USING ERRCODE = 'FT022';
        END IF;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_entry_exit_validate ON entry_exit_log;
CREATE TRIGGER trg_entry_exit_validate
    BEFORE INSERT ON entry_exit_log
    FOR EACH ROW EXECUTE FUNCTION fn_entry_exit_validate();

COMMIT;
