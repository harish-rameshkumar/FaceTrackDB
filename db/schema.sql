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

COMMIT;
