-- =====================================================================
-- FaceTrackDB: important queries (Phase 5)
-- JOIN, GROUP BY, HAVING and subqueries, on the seed data.
-- Run (read-only, safe any time):
--   Get-Content db\queries.sql | docker compose exec -T postgres psql -U facetrack -d facetrackdb
-- Expected results below assume the freshly loaded seed data.
-- =====================================================================

\echo
\echo '=== Q1. Roll-call sheet for session 2 (JOIN + LEFT JOIN) ==='
-- Every student of the hostel, with their result; students without a row show "not marked".
SELECT s.roll_no, s.name,
       COALESCE(a.status, 'not marked') AS status,
       to_char(a.marked_at, 'HH24:MI')  AS marked_at
FROM attendance_sessions sess
JOIN students s              ON s.hostel_id = sess.hostel_id
LEFT JOIN attendance a       ON a.session_id = sess.session_id
                            AND a.student_id = s.student_id
WHERE sess.session_id = 2
ORDER BY s.roll_no;

\echo
\echo '=== Q2. Attendance summary per student (GROUP BY) ==='
SELECT s.roll_no, s.name,
       count(*) FILTER (WHERE a.status = 'present')        AS present,
       count(*) FILTER (WHERE a.status = 'low_confidence') AS low_confidence,
       count(*) FILTER (WHERE a.status = 'absent')         AS absent,
       round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'low_confidence'))
             / count(*)) AS attended_percent
FROM students s
JOIN attendance a USING (student_id)
GROUP BY s.student_id, s.roll_no, s.name
ORDER BY attended_percent, s.roll_no;

\echo
\echo '=== Q3. Students with more than one violation (GROUP BY + HAVING) ==='
SELECT s.roll_no, s.name,
       count(*)                                      AS violations,
       count(*) FILTER (WHERE v.status = 'open')     AS still_open
FROM violations v
JOIN students s USING (student_id)
GROUP BY s.student_id, s.roll_no, s.name
HAVING count(*) > 1
ORDER BY violations DESC, s.roll_no;

\echo
\echo '=== Q4. Violations per hostel and type (three-table JOIN + GROUP BY) ==='
SELECT h.name AS hostel, v.type, count(*) AS total
FROM violations v
JOIN students s USING (student_id)
JOIN hostels  h ON h.hostel_id = s.hostel_id
GROUP BY h.name, v.type
ORDER BY h.name, total DESC, v.type;

\echo
\echo '=== Q5. Students who are outside right now (correlated subquery) ==='
-- Their most recent gate event is an OUT.
SELECT s.roll_no, s.name
FROM students s
WHERE (SELECT l.direction
       FROM entry_exit_log l
       WHERE l.student_id = s.student_id
       ORDER BY l.event_time DESC, l.log_id DESC
       LIMIT 1) = 'OUT'
ORDER BY s.roll_no;

\echo
\echo '=== Q6. Students on approved leave on 24 Oct 2026 (IN subquery) ==='
SELECT roll_no, name
FROM students
WHERE student_id IN (SELECT student_id
                     FROM leave_requests
                     WHERE status = 'approved'
                       AND DATE '2026-10-24' BETWEEN start_date AND end_date);

\echo
\echo '=== Q7. Students not yet marked in session 4 (NOT EXISTS) ==='
SELECT s.roll_no, s.name
FROM students s
JOIN attendance_sessions sess ON sess.hostel_id = s.hostel_id AND sess.session_id = 4
WHERE NOT EXISTS (SELECT 1 FROM attendance a
                  WHERE a.session_id = sess.session_id AND a.student_id = s.student_id)
ORDER BY s.roll_no;

\echo
\echo '=== Q8. Parents with more than one ward (JOIN + GROUP BY + HAVING) ==='
SELECT p.name AS parent, count(*) AS wards,
       string_agg(s.name, ', ' ORDER BY s.name) AS ward_names
FROM parents p
JOIN student_parent sp USING (parent_id)
JOIN students s        USING (student_id)
GROUP BY p.parent_id, p.name
HAVING count(*) > 1;

\echo
\echo '=== Q9. Face recognition results by outcome (GROUP BY) ==='
SELECT outcome, count(*) AS events, round(avg(confidence), 3) AS avg_confidence
FROM face_events
GROUP BY outcome
ORDER BY events DESC;

\echo
\echo '=== Q10. Students whose average scan confidence is below the overall average (subquery in HAVING) ==='
SELECT s.name, count(*) AS scans, round(avg(f.confidence), 3) AS avg_confidence
FROM face_events f
JOIN students s USING (student_id)
GROUP BY s.student_id, s.name
HAVING avg(f.confidence) < (SELECT avg(confidence) FROM face_events WHERE student_id IS NOT NULL)
ORDER BY avg_confidence;
