# Query optimisation: EXPLAIN before and after an index

Source: [db/b_explain_demo.sql](../db/b_explain_demo.sql), run with `./db/load_b.sh --demo` on PostgreSQL 16 (Docker). The seed data has only a handful of rows, so the script bulk-loads 300,000 gate events and 100,000 leave requests inside a transaction, measures, and ends with `ROLLBACK`; afterwards the tables are back to 5 and 4 rows and both indexes still exist. Numbers below are from one real run (cached data, so absolute times are small; the plan change and buffer counts are the point). Parallel workers were disabled to keep plans comparable.

| # | Query | Without the index | With the index |
|---|---|---|---|
| 1 | `SELECT ... FROM entry_exit_log WHERE student_id = 3 ORDER BY event_time DESC LIMIT 10` (index `idx_log_student_time`, B-tree on `student_id, event_time DESC`) | Seq Scan of 300,005 rows (250,003 removed by filter) + top-N sort. Execution **22.645 ms**, 1,911 buffers | Index Scan, stops after 10 rows. Execution **0.046 ms**, 5 buffers |
| 2 | `SELECT ... FROM leave_requests WHERE reason_tsv @@ to_tsquery('english','passport')` (index `idx_leave_reason_fts`, GIN on the generated tsvector) | Seq Scan, 100,003 rows removed. Execution **9.316 ms**, 1,664 buffers | Bitmap Index Scan + Bitmap Heap Scan. Execution **0.027 ms**, 5 buffers |

Reading it:
- Query 1: the composite index returns rows already ordered by `event_time DESC` for one student, so `LIMIT 10` reads about 10 index entries instead of scanning and sorting 50,000 matches.
- Query 2: a GIN index maps each word to the rows containing it, so a rare word touches one heap page instead of the whole table.

Caveats: single run, warm cache, synthetic data. Repeat the demo on your machine for your own numbers.
