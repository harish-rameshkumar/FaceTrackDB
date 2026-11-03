-- =====================================================================
-- FaceTrackDB: PostgreSQL schema (Phase 2)
-- Run this file first, then seed.sql.
-- It drops and recreates everything, so it is safe to re-run in
-- development. Never run it against data you want to keep.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. DROP (children first, so foreign keys never block the drop)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS login_attempts      CASCADE;
DROP TABLE IF EXISTS violations          CASCADE;
DROP TABLE IF EXISTS leave_requests      CASCADE;
DROP TABLE IF EXISTS entry_exit_log      CASCADE;
DROP TABLE IF EXISTS attendance          CASCADE;
DROP TABLE IF EXISTS attendance_sessions CASCADE;
DROP TABLE IF EXISTS face_events         CASCADE;
DROP TABLE IF EXISTS face_profiles       CASCADE;
DROP TABLE IF EXISTS cameras             CASCADE;
DROP TABLE IF EXISTS gates               CASCADE;
DROP TABLE IF EXISTS student_parent      CASCADE;
DROP TABLE IF EXISTS parents             CASCADE;
DROP TABLE IF EXISTS students            CASCADE;
DROP TABLE IF EXISTS users               CASCADE;
DROP TABLE IF EXISTS hostels             CASCADE;

-- ---------------------------------------------------------------------
-- 1. CREATE: people and hostel structure
-- ---------------------------------------------------------------------
CREATE TABLE hostels (
    hostel_id  SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    email          VARCHAR(255) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(20)  NOT NULL
                   CHECK (role IN ('student', 'parent', 'warden', 'security', 'admin')),
    created_at     TIMESTAMP    NOT NULL DEFAULT now(),
    -- session revocation: a login token is valid only while its version matches
    -- (db/migrations/002_users_token_version.sql adds this to existing databases)
    token_version  INT          NOT NULL DEFAULT 0,
    CONSTRAINT users_email_format CHECK (email LIKE '%_@_%')
);

CREATE TABLE students (
    student_id  SERIAL PRIMARY KEY,
    user_id     INT          NOT NULL UNIQUE REFERENCES users(user_id),
    roll_no     VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    hostel_id   INT          NOT NULL REFERENCES hostels(hostel_id),
    room_no     VARCHAR(10)
);

CREATE TABLE parents (
    parent_id  SERIAL PRIMARY KEY,
    user_id    INT          NOT NULL UNIQUE REFERENCES users(user_id),
    name       VARCHAR(100) NOT NULL,
    phone      VARCHAR(15)
);

CREATE TABLE student_parent (
    student_id  INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    parent_id   INT NOT NULL REFERENCES parents(parent_id)   ON DELETE CASCADE,
    relation    VARCHAR(20) CHECK (relation IN ('father', 'mother', 'guardian')),
    PRIMARY KEY (student_id, parent_id)
);

CREATE TABLE gates (
    gate_id    SERIAL PRIMARY KEY,
    hostel_id  INT         NOT NULL REFERENCES hostels(hostel_id),
    name       VARCHAR(50) NOT NULL
);

CREATE TABLE cameras (
    camera_id  SERIAL PRIMARY KEY,
    gate_id    INT          NOT NULL REFERENCES gates(gate_id),
    location   VARCHAR(100),
    status     VARCHAR(15)  NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'inactive'))
);

-- ---------------------------------------------------------------------
-- 2. CREATE: face recognition records (link to Qdrant)
-- ---------------------------------------------------------------------
-- One row per enrolled image; qdrant_point_id is the id of its vector.
CREATE TABLE face_profiles (
    profile_id       SERIAL PRIMARY KEY,
    student_id       INT       NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    qdrant_point_id  UUID      NOT NULL UNIQUE,
    enrolled_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- One row per recognition attempt, whatever the outcome.
CREATE TABLE face_events (
    event_id     SERIAL PRIMARY KEY,
    camera_id    INT           NOT NULL REFERENCES cameras(camera_id),
    student_id   INT           REFERENCES students(student_id),
    confidence   NUMERIC(4,3)  CHECK (confidence BETWEEN 0 AND 1),
    outcome      VARCHAR(20)   NOT NULL
                 CHECK (outcome IN ('matched', 'low_confidence', 'no_match')),
    event_time   TIMESTAMP     NOT NULL DEFAULT now(),
    reviewed_by  INT           REFERENCES users(user_id),
    -- a no_match has no student; matched and low_confidence always have one
    CONSTRAINT face_events_student_matches_outcome
        CHECK ((outcome = 'no_match') = (student_id IS NULL)),
    -- lets other tables prove "this event belongs to this student"
    CONSTRAINT face_events_event_student_uq UNIQUE (event_id, student_id)
);

-- ---------------------------------------------------------------------
-- 3. CREATE: attendance, gate log, leave, violations
-- ---------------------------------------------------------------------
CREATE TABLE attendance_sessions (
    session_id    SERIAL PRIMARY KEY,
    hostel_id     INT  NOT NULL REFERENCES hostels(hostel_id),
    session_date  DATE NOT NULL,
    start_time    TIME NOT NULL,
    end_time      TIME NOT NULL,
    CONSTRAINT sessions_time_order CHECK (end_time > start_time),
    CONSTRAINT sessions_slot_uq    UNIQUE (hostel_id, session_date, start_time)
);

CREATE TABLE attendance (
    session_id  INT         NOT NULL REFERENCES attendance_sessions(session_id),
    student_id  INT         NOT NULL REFERENCES students(student_id),
    event_id    INT,
    status      VARCHAR(20) NOT NULL
                CHECK (status IN ('present', 'absent', 'low_confidence')),
    marked_at   TIMESTAMP,
    PRIMARY KEY (session_id, student_id),   -- one row per student per session
    -- the face event, if any, must be this student's own event
    CONSTRAINT attendance_event_fk
        FOREIGN KEY (event_id, student_id)
        REFERENCES face_events (event_id, student_id),
    CONSTRAINT attendance_marked_has_time
        CHECK (status = 'absent' OR marked_at IS NOT NULL)
);

CREATE TABLE entry_exit_log (
    log_id      SERIAL PRIMARY KEY,
    student_id  INT        NOT NULL REFERENCES students(student_id),
    gate_id     INT        NOT NULL REFERENCES gates(gate_id),
    event_id    INT,
    direction   VARCHAR(3) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    event_time  TIMESTAMP  NOT NULL DEFAULT now(),
    CONSTRAINT log_event_fk
        FOREIGN KEY (event_id, student_id)
        REFERENCES face_events (event_id, student_id),
    -- lets violations prove "this log row belongs to this student"
    CONSTRAINT log_id_student_uq UNIQUE (log_id, student_id)
);

CREATE TABLE leave_requests (
    leave_id    SERIAL PRIMARY KEY,
    student_id  INT         NOT NULL REFERENCES students(student_id),
    start_date  DATE        NOT NULL,
    end_date    DATE        NOT NULL,
    reason      TEXT,
    status      VARCHAR(15) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by  INT,
    decided_at  TIMESTAMP,
    CONSTRAINT leave_dates_order CHECK (end_date >= start_date),
    -- pending means undecided; approved/rejected need who and when
    CONSTRAINT leave_decision_consistent CHECK (
        (status = 'pending'  AND decided_by IS NULL     AND decided_at IS NULL)
     OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
    -- only a parent linked to this student can decide the request
    CONSTRAINT leave_decider_is_parent
        FOREIGN KEY (student_id, decided_by)
        REFERENCES student_parent (student_id, parent_id)
);

CREATE TABLE violations (
    violation_id  SERIAL PRIMARY KEY,
    student_id    INT         NOT NULL REFERENCES students(student_id),
    log_id        INT,
    session_id    INT         REFERENCES attendance_sessions(session_id),
    type          VARCHAR(30) NOT NULL
                  CHECK (type IN ('late_return', 'missed_attendance', 'no_leave')),
    details       TEXT,
    raised_at     TIMESTAMP   NOT NULL DEFAULT now(),
    status        VARCHAR(15) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'resolved')),
    resolved_by   INT         REFERENCES users(user_id),
    -- when it was resolved (db/migrations/001_violations_resolved_at.sql adds this
    -- to existing databases and backfills older resolved rows with raised_at)
    resolved_at   TIMESTAMP,
    -- the gate log row, if any, must be this student's own row
    CONSTRAINT violations_log_fk
        FOREIGN KEY (log_id, student_id)
        REFERENCES entry_exit_log (log_id, student_id),
    -- a violation must point at what caused it
    CONSTRAINT violations_has_source
        CHECK (log_id IS NOT NULL OR session_id IS NOT NULL),
    -- resolved if and only if someone resolved it
    CONSTRAINT violations_resolution
        CHECK ((status = 'resolved') = (resolved_by IS NOT NULL)),
    CONSTRAINT violations_resolved_at_consistent
        CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

-- Login attempts, for rate limiting (functions login_retry_after / login_record in
-- procedures.sql; db/migrations/003_login_attempts.sql adds this to existing databases).
CREATE TABLE login_attempts (
    attempt_id    BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    ip            VARCHAR(64)  NOT NULL,
    succeeded     BOOLEAN      NOT NULL,
    attempted_at  TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, attempted_at DESC);
CREATE INDEX idx_login_attempts_ip_time    ON login_attempts (ip, attempted_at DESC);

-- ---------------------------------------------------------------------
-- 4. INDEXES
-- PostgreSQL indexes primary keys and UNIQUE columns automatically, but
-- NOT foreign keys. These cover the lookups the app will run most often.
-- (Phase 5: show EXPLAIN before/after by dropping one and re-running.)
-- ---------------------------------------------------------------------
CREATE INDEX idx_students_hostel         ON students (hostel_id);
CREATE INDEX idx_gates_hostel            ON gates (hostel_id);
CREATE INDEX idx_cameras_gate            ON cameras (gate_id);
CREATE INDEX idx_face_profiles_student   ON face_profiles (student_id);

-- recent recognition events for one student
CREATE INDEX idx_face_events_student_time ON face_events (student_id, event_time DESC);
-- warden queue: low-confidence events nobody has reviewed yet (partial index)
CREATE INDEX idx_face_events_review_queue ON face_events (event_time)
    WHERE outcome = 'low_confidence' AND reviewed_by IS NULL;

-- one student's attendance history (the primary key starts with session_id)
CREATE INDEX idx_attendance_student      ON attendance (student_id, session_id);

-- gate log: per student over time, and per gate over time
CREATE INDEX idx_log_student_time        ON entry_exit_log (student_id, event_time DESC);
CREATE INDEX idx_log_gate_time           ON entry_exit_log (gate_id, event_time DESC);

-- "does this student have approved leave covering this date?" (partial index)
CREATE INDEX idx_leave_approved_dates    ON leave_requests (student_id, start_date, end_date)
    WHERE status = 'approved';

CREATE INDEX idx_violations_student      ON violations (student_id, raised_at DESC);
CREATE INDEX idx_violations_open         ON violations (type, raised_at)
    WHERE status = 'open';

-- ---------------------------------------------------------------------
-- 5. ALTER: constraints added after the tables exist
-- ---------------------------------------------------------------------
ALTER TABLE parents
    ADD CONSTRAINT parents_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{10,14}$');

ALTER TABLE gates
    ADD CONSTRAINT gates_name_per_hostel_uq UNIQUE (hostel_id, name);

-- ---------------------------------------------------------------------
-- 6. ROLES, GRANTS AND ROW-LEVEL SECURITY
-- This section is a copy of db/migrations/004_rbac.sql (keep them identical; db/rbac_tests.sql tests the result).
-- Objects that do not exist yet at this point (procedures, the b_*.sql objects) are skipped here and granted when
-- the migration runs again (db/migrate.sh, then db/load_b.sh).
-- ---------------------------------------------------------------------
-- 004: database-level role-based access control (roles, GRANT/REVOKE, row-level security).
-- Safe to run more than once. Run it as the OWNER of the tables (the Docker POSTGRES_USER); migrations,
-- seeding, the demo scripts and the SQL tests keep using the owner, which bypasses row-level security.
-- The same core text is mirrored at the end of db/schema.sql for fresh loads; load_b.sh runs this file again
-- after the Person B objects (b_*.sql) exist, so they get their grants too.
--
-- Roles (all NOLOGIN, they are only ever entered with SET ROLE):
--   ft_student  own attendance, gate rows, leave and violations; may create and cancel own pending leave
--   ft_parent   the same for linked children; may decide their leave through decide_leave
--   ft_warden   dashboard, search, roll calls, review queue, violations, reports
--   ft_security the gate: scans (face events, attendance, gate log)
--   ft_admin    everything staff can do plus registering and deleting students, face samples, sign-out everywhere
--   ft_app      the LOGIN role the web app connects as. NOT a superuser, no BYPASSRLS. On its own it can only do what
--               login needs; it may SET ROLE to any ft_* role, and it INHERITS the three staff roles (see README
--               "Database roles": staff routes that are not wrapped in withRole run with those combined rights).
-- The request's role and user id reach the database as SET LOCAL ROLE and set_config('app.user_id', ...) in
-- app/lib/db.ts (withRole); the row-level policies read app.user_id. No SECURITY DEFINER functions are used.
-- ft_app has no password here (never keep one in a file): set it with  ALTER ROLE ft_app PASSWORD '...'  (see README).

CREATE OR REPLACE FUNCTION pg_temp.ensure_role(p_name TEXT, p_login BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_name) THEN
        EXECUTE format('CREATE ROLE %I %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', p_name,
                       CASE WHEN p_login THEN 'LOGIN NOINHERIT' ELSE 'NOLOGIN' END);
    END IF;
END $$;
DO $$
BEGIN
    PERFORM pg_temp.ensure_role('ft_student', false), pg_temp.ensure_role('ft_parent', false), pg_temp.ensure_role('ft_warden', false),
            pg_temp.ensure_role('ft_security', false), pg_temp.ensure_role('ft_admin', false), pg_temp.ensure_role('ft_app', true);
END $$;

-- ft_app may enter every role. It inherits the staff roles' rights; for student and parent it must switch (SET ROLE) to use them.
GRANT ft_warden, ft_security, ft_admin TO ft_app WITH INHERIT TRUE, SET TRUE;
GRANT ft_student, ft_parent TO ft_app WITH INHERIT FALSE, SET TRUE;

CREATE OR REPLACE FUNCTION pg_temp.gp(p_sig TEXT, p_stmt TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN   -- same, for functions and procedures (given with their argument types)
    IF to_regprocedure(p_sig) IS NOT NULL THEN EXECUTE p_stmt; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.g(p_obj TEXT, p_stmt TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN   -- grants only when a table or view exists (the Person B objects are created after the migrations on a fresh load)
    IF to_regclass(p_obj) IS NOT NULL THEN EXECUTE p_stmt; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Nothing for PUBLIC
-- ---------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ft_student, ft_parent, ft_warden, ft_security, ft_admin, ft_app;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
DO $$
DECLARE r RECORD;
BEGIN   -- our own functions and procedures only (extension functions, such as btree_gist, are left alone)
    FOR r IN SELECT p.oid::regprocedure AS sig, p.prokind FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP
        EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC', CASE WHEN r.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.sig);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Row-level security helpers: who is asking (set by app/lib/db.ts for every wrapped request)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ft_current_user_id() RETURNS INT LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::INT $$;
CREATE OR REPLACE FUNCTION ft_current_student_id() RETURNS INT LANGUAGE sql STABLE AS
$$ SELECT student_id FROM students WHERE user_id = ft_current_user_id() $$;
CREATE OR REPLACE FUNCTION ft_current_parent_id() RETURNS INT LANGUAGE sql STABLE AS
$$ SELECT parent_id FROM parents WHERE user_id = ft_current_user_id() $$;
GRANT EXECUTE ON FUNCTION ft_current_user_id(), ft_current_student_id(), ft_current_parent_id()
    TO ft_student, ft_parent, ft_warden, ft_security, ft_admin, ft_app;

-- ---------------------------------------------------------------------
-- 3. Table rights (column lists keep password hashes and token versions away from every ft_* role except ft_app)
-- ---------------------------------------------------------------------
-- the login role: what sign-in, /api/me and password change need, and nothing about the personal data tables
GRANT SELECT (user_id, email, password_hash, role, token_version, created_at), UPDATE (password_hash, token_version) ON users TO ft_app;
GRANT SELECT (student_id, user_id, name) ON students TO ft_app;
GRANT SELECT (parent_id, user_id, name) ON parents TO ft_app;
GRANT SELECT, INSERT, DELETE ON login_attempts TO ft_app;
GRANT USAGE ON SEQUENCE login_attempts_attempt_id_seq TO ft_app;
DO $$
BEGIN
    PERFORM pg_temp.gp('login_retry_after(text,text)', 'GRANT EXECUTE ON FUNCTION login_retry_after(TEXT, TEXT) TO ft_app');
    PERFORM pg_temp.gp('login_record(text,text,boolean)', 'GRANT EXECUTE ON FUNCTION login_record(TEXT, TEXT, BOOLEAN) TO ft_app');
END $$;

-- reference data everybody signed in may read
GRANT SELECT (hostel_id, name) ON hostels TO ft_student, ft_parent, ft_warden, ft_security, ft_admin;
GRANT SELECT (gate_id, hostel_id, name) ON gates TO ft_student, ft_parent;
GRANT SELECT ON gates, cameras TO ft_warden, ft_security, ft_admin;
GRANT SELECT ON attendance_sessions TO ft_student, ft_parent, ft_warden, ft_security, ft_admin;
GRANT SELECT (user_id, email, role) ON users TO ft_student, ft_parent, ft_warden, ft_security, ft_admin;

-- students and parents: own rows (policies below)
GRANT SELECT (student_id, user_id, roll_no, name, hostel_id, room_no) ON students TO ft_student, ft_parent;
GRANT SELECT (parent_id, user_id, name) ON parents TO ft_student, ft_parent;
GRANT SELECT ON student_parent TO ft_student, ft_parent;
GRANT SELECT ON attendance, entry_exit_log TO ft_student, ft_parent;
GRANT SELECT ON violations TO ft_student, ft_parent;
GRANT SELECT, DELETE ON leave_requests TO ft_student;
GRANT INSERT (student_id, start_date, end_date, reason) ON leave_requests TO ft_student;
GRANT USAGE ON SEQUENCE leave_requests_leave_id_seq TO ft_student;
GRANT SELECT ON leave_requests TO ft_parent;
GRANT UPDATE (status, decided_by, decided_at) ON leave_requests TO ft_parent;
DO $$
BEGIN
    PERFORM pg_temp.gp('decide_leave(int,int,text)', 'GRANT EXECUTE ON PROCEDURE decide_leave(INT, INT, TEXT) TO ft_parent');
END $$;

-- warden
GRANT SELECT ON students, parents, student_parent, attendance, entry_exit_log, face_events, leave_requests, violations TO ft_warden;
GRANT INSERT ON attendance_sessions, attendance, violations TO ft_warden;       -- roll calls; closing a roll call marks absentees
GRANT USAGE ON SEQUENCE attendance_sessions_session_id_seq, violations_violation_id_seq TO ft_warden;
GRANT UPDATE (status, resolved_by, resolved_at) ON violations TO ft_warden;
GRANT UPDATE (outcome, student_id, reviewed_by) ON face_events TO ft_warden;     -- review queue: confirm or reject
GRANT UPDATE (status, marked_at) ON attendance TO ft_warden;
GRANT UPDATE (end_time) ON attendance_sessions TO ft_warden, ft_admin;           -- SELECT ... FOR UPDATE (the row lock in close_attendance_session) needs an UPDATE right; no route edits a roll call
DO $$
BEGIN
    PERFORM pg_temp.gp('create_attendance_session(int,date,time,time)', 'GRANT EXECUTE ON FUNCTION create_attendance_session(INT, DATE, TIME, TIME) TO ft_warden, ft_admin');
    PERFORM pg_temp.gp('session_close_preview(int)', 'GRANT EXECUTE ON FUNCTION session_close_preview(INT) TO ft_warden, ft_admin');
    PERFORM pg_temp.gp('close_attendance_session(int)', 'GRANT EXECUTE ON PROCEDURE close_attendance_session(INT, INT, INT) TO ft_warden, ft_admin');
END $$;

-- security (the gate): writes scans and the records they create
GRANT SELECT ON students, attendance_sessions, entry_exit_log, leave_requests, face_events, attendance, violations TO ft_security;
GRANT SELECT (parent_id, user_id, name) ON parents TO ft_security;
GRANT INSERT ON face_events, attendance, entry_exit_log, violations TO ft_security;
GRANT USAGE ON SEQUENCE face_events_event_id_seq, entry_exit_log_log_id_seq, violations_violation_id_seq TO ft_security;
DO $$
BEGIN
    PERFORM pg_temp.gp('mark_attendance(int,int,int)', 'GRANT EXECUTE ON PROCEDURE mark_attendance(INT, INT, INT, TEXT) TO ft_security, ft_admin');
    PERFORM pg_temp.gp('record_entry_exit(int,int,int,text)', 'GRANT EXECUTE ON PROCEDURE record_entry_exit(INT, INT, INT, TEXT, INT, TEXT) TO ft_security, ft_admin');
END $$;

-- admin: staff rights plus people and face samples
GRANT SELECT ON students, parents, student_parent, attendance, entry_exit_log, face_events, leave_requests, violations, face_profiles TO ft_admin;
GRANT INSERT ON attendance_sessions, attendance, violations, face_events, entry_exit_log TO ft_admin;
GRANT USAGE ON SEQUENCE attendance_sessions_session_id_seq, violations_violation_id_seq, face_events_event_id_seq, entry_exit_log_log_id_seq TO ft_admin;
GRANT UPDATE (status, resolved_by, resolved_at) ON violations TO ft_admin;
GRANT UPDATE (outcome, student_id, reviewed_by) ON face_events TO ft_admin;
GRANT UPDATE (status, marked_at) ON attendance TO ft_admin;
GRANT INSERT, DELETE ON students, parents, student_parent, face_profiles TO ft_admin;
GRANT UPDATE (room_no) ON students TO ft_admin;                                  -- SELECT ... FOR UPDATE in delete_student needs an UPDATE right
GRANT INSERT (email, password_hash, role), DELETE, UPDATE (token_version) ON users TO ft_admin;
GRANT SELECT (token_version) ON users TO ft_admin;                                -- "sign out everywhere" does token_version = token_version + 1 RETURNING token_version
GRANT USAGE ON SEQUENCE users_user_id_seq, students_student_id_seq, parents_parent_id_seq, face_profiles_profile_id_seq TO ft_admin;
DO $$
BEGIN
    PERFORM pg_temp.gp('student_delete_blockers(int)', 'GRANT EXECUTE ON FUNCTION student_delete_blockers(INT) TO ft_admin');
    PERFORM pg_temp.gp('delete_student(int)', 'GRANT EXECUTE ON FUNCTION delete_student(INT) TO ft_admin');
    PERFORM pg_temp.gp('register_student(jsonb,jsonb,boolean,int)', 'GRANT EXECUTE ON FUNCTION register_student(JSONB, JSONB, BOOLEAN, INT) TO ft_admin');
END $$;
DO $$
BEGIN
    PERFORM pg_temp.g('v_current_presence', 'GRANT SELECT ON v_current_presence TO ft_warden, ft_admin');
    PERFORM pg_temp.g('v_attendance_summary', 'GRANT SELECT ON v_attendance_summary TO ft_warden, ft_admin');
    PERFORM pg_temp.g('v_open_violations', 'GRANT SELECT ON v_open_violations TO ft_warden, ft_admin');
    PERFORM pg_temp.g('v_review_queue', 'GRANT SELECT ON v_review_queue TO ft_warden, ft_admin');
    PERFORM pg_temp.g('v_report_trips', 'GRANT SELECT ON v_report_trips TO ft_warden, ft_admin');
    PERFORM pg_temp.g('v_absence_runs', 'GRANT SELECT ON v_absence_runs TO ft_warden, ft_admin');
    PERFORM pg_temp.g('b_consents', 'GRANT SELECT, INSERT, DELETE ON b_consents TO ft_admin');
    PERFORM pg_temp.g('b_meta', 'GRANT SELECT ON b_meta TO ft_warden, ft_admin');
    PERFORM pg_temp.g('b_demo_rows', 'GRANT SELECT ON b_demo_rows TO ft_warden, ft_admin');
END $$;
DO $$
DECLARE r RECORD;
BEGIN   -- the eleven report functions
    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'report\_%' LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ft_warden, ft_admin', r.sig);
    END LOOP;
END $$;
-- generated tsvector columns (full-text search) are ordinary columns: warden and admin read them with the table grants above

-- ---------------------------------------------------------------------
-- 4. Row-level security: a student sees only their own rows, a parent only their linked children's rows
-- ---------------------------------------------------------------------
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE students       ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parent ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_exit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN   -- staff and the login role see every row (their table rights above still limit what they may do)
    FOREACH t IN ARRAY ARRAY['users','students','parents','student_parent','attendance','entry_exit_log','leave_requests','violations'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS staff_all ON %I', t);
        EXECUTE format('CREATE POLICY staff_all ON %I FOR ALL TO ft_app, ft_warden, ft_security, ft_admin USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;

DROP POLICY IF EXISTS own_row ON users;
CREATE POLICY own_row ON users FOR SELECT TO ft_student, ft_parent
    USING (user_id = ft_current_user_id() OR role IN ('warden', 'admin'));   -- own account, and the staff who resolved something

DROP POLICY IF EXISTS own_row ON students;
CREATE POLICY own_row ON students FOR SELECT TO ft_student USING (user_id = ft_current_user_id());
DROP POLICY IF EXISTS wards ON students;
CREATE POLICY wards ON students FOR SELECT TO ft_parent
    USING (EXISTS (SELECT 1 FROM student_parent sp WHERE sp.student_id = students.student_id AND sp.parent_id = ft_current_parent_id()));

DROP POLICY IF EXISTS own_row ON parents;
CREATE POLICY own_row ON parents FOR SELECT TO ft_parent USING (user_id = ft_current_user_id());
DROP POLICY IF EXISTS own_parents ON parents;
CREATE POLICY own_parents ON parents FOR SELECT TO ft_student     -- the parents of this student (names shown on decided leave)
    USING (EXISTS (SELECT 1 FROM student_parent sp WHERE sp.parent_id = parents.parent_id AND sp.student_id = ft_current_student_id()));

DROP POLICY IF EXISTS own_links ON student_parent;
CREATE POLICY own_links ON student_parent FOR SELECT TO ft_student USING (student_id = ft_current_student_id());
DROP POLICY IF EXISTS ward_links ON student_parent;
CREATE POLICY ward_links ON student_parent FOR SELECT TO ft_parent USING (parent_id = ft_current_parent_id());

DO $$
DECLARE t TEXT;
BEGIN   -- attendance, gate log and violations: own rows for a student, linked children's rows for a parent
    FOREACH t IN ARRAY ARRAY['attendance','entry_exit_log','violations'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS own_rows ON %I', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO ft_student USING (student_id = ft_current_student_id())', t);
        EXECUTE format('DROP POLICY IF EXISTS ward_rows ON %I', t);
        EXECUTE format('CREATE POLICY ward_rows ON %I FOR SELECT TO ft_parent USING (EXISTS (SELECT 1 FROM student_parent sp WHERE sp.student_id = %I.student_id AND sp.parent_id = ft_current_parent_id()))', t, t);
    END LOOP;
END $$;

DROP POLICY IF EXISTS own_rows ON leave_requests;
CREATE POLICY own_rows ON leave_requests FOR SELECT TO ft_student USING (student_id = ft_current_student_id());
DROP POLICY IF EXISTS own_insert ON leave_requests;
CREATE POLICY own_insert ON leave_requests FOR INSERT TO ft_student WITH CHECK (student_id = ft_current_student_id());
DROP POLICY IF EXISTS own_cancel ON leave_requests;
CREATE POLICY own_cancel ON leave_requests FOR DELETE TO ft_student USING (student_id = ft_current_student_id() AND status = 'pending');
DROP POLICY IF EXISTS ward_rows ON leave_requests;
CREATE POLICY ward_rows ON leave_requests FOR SELECT TO ft_parent
    USING (EXISTS (SELECT 1 FROM student_parent sp WHERE sp.student_id = leave_requests.student_id AND sp.parent_id = ft_current_parent_id()));
DROP POLICY IF EXISTS ward_decide ON leave_requests;
CREATE POLICY ward_decide ON leave_requests FOR UPDATE TO ft_parent
    USING (EXISTS (SELECT 1 FROM student_parent sp WHERE sp.student_id = leave_requests.student_id AND sp.parent_id = ft_current_parent_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM student_parent sp WHERE sp.student_id = leave_requests.student_id AND sp.parent_id = ft_current_parent_id()));

COMMIT;
