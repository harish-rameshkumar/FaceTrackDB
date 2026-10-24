-- =====================================================================
-- FaceTrackDB: full-text search (Person B)
-- Adds generated tsvector columns plus GIN indexes to violations.details
-- and leave_requests.reason, then shows ranked example searches.
-- Safe to re-run. Re-run after reloading schema.sql (it drops the tables).
-- =====================================================================

-- STORED generated columns stay in step with the text automatically, so no
-- trigger is needed. 'english' stems words: "returned" matches "return".
ALTER TABLE violations
    ADD COLUMN IF NOT EXISTS details_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(details, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_violations_details_fts
    ON violations USING gin (details_tsv);

ALTER TABLE leave_requests
    ADD COLUMN IF NOT EXISTS reason_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(reason, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_leave_reason_fts
    ON leave_requests USING gin (reason_tsv);

\echo
\echo '=== FTS 1. Violations about curfew OR leave, ranked ==='
SELECT v.violation_id, s.name, v.type,
       round(ts_rank(v.details_tsv, q)::numeric, 4) AS rank,
       v.details
FROM violations v
JOIN students s USING (student_id),
     to_tsquery('english', 'curfew | leave') AS q
WHERE v.details_tsv @@ q
ORDER BY rank DESC, v.violation_id;

\echo
\echo '=== FTS 2. Absences at a roll call (AND query, with highlighted match) ==='
SELECT v.violation_id, s.name,
       ts_headline('english', v.details, q, 'StartSel=[, StopSel=]') AS match,
       round(ts_rank(v.details_tsv, q)::numeric, 4) AS rank
FROM violations v
JOIN students s USING (student_id),
     to_tsquery('english', 'absent & roll & call') AS q
WHERE v.details_tsv @@ q
ORDER BY rank DESC, v.violation_id;

\echo
\echo '=== FTS 3. Leave requests mentioning medical or wedding (prefix and OR) ==='
SELECT l.leave_id, s.name, l.status, l.start_date,
       round(ts_rank(l.reason_tsv, q)::numeric, 4) AS rank,
       l.reason
FROM leave_requests l
JOIN students s USING (student_id),
     to_tsquery('english', 'medic:* | wedding') AS q
WHERE l.reason_tsv @@ q
ORDER BY rank DESC, l.leave_id;
