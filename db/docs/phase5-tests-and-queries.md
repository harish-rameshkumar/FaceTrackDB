# FaceTrackDB: SQL Tests, Queries and Index Evidence (Phase 5)

Everything here was run against PostgreSQL 16, the same major version as the project's Docker image, on a freshly loaded database (`db\load_all.ps1`). Timings are from one test machine; yours will differ, so run the files and screenshot your own output.

| File | What it does | How to run |
|---|---|---|
| `db/test_cases.sql` | 71 self-checking tests, prints PASS or FAIL | `Get-Content db\test_cases.sql \| docker compose exec -T postgres psql -U facetrack -d facetrackdb` |
| `db/queries.sql` | 10 important queries (JOIN, GROUP BY, HAVING, subqueries) | same command with `db\queries.sql` |
| `db/explain_demo.sql` | `EXPLAIN ANALYZE` before and after three indexes | same command with `db\explain_demo.sql` |

`test_cases.sql` and `explain_demo.sql` run inside one transaction and end with ROLLBACK, so they leave the database unchanged and can be repeated. `queries.sql` only reads.

## 1. Test cases

**Result: 71 passed, 0 failed.** A second run gave the same result, and row counts afterwards were unchanged.

| Group | Tests | What is attacked |
|---|---|---|
| Constraints | 19 | CHECK (leave dates, role, email, confidence, session times, phone, decision consistency), UNIQUE (email, session slot, gate name), NOT NULL, foreign keys, composite foreign keys (face event must belong to the same student, leave decider must be that student's parent), exclusion constraint (overlapping approved leave) |
| Triggers | 13 | Wrong hostel (FT003), outside roll-call window (FT004), present cannot be downgraded (FT005), decided leave is final (FT010), ended leave cannot be approved (FT011), wrong gate (FT021), OUT twice (FT022), out-of-order gate event (FT023), wrong user role (FT040) |
| Stored procedures | 39 | `mark_attendance`, `record_entry_exit`, `decide_leave`, `close_attendance_session`: the good path, the expected violations (`no_leave`, `late_return`, none when on approved leave), and every error code |

Each test states the SQLSTATE it expects and the one it got. Sample of the real output:

```
 n  | result | label                                                          | expected | got
----+--------+----------------------------------------------------------------+----------+------
  1 | PASS   | [constraint] leave end date before start date                  | 23514    | 23514
 19 | PASS   | [constraint] overlapping approved leave (exclusion constraint) | 23P01    | 23P01
 29 | PASS   | [trigger FT022] OUT twice in a row                             | FT022    | FT022
 44 | PASS   | [record_entry_exit] ...and a no_leave violation is raised      | no_leave | no_leave
 62 | PASS   | [decide_leave FT034] approving would overlap an approved leave | FT034    | FT034

 passed | failed | total
--------+--------+-------
     71 |      0 |    71
```

Error codes (FT001 to FT040) are listed in `db/docs/phase3-logic.md`.

## 2. Important queries

Run on the seed data. All are in `db/queries.sql`.

| Query | SQL features | Result on the seed data |
|---|---|---|
| Q1 Roll-call sheet for session 2 | JOIN, LEFT JOIN | Arun present, Karthik low_confidence, Rahul present |
| Q2 Attendance summary per student | GROUP BY, FILTER | Sneha 0%, Rahul 50%, the other four 100% |
| Q3 Students with more than one violation | GROUP BY, HAVING | Rahul (2, one open), Sneha (2, both open) |
| Q4 Violations per hostel and type | three-table JOIN, GROUP BY | 2 per hostel, one of each type listed |
| Q5 Students outside right now | correlated subquery | Sneha |
| Q6 Students on approved leave on 24 Oct 2026 | IN subquery | Arun |
| Q7 Students not yet marked in session 4 | NOT EXISTS | Arun, Karthik, Rahul |
| Q8 Parents with more than one ward | JOIN, GROUP BY, HAVING, string_agg | Ramanathan: Karthik R, Meena R |
| Q9 Recognition results by outcome | GROUP BY, avg | 11 matched (0.924), 1 low_confidence (0.712), 1 no_match (0.512) |
| Q10 Students below the average scan confidence | subquery inside HAVING | Karthik R (0.874), Rahul V (0.902) |

## 3. Index evidence with EXPLAIN ANALYZE

`explain_demo.sql` generates 300,000 gate events, 40,000 roll calls, 120,000 attendance rows and 120,000 violations (1,203 of them open). For each of three real indexes from `schema.sql`, it drops the index, runs the query, recreates the index, and runs the query again. Everything is rolled back at the end.

| Query | Index | Before | After | Faster by |
|---|---|---|---|---|
| Last 10 gate events of one student | `idx_log_student_time` | Parallel Seq Scan + sort, 19.945 ms | Index Scan, 0.033 ms | about 600 times |
| One gate's traffic for one week | `idx_log_gate_time` | Parallel Seq Scan, 17.226 ms | Bitmap Index Scan, 0.538 ms | about 32 times |
| Oldest 20 open violations (warden queue) | `idx_violations_open` (partial) | Seq Scan + sort, 7.707 ms | Index Scan, 0.028 ms | about 275 times |

**Why the partial index is worth it.** `idx_violations_open` only stores rows where `status = 'open'`, so it is **48 kB**, while the ordinary index on the same table (`idx_violations_student`) is **6,624 kB**. The warden's queue only ever asks about open violations, so the small index is enough, and it stays small as resolved violations pile up.

**Why the first index matters.** Without it, PostgreSQL reads every gate event (125,002 rows removed by the filter in each of two workers) and sorts what is left. With it, the rows are already stored in the right order, so it reads exactly 10.

## 4. Where this fits in the documentation PDF

| Required section | Material |
|---|---|
| SQL implementation | `schema.sql`, `seed.sql`, `triggers.sql`, `procedures.sql` |
| Important queries | Section 2 above |
| Testing results | Section 1 above, plus screenshots of the PASS/FAIL table |
| Indexing | Section 3 above, plus screenshots of the plans |
