-- =====================================================================
-- FaceTrackDB: reporting views and example queries (Person B)
-- Load after schema, seed, triggers and procedures (see db/load_b.sh).
-- Safe to re-run: views use CREATE OR REPLACE and the example queries
-- only read, except the DELETE demo which ends in ROLLBACK.
-- NOTE: schema.sql drops tables with CASCADE, which also drops these
-- views, so re-run this file after reloading the schema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: VIEWS
-- ---------------------------------------------------------------------

-- V1. Where is each student right now? The latest gate event decides.
--     Students with no gate event at all are reported as 'inside'.
CREATE OR REPLACE VIEW v_current_presence AS
SELECT s.student_id,
       s.roll_no,
       s.name,
       s.room_no,
       h.hostel_id,
       h.name                                   AS hostel,
       last.direction                           AS last_direction,
       last.event_time                          AS last_event_time,
       CASE last.direction WHEN 'OUT' THEN 'outside' ELSE 'inside' END AS presence,
       EXISTS (SELECT 1
               FROM leave_requests l
               WHERE l.student_id = s.student_id
                 AND l.status = 'approved'
                 AND current_date BETWEEN l.start_date AND l.end_date) AS on_leave_today
FROM students s
JOIN hostels h ON h.hostel_id = s.hostel_id
LEFT JOIN LATERAL (
        SELECT e.direction, e.event_time
        FROM entry_exit_log e
        WHERE e.student_id = s.student_id
        ORDER BY e.event_time DESC, e.log_id DESC
        LIMIT 1
     ) last ON true;

-- V2. Roll-call history per student, with an attendance percentage.
CREATE OR REPLACE VIEW v_attendance_summary AS
SELECT s.student_id,
       s.roll_no,
       s.name,
       h.name                                              AS hostel,
       count(a.session_id)                                 AS sessions_recorded,
       count(*) FILTER (WHERE a.status = 'present')        AS present,
       count(*) FILTER (WHERE a.status = 'low_confidence') AS low_confidence,
       count(*) FILTER (WHERE a.status = 'absent')         AS absent,
       round(100.0 * count(*) FILTER (WHERE a.status = 'present')
             / NULLIF(count(a.session_id), 0), 1)          AS attendance_pct
FROM students s
JOIN hostels h ON h.hostel_id = s.hostel_id
LEFT JOIN attendance a ON a.student_id = s.student_id
GROUP BY s.student_id, s.roll_no, s.name, h.name;

-- V3. Violations that still need a warden, with student and hostel.
CREATE OR REPLACE VIEW v_open_violations AS
SELECT v.violation_id,
       v.type,
       v.details,
       v.raised_at,
       s.student_id,
       s.roll_no,
       s.name        AS student,
       s.room_no,
       h.name        AS hostel
FROM violations v
JOIN students s ON s.student_id = v.student_id
JOIN hostels  h ON h.hostel_id  = s.hostel_id
WHERE v.status = 'open';

-- V4. The warden's review queue: low-confidence scans nobody has looked
--     at yet. Matches the partial index idx_face_events_review_queue.
CREATE OR REPLACE VIEW v_review_queue AS
SELECT e.event_id,
       e.event_time,
       e.confidence,
       e.camera_id,
       c.location    AS camera_location,
       g.gate_id,
       h.hostel_id,
       h.name        AS hostel,
       s.student_id  AS candidate_student_id,
       s.roll_no     AS candidate_roll_no,
       s.name        AS candidate_name
FROM face_events e
JOIN cameras c ON c.camera_id = e.camera_id
JOIN gates   g ON g.gate_id   = c.gate_id
JOIN hostels h ON h.hostel_id = g.hostel_id
LEFT JOIN students s ON s.student_id = e.student_id
WHERE e.outcome = 'low_confidence'
  AND e.reviewed_by IS NULL;

\echo
\echo '=== V1. v_current_presence ==='
SELECT student_id, name, hostel, last_direction, last_event_time, presence, on_leave_today
FROM v_current_presence ORDER BY hostel, name;

\echo
\echo '=== V2. v_attendance_summary ==='
SELECT * FROM v_attendance_summary ORDER BY attendance_pct NULLS LAST, name;

\echo
\echo '=== V3. v_open_violations ==='
SELECT violation_id, type, student, hostel, raised_at FROM v_open_violations ORDER BY raised_at;

\echo
\echo '=== V4. v_review_queue (empty until a low-confidence scan is waiting) ==='
SELECT * FROM v_review_queue;

-- ---------------------------------------------------------------------
-- PART 2: REPORTING CTEs
-- ---------------------------------------------------------------------

\echo
\echo '=== CTE 1. Attendance percentage per hostel per month ==='
WITH roll_calls AS (
    SELECT s.hostel_id,
           date_trunc('month', s.session_date)::date AS month,
           a.status
    FROM attendance a
    JOIN attendance_sessions s ON s.session_id = a.session_id
), per_month AS (
    SELECT hostel_id, month,
           count(*)                                  AS marks,
           count(*) FILTER (WHERE status = 'present') AS present
    FROM roll_calls
    GROUP BY hostel_id, month
)
SELECT h.name AS hostel, p.month, p.marks, p.present,
       round(100.0 * p.present / p.marks, 1) AS attendance_pct
FROM per_month p
JOIN hostels h USING (hostel_id)
ORDER BY h.name, p.month;

\echo
\echo '=== CTE 2. Students needing attention: open violations + absences + where they are now ==='
WITH open_v AS (
    SELECT student_id, count(*) AS open_violations
    FROM violations WHERE status = 'open' GROUP BY student_id
), missed AS (
    SELECT student_id, count(*) AS absences
    FROM attendance WHERE status = 'absent' GROUP BY student_id
)
SELECT s.name, h.name AS hostel,
       COALESCE(o.open_violations, 0) AS open_violations,
       COALESCE(m.absences, 0)        AS absences,
       p.presence
FROM students s
JOIN hostels h USING (hostel_id)
JOIN v_current_presence p USING (student_id)
LEFT JOIN open_v o USING (student_id)
LEFT JOIN missed m USING (student_id)
WHERE COALESCE(o.open_violations, 0) + COALESCE(m.absences, 0) > 0
ORDER BY open_violations DESC, absences DESC, s.name;

-- ---------------------------------------------------------------------
-- PART 3: WINDOW FUNCTIONS
-- ---------------------------------------------------------------------

\echo
\echo '=== WINDOW 1. RANK / DENSE_RANK of students by violations, within each hostel ==='
SELECT h.name AS hostel, s.name,
       count(v.violation_id)                                   AS violations,
       RANK()       OVER (PARTITION BY h.hostel_id ORDER BY count(v.violation_id) DESC) AS rank,
       DENSE_RANK() OVER (PARTITION BY h.hostel_id ORDER BY count(v.violation_id) DESC) AS dense_rank
FROM students s
JOIN hostels h ON h.hostel_id = s.hostel_id
LEFT JOIN violations v ON v.student_id = s.student_id
GROUP BY h.hostel_id, h.name, s.student_id, s.name
ORDER BY h.name, rank, s.name;

\echo
\echo '=== WINDOW 2. Running count of violations per student, and gap since the previous one (LAG) ==='
SELECT s.name, v.type, v.raised_at,
       count(*) OVER (PARTITION BY v.student_id ORDER BY v.raised_at) AS running_count,
       v.raised_at - LAG(v.raised_at) OVER (PARTITION BY v.student_id ORDER BY v.raised_at) AS since_previous
FROM violations v
JOIN students s USING (student_id)
ORDER BY s.name, v.raised_at;

\echo
\echo '=== WINDOW 3. Time spent outside per gate trip (LEAD pairs each OUT with the next event) ==='
SELECT name, left_at, returned_at, returned_at - left_at AS time_outside
FROM (
    SELECT s.name, l.direction, l.event_time AS left_at,
           LEAD(l.event_time) OVER (PARTITION BY l.student_id ORDER BY l.event_time) AS returned_at
    FROM entry_exit_log l
    JOIN students s USING (student_id)
) trips
WHERE direction = 'OUT'
ORDER BY left_at;

-- ---------------------------------------------------------------------
-- PART 3b: RECURSIVE CTE
-- ---------------------------------------------------------------------

-- V5. Every maximal run of consecutive absent roll-call days per student. WITH RECURSIVE
--     starts a run on an absent day whose previous calendar day is not absent for that student,
--     and extends it one day at a time while the next day is also absent. A run is complete
--     when no absent day follows it. Read-only. Days without a roll call break a run, because
--     they are not "absent" days.
CREATE OR REPLACE VIEW v_absence_runs AS
WITH RECURSIVE absent_days AS (
    SELECT DISTINCT a.student_id, s.session_date AS day
    FROM attendance a
    JOIN attendance_sessions s ON s.session_id = a.session_id
    WHERE a.status = 'absent'
), chain AS (
    -- anchor: the first absent day of a run
    SELECT d.student_id, d.day AS run_start, d.day AS run_end, 1 AS days
    FROM absent_days d
    WHERE NOT EXISTS (SELECT 1 FROM absent_days p
                      WHERE p.student_id = d.student_id AND p.day = d.day - 1)
    UNION ALL
    -- recursive step: extend the run by the next consecutive absent day
    SELECT c.student_id, c.run_start, d.day, c.days + 1
    FROM chain c
    JOIN absent_days d ON d.student_id = c.student_id AND d.day = c.run_end + 1
)
SELECT c.student_id, c.run_start, c.run_end, c.days
FROM chain c
WHERE NOT EXISTS (SELECT 1 FROM absent_days n
                  WHERE n.student_id = c.student_id AND n.day = c.run_end + 1);

\echo
\echo '=== RECURSIVE 1. Longest run of consecutive absent roll-call days per student (v_absence_runs) ==='
SELECT s.roll_no, s.name, h.name AS hostel,
       max(r.days)                                         AS longest_run_days,
       (array_agg(r.run_start ORDER BY r.days DESC, r.run_start))[1] AS run_started,
       count(*)                                            AS runs
FROM v_absence_runs r
JOIN students s ON s.student_id = r.student_id
JOIN hostels  h ON h.hostel_id  = s.hostel_id
GROUP BY s.student_id, s.roll_no, s.name, h.name
ORDER BY longest_run_days DESC, s.roll_no
LIMIT 10;

-- ---------------------------------------------------------------------
-- PART 4: LABELLED DML EXAMPLES
-- ---------------------------------------------------------------------

\echo
\echo '=== Q-A. GROUP BY + HAVING: hostels with at least one absence, busiest first ==='
SELECT h.name AS hostel, count(DISTINCT a.student_id) AS students_absent, count(*) AS absences
FROM attendance a
JOIN students s ON s.student_id = a.student_id
JOIN hostels  h ON h.hostel_id  = s.hostel_id
WHERE a.status = 'absent'
GROUP BY h.name
HAVING count(*) >= 1
ORDER BY absences DESC, hostel;

\echo
\echo '=== Q-B. Subquery: students whose attendance is below their hostel average ==='
SELECT a.name, a.hostel, a.attendance_pct
FROM v_attendance_summary a
WHERE a.attendance_pct < (SELECT avg(b.attendance_pct)
                          FROM v_attendance_summary b
                          WHERE b.hostel = a.hostel)
ORDER BY a.attendance_pct, a.name;

\echo
\echo '=== Q-C. Correlated subquery: students with no gate crossing in the log ==='
SELECT s.name, s.room_no
FROM students s
WHERE NOT EXISTS (SELECT 1 FROM entry_exit_log l WHERE l.student_id = s.student_id)
ORDER BY s.name;

\echo
\echo '=== Q-D. JOIN across five tables: every face event with camera, gate, hostel and student ==='
SELECT e.event_id, e.event_time, e.outcome, e.confidence,
       COALESCE(s.name, '(unknown)') AS student, g.name AS gate, h.name AS hostel
FROM face_events e
JOIN cameras c ON c.camera_id = e.camera_id
JOIN gates   g ON g.gate_id   = c.gate_id
JOIN hostels h ON h.hostel_id = g.hostel_id
LEFT JOIN students s ON s.student_id = e.student_id
ORDER BY e.event_time DESC
LIMIT 5;

\echo
\echo '=== Q-E. Aggregates: recognition outcomes with average and best score ==='
SELECT outcome, count(*) AS events, round(avg(confidence), 3) AS avg_score,
       max(confidence) AS best_score, min(event_time) AS first_seen
FROM face_events
GROUP BY outcome
ORDER BY events DESC;

\echo
\echo '=== Q-F. UPDATE then SELECT inside a transaction that is rolled back ==='
BEGIN;
UPDATE hostels SET name = name || ' (renamed)' WHERE hostel_id = 1 RETURNING hostel_id, name;
ROLLBACK;

\echo
\echo '=== Q-G. DELETE demo (rolled back, nothing is lost) ==='
BEGIN;
SELECT count(*) AS resolved_before FROM violations WHERE status = 'resolved';
DELETE FROM violations WHERE status = 'resolved' RETURNING violation_id, student_id, type;
SELECT count(*) AS resolved_after_delete FROM violations WHERE status = 'resolved';
ROLLBACK;
SELECT count(*) AS resolved_after_rollback FROM violations WHERE status = 'resolved';
