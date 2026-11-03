-- =====================================================================
-- FaceTrackDB (Person B): demo data bookkeeping and removal.
-- Load after b_register.sql: ./db/load_b.sh. Safe to re-run; changes no existing table.
--
-- `npm run demo:seed` and `npm run demo:history` record the id of every row they CREATE DIRECTLY
-- in b_demo_rows. Rows that the stored procedures derive from those (attendance marks, violations)
-- are found again through the session, gate log or student they belong to. demo_reset() removes
-- exactly that set and nothing else, so real students, real scans, real face_profiles and the
-- sample data from seed.sql are left alone. There is no SQL way to tell a generated row from a real
-- one by looking at its columns: this table is the label.
--
-- kinds: student, face_event, gate_log, session, leave, hostel, gate, camera
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS b_demo_rows (
    kind    TEXT NOT NULL CHECK (kind IN ('student', 'face_event', 'gate_log', 'session', 'leave', 'hostel', 'gate', 'camera')),
    row_id  INT  NOT NULL,
    PRIMARY KEY (kind, row_id)
);

-- Removes every generated or seeded demo row, in an order that satisfies the foreign keys.
-- Returns one line per kind of thing removed. Face profiles are never touched (demo students have
-- none), so nothing in Qdrant needs to change. Calling it twice is harmless.
CREATE OR REPLACE FUNCTION demo_reset()
RETURNS TABLE (what TEXT, removed INT)
LANGUAGE plpgsql AS $$
DECLARE
    n         INT;
    v_student INT;
    v_parents INT := 0;
BEGIN
    DELETE FROM violations v
    WHERE v.log_id     IN (SELECT row_id FROM b_demo_rows WHERE kind = 'gate_log')
       OR v.session_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'session')
       OR v.student_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'student');
    GET DIAGNOSTICS n = ROW_COUNT; what := 'violations'; removed := n; RETURN NEXT;

    DELETE FROM attendance a
    WHERE a.session_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'session')
       OR a.student_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'student');
    GET DIAGNOSTICS n = ROW_COUNT; what := 'attendance marks'; removed := n; RETURN NEXT;

    DELETE FROM entry_exit_log l
    WHERE l.log_id     IN (SELECT row_id FROM b_demo_rows WHERE kind = 'gate_log')
       OR l.student_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'student');
    GET DIAGNOSTICS n = ROW_COUNT; what := 'gate log rows'; removed := n; RETURN NEXT;

    DELETE FROM face_events e
    WHERE e.event_id   IN (SELECT row_id FROM b_demo_rows WHERE kind = 'face_event')
       OR e.student_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'student');
    GET DIAGNOSTICS n = ROW_COUNT; what := 'face events'; removed := n; RETURN NEXT;

    DELETE FROM leave_requests l
    WHERE l.leave_id   IN (SELECT row_id FROM b_demo_rows WHERE kind = 'leave')
       OR l.student_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'student');
    GET DIAGNOSTICS n = ROW_COUNT; what := 'leave requests'; removed := n; RETURN NEXT;

    DELETE FROM attendance_sessions s WHERE s.session_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'session');
    GET DIAGNOSTICS n = ROW_COUNT; what := 'roll calls'; removed := n; RETURN NEXT;

    n := 0;
    FOR v_student IN SELECT row_id FROM b_demo_rows WHERE kind = 'student' ORDER BY row_id LOOP
        IF EXISTS (SELECT 1 FROM students WHERE student_id = v_student) THEN
            v_parents := v_parents + delete_student(v_student);   -- the student, their login, parents with no other ward
            n := n + 1;
        END IF;
    END LOOP;
    what := 'demo students (with their logins)'; removed := n; RETURN NEXT;
    what := 'parent logins'; removed := v_parents; RETURN NEXT;

    -- the extra hostel, gate and camera the seeder adds when the database has fewer than 3 hostels:
    -- removed only when nothing real uses them any more
    DELETE FROM cameras c WHERE c.camera_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'camera')
      AND NOT EXISTS (SELECT 1 FROM face_events e WHERE e.camera_id = c.camera_id);
    GET DIAGNOSTICS n = ROW_COUNT; what := 'demo cameras'; removed := n; RETURN NEXT;
    DELETE FROM gates g WHERE g.gate_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'gate')
      AND NOT EXISTS (SELECT 1 FROM cameras c WHERE c.gate_id = g.gate_id)
      AND NOT EXISTS (SELECT 1 FROM entry_exit_log l WHERE l.gate_id = g.gate_id);
    GET DIAGNOSTICS n = ROW_COUNT; what := 'demo gates'; removed := n; RETURN NEXT;
    DELETE FROM hostels h WHERE h.hostel_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'hostel')
      AND NOT EXISTS (SELECT 1 FROM students s WHERE s.hostel_id = h.hostel_id)
      AND NOT EXISTS (SELECT 1 FROM gates g WHERE g.hostel_id = h.hostel_id)
      AND NOT EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.hostel_id = h.hostel_id);
    GET DIAGNOSTICS n = ROW_COUNT; what := 'demo hostels'; removed := n; RETURN NEXT;

    DELETE FROM b_meta WHERE key IN ('generated_history', 'demo_seed');
    DELETE FROM b_demo_rows;
END $$;

COMMIT;
