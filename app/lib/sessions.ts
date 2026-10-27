// Shared by the roll-call API and the /warden/sessions page.
export const sessionsSql = `
  SELECT s.session_id, s.hostel_id, h.name AS hostel,
         to_char(s.session_date, 'YYYY-MM-DD') AS date,
         to_char(s.start_time, 'HH24:MI') AS start, to_char(s.end_time, 'HH24:MI') AS "end",
         (SELECT count(*)::int FROM attendance a WHERE a.session_id = s.session_id AND a.status = 'present') AS present,
         (SELECT count(*)::int FROM attendance a WHERE a.session_id = s.session_id AND a.status = 'absent') AS absent,
         (SELECT count(*)::int FROM attendance a WHERE a.session_id = s.session_id AND a.status = 'low_confidence') AS low_confidence,
         (SELECT count(*)::int FROM students st WHERE st.hostel_id = s.hostel_id
            AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.session_id AND a.student_id = st.student_id)) AS pending,
         CASE WHEN (s.session_date + s.end_time) <= localtimestamp THEN 'ended'
              WHEN (s.session_date + s.start_time) <= localtimestamp THEN 'open'
              ELSE 'upcoming' END AS status
  FROM attendance_sessions s JOIN hostels h USING (hostel_id)
  ORDER BY s.session_date DESC, s.start_time DESC, s.session_id DESC
  LIMIT 100`;

