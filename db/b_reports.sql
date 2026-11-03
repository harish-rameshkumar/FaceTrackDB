-- =====================================================================
-- FaceTrackDB (Person B): report views and functions for /reports.
-- Load after schema, triggers, procedures and b_queries.sql: ./db/load_b.sh
-- Safe to re-run. All aggregation happens here; the app only draws the rows.
--
-- Every function takes (p_from DATE, p_to DATE, p_hostel INT) : an inclusive date
-- range and an optional hostel (NULL = all). All dates and times are the
-- Asia/Kolkata wall-clock values the tables already hold.
--
-- The app shows the text between "-- @report <key>" and "-- @end" on each slide
-- ("Show query"), so keep one function per block.
--
-- NOT computable from this schema (so no report fakes them):
--   * leave approval time: leave_requests has no "requested at" column
--   * top search terms: searches are not logged
-- =====================================================================

BEGIN;

-- Generic key/value table for small facts about the database (for example
-- "this database contains generated demo history").
CREATE TABLE IF NOT EXISTS b_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT      NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Each OUT followed by the next IN of the same student is one trip.
-- (window function LEAD; used by report "time_outside")
CREATE OR REPLACE VIEW v_report_trips AS
SELECT t.student_id, st.hostel_id, t.event_time AS out_time, t.next_time AS in_time
FROM (
    SELECT l.student_id, l.event_time, l.direction,
           LEAD(l.event_time) OVER w AS next_time,
           LEAD(l.direction)  OVER w AS next_direction
    FROM entry_exit_log l
    WINDOW w AS (PARTITION BY l.student_id ORDER BY l.event_time, l.log_id)
) t
JOIN students st ON st.student_id = t.student_id
WHERE t.direction = 'OUT' AND t.next_direction = 'IN';

DROP FUNCTION IF EXISTS report_attendance_by_hostel_month(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_violations_by_type_hostel(DATE, DATE, INT, INT);
DROP FUNCTION IF EXISTS report_cumulative_violations(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_late_return_rank(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_gate_traffic_by_hour(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_time_outside(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_leave_summary(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_recognition_outcomes(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_similarity_distribution(DATE, DATE, INT);
DROP FUNCTION IF EXISTS report_low_attendance_students(DATE, DATE, INT, NUMERIC);
DROP FUNCTION IF EXISTS report_top_words(DATE, DATE, INT);

-- @report attendance_by_hostel_month
-- Technique: CTE. Share of roll-call marks that are "present", per hostel per month.
CREATE FUNCTION report_attendance_by_hostel_month(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (hostel TEXT, month TEXT, marks INT, present INT, attendance_pct NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH marks AS (
        SELECT h.name AS hostel, date_trunc('month', s.session_date)::date AS month_start, a.status
        FROM attendance a
        JOIN attendance_sessions s ON s.session_id = a.session_id
        JOIN hostels h             ON h.hostel_id  = s.hostel_id
        WHERE s.session_date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR s.hostel_id = p_hostel)
    ), per_month AS (
        SELECT hostel, month_start,
               count(*)                                 AS marks,
               count(*) FILTER (WHERE status = 'present') AS present
        FROM marks
        GROUP BY hostel, month_start
    )
    SELECT hostel, to_char(month_start, 'YYYY-MM'), marks::INT, present::INT,
           round(100.0 * present / marks, 1)
    FROM per_month
    ORDER BY month_start, hostel;
$$;
-- @end

-- @report violations_by_type_hostel
-- Technique: GROUP BY with HAVING. Violations per hostel and type; HAVING hides
-- combinations with fewer than p_min violations (default 1 = show all).
CREATE FUNCTION report_violations_by_type_hostel(p_from DATE, p_to DATE, p_hostel INT, p_min INT DEFAULT 1)
RETURNS TABLE (hostel TEXT, type TEXT, violations INT, still_open INT)
LANGUAGE sql STABLE AS $$
    SELECT h.name, v.type, count(*)::INT,
           count(*) FILTER (WHERE v.status = 'open')::INT
    FROM violations v
    JOIN students st ON st.student_id = v.student_id
    JOIN hostels h   ON h.hostel_id   = st.hostel_id
    WHERE v.raised_at::date BETWEEN p_from AND p_to
      AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
    GROUP BY h.name, v.type
    HAVING count(*) >= p_min
    ORDER BY h.name, count(*) DESC, v.type;
$$;
-- @end

-- @report cumulative_violations
-- Technique: window function SUM() OVER. Running total of violations per hostel by day.
CREATE FUNCTION report_cumulative_violations(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (day TEXT, hostel TEXT, violations INT, cumulative INT)
LANGUAGE sql STABLE AS $$
    WITH daily AS (
        SELECT v.raised_at::date AS day, h.name AS hostel, count(*) AS n
        FROM violations v
        JOIN students st ON st.student_id = v.student_id
        JOIN hostels h   ON h.hostel_id   = st.hostel_id
        WHERE v.raised_at::date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
        GROUP BY v.raised_at::date, h.name
    )
    SELECT day::TEXT, hostel, n::INT,
           (sum(n) OVER (PARTITION BY hostel ORDER BY day))::INT
    FROM daily
    ORDER BY day, hostel;
$$;
-- @end

-- @report late_return_rank
-- Technique: RANK() and DENSE_RANK() window functions. Students with the most late
-- returns, ranked inside their own hostel (top 5 ranks per hostel).
CREATE FUNCTION report_late_return_rank(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (hostel TEXT, student TEXT, roll_no TEXT, late_returns INT, rank INT, dense_rank INT)
LANGUAGE sql STABLE AS $$
    WITH per_student AS (
        SELECT st.student_id, st.name, st.roll_no, st.hostel_id, h.name AS hostel,
               count(v.violation_id) AS late
        FROM students st
        JOIN hostels h ON h.hostel_id = st.hostel_id
        LEFT JOIN violations v
               ON v.student_id = st.student_id
              AND v.type = 'late_return'
              AND v.raised_at::date BETWEEN p_from AND p_to
        WHERE p_hostel IS NULL OR st.hostel_id = p_hostel
        GROUP BY st.student_id, st.name, st.roll_no, st.hostel_id, h.name
    ), ranked AS (
        SELECT *,
               RANK()       OVER (PARTITION BY hostel_id ORDER BY late DESC) AS rnk,
               DENSE_RANK() OVER (PARTITION BY hostel_id ORDER BY late DESC) AS dense_rnk
        FROM per_student
    )
    SELECT hostel, name, roll_no, late::INT, rnk::INT, dense_rnk::INT
    FROM ranked
    WHERE late > 0 AND dense_rnk <= 5
    ORDER BY hostel, rnk, name;
$$;
-- @end

-- @report gate_traffic_by_hour
-- Technique: GROUP BY on an extracted hour, joined to generate_series so that empty
-- hours show as 0. Gate crossings by hour of day, IN versus OUT.
CREATE FUNCTION report_gate_traffic_by_hour(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (hour INT, direction TEXT, crossings INT)
LANGUAGE sql STABLE AS $$
    WITH counts AS (
        SELECT extract(hour FROM l.event_time)::INT AS hr, l.direction, count(*) AS n
        FROM entry_exit_log l
        JOIN students st ON st.student_id = l.student_id
        WHERE l.event_time::date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
        GROUP BY 1, 2
    )
    SELECT hrs.hr, d.direction, COALESCE(c.n, 0)::INT
    FROM generate_series(0, 23) AS hrs(hr)
    CROSS JOIN (VALUES ('IN'), ('OUT')) AS d(direction)
    LEFT JOIN counts c ON c.hr = hrs.hr AND c.direction = d.direction
    ORDER BY hrs.hr, d.direction;
$$;
-- @end

-- @report time_outside
-- Technique: LEAD() window function (through the view v_report_trips, which pairs each
-- OUT with the student's next IN). Average hours outside per trip, by weekday and hostel.
CREATE FUNCTION report_time_outside(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (hostel TEXT, weekday TEXT, weekday_no INT, trips INT, avg_hours NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT h.name, to_char(t.out_time, 'Dy'), extract(isodow FROM t.out_time)::INT,
           count(*)::INT,
           round(avg(extract(epoch FROM (t.in_time - t.out_time)) / 3600.0)::NUMERIC, 2)
    FROM v_report_trips t
    JOIN hostels h ON h.hostel_id = t.hostel_id
    WHERE t.out_time::date BETWEEN p_from AND p_to
      AND (p_hostel IS NULL OR t.hostel_id = p_hostel)
    GROUP BY h.name, to_char(t.out_time, 'Dy'), extract(isodow FROM t.out_time)
    ORDER BY h.name, 3;
$$;
-- @end

-- @report leave_summary
-- Technique: aggregate FILTER and ordered-set aggregate percentile_cont (median).
-- Leave requests by status per hostel, with the median length in days and the median
-- number of days between the decision and the first day of leave.
-- (A median approval TIME is not possible: the table has no "requested at" column.)
CREATE FUNCTION report_leave_summary(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (hostel TEXT, status TEXT, requests INT, median_days NUMERIC, median_lead_days NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT h.name, l.status, count(*)::INT,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (l.end_date - l.start_date + 1)))::NUMERIC, 1),
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (l.start_date - l.decided_at::date))
                  FILTER (WHERE l.decided_at IS NOT NULL))::NUMERIC, 1)
    FROM leave_requests l
    JOIN students st ON st.student_id = l.student_id
    JOIN hostels h   ON h.hostel_id   = st.hostel_id
    WHERE l.start_date BETWEEN p_from AND p_to
      AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
    GROUP BY h.name, l.status
    ORDER BY h.name, l.status;
$$;
-- @end

-- @report recognition_outcomes
-- Technique: aggregate FILTER over date_trunc('week'). The vector side: how face scans
-- ended (matched / low_confidence / no_match) and the average similarity per week.
CREATE FUNCTION report_recognition_outcomes(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (week TEXT, scans INT, matched INT, low_confidence INT, no_match INT, avg_similarity NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT to_char(date_trunc('week', e.event_time), 'YYYY-MM-DD'), count(*)::INT,
           (count(*) FILTER (WHERE e.outcome = 'matched'))::INT,
           (count(*) FILTER (WHERE e.outcome = 'low_confidence'))::INT,
           (count(*) FILTER (WHERE e.outcome = 'no_match'))::INT,
           round(avg(e.confidence)::NUMERIC, 3)
    FROM face_events e
    JOIN cameras c ON c.camera_id = e.camera_id
    JOIN gates g   ON g.gate_id   = c.gate_id
    WHERE e.event_time::date BETWEEN p_from AND p_to
      AND (p_hostel IS NULL OR g.hostel_id = p_hostel)
    GROUP BY date_trunc('week', e.event_time)
    ORDER BY date_trunc('week', e.event_time);
$$;
-- @end

-- @report similarity_distribution
-- Technique: width_bucket() histogram. How many scans fell into each similarity band
-- (0.0-0.1 ... 0.9-1.0), per outcome.
CREATE FUNCTION report_similarity_distribution(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (band TEXT, band_no INT, outcome TEXT, scans INT)
LANGUAGE sql STABLE AS $$
    WITH binned AS (
        SELECT least(width_bucket(e.confidence, 0, 1, 10), 10) AS b, e.outcome, count(*) AS n
        FROM face_events e
        JOIN cameras c ON c.camera_id = e.camera_id
        JOIN gates g   ON g.gate_id   = c.gate_id
        WHERE e.confidence IS NOT NULL
          AND e.event_time::date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR g.hostel_id = p_hostel)
        GROUP BY 1, 2
    )
    SELECT to_char((bk.b - 1) / 10.0, 'FM0.0') || '-' || to_char(bk.b / 10.0, 'FM0.0'),
           bk.b, o.outcome, COALESCE(x.n, 0)::INT
    FROM generate_series(1, 10) AS bk(b)
    CROSS JOIN (VALUES ('matched'), ('low_confidence'), ('no_match')) AS o(outcome)
    LEFT JOIN binned x ON x.b = bk.b AND x.outcome = o.outcome
    ORDER BY bk.b, o.outcome;
$$;
-- @end

-- @report low_attendance_students
-- Technique: subqueries. A derived table computes each student's attendance, an IN
-- subquery keeps students with at least 3 marks, and the outer WHERE keeps those
-- below the threshold (default 75 %).
CREATE FUNCTION report_low_attendance_students(p_from DATE, p_to DATE, p_hostel INT, p_threshold NUMERIC DEFAULT 75)
RETURNS TABLE (student TEXT, roll_no TEXT, hostel TEXT, marks INT, present INT, attendance_pct NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT t.name, t.roll_no, t.hostel, t.marks::INT, t.present::INT, t.pct
    FROM (
        SELECT st.student_id, st.name, st.roll_no, h.name AS hostel,
               count(*) AS marks,
               count(*) FILTER (WHERE a.status = 'present') AS present,
               round(100.0 * count(*) FILTER (WHERE a.status = 'present') / count(*), 1) AS pct
        FROM students st
        JOIN hostels h ON h.hostel_id = st.hostel_id
        JOIN attendance a ON a.student_id = st.student_id
        JOIN attendance_sessions s ON s.session_id = a.session_id
        WHERE s.session_date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
        GROUP BY st.student_id, st.name, st.roll_no, h.name
    ) t
    WHERE t.student_id IN (SELECT a2.student_id FROM attendance a2
                           GROUP BY a2.student_id HAVING count(*) >= 3)
      AND t.pct < p_threshold
    ORDER BY t.pct, t.name;
$$;
-- @end

-- @report top_words
-- Technique: full-text search. Splits violation details and leave reasons into
-- lexemes with to_tsvector('english', ...) and counts them; the 6 most common of EACH source are
-- listed (row_number() over the source), so the free-text leave reasons are not drowned out by
-- the fixed wording of the violation details.
CREATE FUNCTION report_top_words(p_from DATE, p_to DATE, p_hostel INT)
RETURNS TABLE (word TEXT, source TEXT, occurrences INT)
LANGUAGE sql STABLE AS $$
    WITH texts AS (
        SELECT 'violations' AS source, v.details AS body
        FROM violations v JOIN students st ON st.student_id = v.student_id
        WHERE v.raised_at::date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
        UNION ALL
        SELECT 'leave reasons', l.reason
        FROM leave_requests l JOIN students st ON st.student_id = l.student_id
        WHERE l.start_date BETWEEN p_from AND p_to
          AND (p_hostel IS NULL OR st.hostel_id = p_hostel)
    )
    SELECT w.word, w.source, w.occurrences
    FROM (
        SELECT u.lexeme::TEXT AS word, t.source, count(*)::INT AS occurrences,
               row_number() OVER (PARTITION BY t.source ORDER BY count(*) DESC, u.lexeme) AS rn
        FROM texts t, LATERAL unnest(to_tsvector('english', COALESCE(t.body, ''))) AS u(lexeme, positions, weights)
        WHERE u.lexeme ~ '^[a-z]{4,}$'
        GROUP BY u.lexeme, t.source
    ) w
    WHERE w.rn <= 6
    ORDER BY w.occurrences DESC, w.word;
$$;
-- @end

COMMIT;
