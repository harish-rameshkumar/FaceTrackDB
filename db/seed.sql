-- =====================================================================
-- FaceTrackDB: seed data (Phase 2). Run after schema.sql.
--
-- Notes
-- * password_hash values are placeholders. Real bcrypt hashes are
--   generated when login is built (Phase 4), so nobody can log in yet.
-- * face_profiles is left empty on purpose: rows are created by the
--   enrolment endpoint together with the real Qdrant vectors.
-- * Confidence thresholds below are illustrative only (matched >= 0.85,
--   low_confidence 0.60 to 0.85, no_match below 0.60). The final values
--   are decided by the matching endpoint.
-- * Story: Rahul returns late and misses a roll call, Sneha leaves
--   without approved leave, Karthik has a low-confidence scan that the
--   warden reviews. This gives the Phase 3 queries something to find.
-- =====================================================================

BEGIN;

-- ---------- hostels ----------
INSERT INTO hostels (hostel_id, name) VALUES
    (1, 'Aryabhatta Boys Hostel'),
    (2, 'Kalam Girls Hostel');

-- ---------- users (1-3 staff, 4-9 students, 10-15 parents) ----------
INSERT INTO users (user_id, email, password_hash, role) VALUES
    (1,  'warden1@facetrack.test',         'REPLACE_WITH_BCRYPT_HASH', 'warden'),
    (2,  'security1@facetrack.test',       'REPLACE_WITH_BCRYPT_HASH', 'security'),
    (3,  'admin1@facetrack.test',          'REPLACE_WITH_BCRYPT_HASH', 'admin'),
    (4,  'arun.kumar@facetrack.test',      'REPLACE_WITH_BCRYPT_HASH', 'student'),
    (5,  'karthik.r@facetrack.test',       'REPLACE_WITH_BCRYPT_HASH', 'student'),
    (6,  'rahul.v@facetrack.test',         'REPLACE_WITH_BCRYPT_HASH', 'student'),
    (7,  'divya.s@facetrack.test',         'REPLACE_WITH_BCRYPT_HASH', 'student'),
    (8,  'meena.r@facetrack.test',         'REPLACE_WITH_BCRYPT_HASH', 'student'),
    (9,  'sneha.m@facetrack.test',         'REPLACE_WITH_BCRYPT_HASH', 'student'),
    (10, 'parent.senthil@facetrack.test',  'REPLACE_WITH_BCRYPT_HASH', 'parent'),
    (11, 'parent.lakshmi@facetrack.test',  'REPLACE_WITH_BCRYPT_HASH', 'parent'),
    (12, 'parent.ramanathan@facetrack.test','REPLACE_WITH_BCRYPT_HASH','parent'),
    (13, 'parent.venkatesh@facetrack.test','REPLACE_WITH_BCRYPT_HASH', 'parent'),
    (14, 'parent.sumathi@facetrack.test',  'REPLACE_WITH_BCRYPT_HASH', 'parent'),
    (15, 'parent.murugan@facetrack.test',  'REPLACE_WITH_BCRYPT_HASH', 'parent');

-- ---------- students ----------
INSERT INTO students (student_id, user_id, roll_no, name, hostel_id, room_no) VALUES
    (1, 4, '21CS001', 'Arun Kumar',  1, 'A-101'),
    (2, 5, '21CS007', 'Karthik R',   1, 'A-102'),
    (3, 6, '21EC012', 'Rahul V',     1, 'B-205'),
    (4, 7, '21CS014', 'Divya S',     2, 'K-110'),
    (5, 8, '21IT003', 'Meena R',     2, 'K-111'),
    (6, 9, '21EC020', 'Sneha M',     2, 'K-204');

-- ---------- parents ----------
INSERT INTO parents (parent_id, user_id, name, phone) VALUES
    (1, 10, 'Senthil Kumar', '+919841000001'),
    (2, 11, 'Lakshmi Kumar', '+919841000002'),
    (3, 12, 'Ramanathan',    '+919841000003'),
    (4, 13, 'Venkatesh',     '+919841000004'),
    (5, 14, 'Sumathi',       '+919841000005'),
    (6, 15, 'Murugan',       '+919841000006');

-- Arun has two parents; Ramanathan has two wards (Karthik and Meena)
INSERT INTO student_parent (student_id, parent_id, relation) VALUES
    (1, 1, 'father'),
    (1, 2, 'mother'),
    (2, 3, 'father'),
    (5, 3, 'father'),
    (3, 4, 'father'),
    (4, 5, 'mother'),
    (6, 6, 'guardian');

-- ---------- gates and cameras ----------
INSERT INTO gates (gate_id, hostel_id, name) VALUES
    (1, 1, 'Main Gate'),
    (2, 1, 'Back Gate'),
    (3, 2, 'Main Gate');

INSERT INTO cameras (camera_id, gate_id, location, status) VALUES
    (1, 1, 'Main gate, entry lane', 'active'),
    (2, 1, 'Main gate, exit lane',  'active'),
    (3, 2, 'Back gate',             'inactive'),
    (4, 3, 'Girls hostel main gate','active');

-- ---------- face events (ids 1-5 gate events, 6-13 roll-call scans) ----------
INSERT INTO face_events (event_id, camera_id, student_id, confidence, outcome, event_time, reviewed_by) VALUES
    (1,  2, 2,    0.921, 'matched',        '2026-10-21 09:30:12', NULL),
    (2,  1, 2,    0.934, 'matched',        '2026-10-21 21:50:40', NULL),
    (3,  2, 3,    0.905, 'matched',        '2026-10-20 18:45:05', NULL),
    (4,  1, 3,    0.897, 'matched',        '2026-10-21 00:40:22', NULL),
    (5,  4, 6,    0.918, 'matched',        '2026-10-21 20:50:31', NULL),
    (6,  1, 1,    0.949, 'matched',        '2026-10-20 22:03:10', NULL),
    (7,  1, 2,    0.928, 'matched',        '2026-10-20 22:05:44', NULL),
    (8,  1, 1,    0.941, 'matched',        '2026-10-21 22:02:15', NULL),
    (9,  1, 2,    0.712, 'low_confidence', '2026-10-21 22:06:30', 1),
    (10, 1, 3,    0.903, 'matched',        '2026-10-21 22:11:02', NULL),
    (11, 4, 4,    0.936, 'matched',        '2026-10-21 21:32:50', NULL),
    (12, 4, 5,    0.927, 'matched',        '2026-10-21 21:35:18', NULL),
    (13, 4, NULL, 0.512, 'no_match',       '2026-10-21 21:41:09', NULL);

-- ---------- attendance sessions ----------
INSERT INTO attendance_sessions (session_id, hostel_id, session_date, start_time, end_time) VALUES
    (1, 1, '2026-10-20', '22:00', '22:30'),
    (2, 1, '2026-10-21', '22:00', '22:30'),
    (3, 2, '2026-10-21', '21:30', '22:00'),
    (4, 1, '2026-10-22', '22:00', '22:30');   -- today, no scans yet

-- ---------- attendance ----------
INSERT INTO attendance (session_id, student_id, event_id, status, marked_at) VALUES
    (1, 1, 6,    'present',        '2026-10-20 22:03:10'),
    (1, 2, 7,    'present',        '2026-10-20 22:05:44'),
    (1, 3, NULL, 'absent',         '2026-10-20 22:30:00'),
    (2, 1, 8,    'present',        '2026-10-21 22:02:15'),
    (2, 2, 9,    'low_confidence', '2026-10-21 22:06:30'),
    (2, 3, 10,   'present',        '2026-10-21 22:11:02'),
    (3, 4, 11,   'present',        '2026-10-21 21:32:50'),
    (3, 5, 12,   'present',        '2026-10-21 21:35:18'),
    (3, 6, NULL, 'absent',         '2026-10-21 22:00:00');

-- ---------- entry / exit log ----------
INSERT INTO entry_exit_log (log_id, student_id, gate_id, event_id, direction, event_time) VALUES
    (1, 2, 1, 1, 'OUT', '2026-10-21 09:30:12'),   -- Karthik, on approved day leave
    (2, 2, 1, 2, 'IN',  '2026-10-21 21:50:40'),
    (3, 3, 1, 3, 'OUT', '2026-10-20 18:45:05'),   -- Rahul
    (4, 3, 1, 4, 'IN',  '2026-10-21 00:40:22'),   -- Rahul returns very late
    (5, 6, 3, 5, 'OUT', '2026-10-21 20:50:31');   -- Sneha, no approved leave

-- ---------- leave requests ----------
INSERT INTO leave_requests (leave_id, student_id, start_date, end_date, reason, status, decided_by, decided_at) VALUES
    (1, 1, '2026-10-23', '2026-10-25', 'Family function in Madurai', 'approved', 1,    '2026-10-20 18:00:00'),
    (2, 2, '2026-10-21', '2026-10-21', 'Medical appointment',        'approved', 3,    '2026-10-20 09:00:00'),
    (3, 4, '2026-10-24', '2026-10-26', 'Cousin wedding',             'pending',  NULL, NULL),
    (4, 3, '2026-10-18', '2026-10-19', 'Home visit',                 'rejected', 4,    '2026-10-17 19:30:00');

-- ---------- violations ----------
INSERT INTO violations (violation_id, student_id, log_id, session_id, type, details, raised_at, status, resolved_by) VALUES
    (1, 3, 4,    NULL, 'late_return',       'Returned more than two hours after curfew without permission', '2026-10-21 00:40:25', 'open',     NULL),
    (2, 3, NULL, 1,    'missed_attendance', 'Absent at the evening roll call on 20 October',                '2026-10-20 22:30:05', 'resolved', 1),
    (3, 6, 5,    NULL, 'no_leave',          'Left the hostel in the evening with no approved leave',        '2026-10-21 20:50:35', 'open',     NULL),
    (4, 6, NULL, 3,    'missed_attendance', 'Absent at the evening roll call on 21 October',                '2026-10-21 22:00:05', 'open',     NULL);

-- ---------- move the id counters past the seeded ids ----------
SELECT setval(pg_get_serial_sequence('hostels',             'hostel_id'),    (SELECT MAX(hostel_id)    FROM hostels));
SELECT setval(pg_get_serial_sequence('users',               'user_id'),      (SELECT MAX(user_id)      FROM users));
SELECT setval(pg_get_serial_sequence('students',            'student_id'),   (SELECT MAX(student_id)   FROM students));
SELECT setval(pg_get_serial_sequence('parents',             'parent_id'),    (SELECT MAX(parent_id)    FROM parents));
SELECT setval(pg_get_serial_sequence('gates',               'gate_id'),      (SELECT MAX(gate_id)      FROM gates));
SELECT setval(pg_get_serial_sequence('cameras',             'camera_id'),    (SELECT MAX(camera_id)    FROM cameras));
SELECT setval(pg_get_serial_sequence('face_events',         'event_id'),     (SELECT MAX(event_id)     FROM face_events));
SELECT setval(pg_get_serial_sequence('attendance_sessions', 'session_id'),   (SELECT MAX(session_id)   FROM attendance_sessions));
SELECT setval(pg_get_serial_sequence('entry_exit_log',      'log_id'),       (SELECT MAX(log_id)       FROM entry_exit_log));
SELECT setval(pg_get_serial_sequence('leave_requests',      'leave_id'),     (SELECT MAX(leave_id)     FROM leave_requests));
SELECT setval(pg_get_serial_sequence('violations',          'violation_id'), (SELECT MAX(violation_id) FROM violations));

COMMIT;
