-- =====================================================================
-- FaceTrackDB: reports for the demo (read-only, safe to run any time)
--
--   Get-Content db\reports.sql | docker compose exec -T postgres psql -U facetrack -d facetrackdb
--
-- Same idea as "average salary of every department": a number per group.
-- Here the groups are hostels, cameras, gates and students.
-- =====================================================================

\echo
\echo '=== REPORT 1. Average attendance percentage of every hostel ==='
SELECT h.name AS hostel,
       count(DISTINCT s.student_id) AS students,
       count(*)                     AS roll_call_marks,
       round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'low_confidence'))
             / count(*), 1)         AS attendance_percent
FROM attendance a
JOIN students s ON s.student_id = a.student_id
JOIN hostels  h ON h.hostel_id  = s.hostel_id
GROUP BY h.hostel_id, h.name
ORDER BY attendance_percent DESC;

\echo
\echo '=== REPORT 2. Average face-match confidence of every camera ==='
SELECT c.camera_id, h.name AS hostel, g.name AS gate, c.location,
       count(f.event_id)                          AS scans,
       round(avg(f.confidence), 3)                AS avg_confidence,
       count(*) FILTER (WHERE f.outcome <> 'matched') AS needed_attention
FROM cameras c
JOIN gates   g ON g.gate_id   = c.gate_id
JOIN hostels h ON h.hostel_id = g.hostel_id
LEFT JOIN face_events f ON f.camera_id = c.camera_id
GROUP BY c.camera_id, h.name, g.name, c.location
ORDER BY c.camera_id;

\echo
\echo '=== REPORT 3. Leave requests of every hostel: count and average length in days ==='
SELECT h.name AS hostel, l.status,
       count(*)                                   AS requests,
       round(avg(l.end_date - l.start_date + 1), 1) AS avg_days
FROM leave_requests l
JOIN students s ON s.student_id = l.student_id
JOIN hostels  h ON h.hostel_id  = s.hostel_id
GROUP BY h.name, l.status
ORDER BY h.name, l.status;

\echo
\echo '=== REPORT 4. Violations of every student (most first) ==='
SELECT s.roll_no, s.name, h.name AS hostel,
       count(v.violation_id)                               AS violations,
       count(v.violation_id) FILTER (WHERE v.status = 'open') AS still_open
FROM students s
JOIN hostels h ON h.hostel_id = s.hostel_id
LEFT JOIN violations v ON v.student_id = s.student_id
GROUP BY s.student_id, s.roll_no, s.name, h.name
ORDER BY violations DESC, s.roll_no;

\echo
\echo '=== REPORT 5. Gate traffic: entries and exits per gate ==='
SELECT h.name AS hostel, g.name AS gate,
       count(*) FILTER (WHERE l.direction = 'IN')  AS entries,
       count(*) FILTER (WHERE l.direction = 'OUT') AS exits,
       count(l.log_id)                             AS total
FROM gates g
JOIN hostels h ON h.hostel_id = g.hostel_id
LEFT JOIN entry_exit_log l ON l.gate_id = g.gate_id
GROUP BY h.name, g.gate_id, g.name
ORDER BY h.name, g.name;
