# FaceTrackDB: SQL Tests, Queries and Index Evidence (Phase 5)

Everything here was run against PostgreSQL 16 (the project's Docker image) on a freshly loaded database. The timings in section 4 were measured on the author's laptop with Docker Desktop; other machines will show different numbers but the same plans.

**Run these on a separate test database,** so the live database (and the enrolled faces that belong to it) are never touched. `load_all.ps1` is not used for this, because it recreates every table, including `face_profiles`:

```powershell
docker compose exec postgres psql -U facetrack -d postgres -c "CREATE DATABASE facetrack_test"
foreach ($f in 'settings','schema','seed','triggers','procedures') { Get-Content "db\$f.sql" | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U facetrack -d facetrack_test | Out-Null }
```

In the commands below, use `-d facetrack_test` for the test database. `queries.sql` and `reports.sql` only read data, so they are also safe on the live database (`-d facetrackdb`), but the numbers will include whatever has been entered since the seed data.

| File | What it does | How to run |
|---|---|---|
| `db/test_cases.sql` | 71 self-checking tests, prints PASS or FAIL | `Get-Content db\test_cases.sql \| docker compose exec -T postgres psql -U facetrack -d facetrackdb` |
| `db/queries.sql` | 10 important queries (JOIN, GROUP BY, HAVING, subqueries) | same command with `db\queries.sql` |
| `db/reports.sql` | 5 demo reports: an average or total per hostel, camera, gate and student | same command with `db\reports.sql` |
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

## 3. Reports

`db/reports.sql` gives one number per group, in the style of "average salary of every department". Real output on the seed data (test database):

**Report 1. Average attendance percentage of every hostel** (`JOIN`, `GROUP BY`, `FILTER`)
```
         hostel         | students | roll_call_marks | attendance_percent
------------------------+----------+-----------------+--------------------
 Aryabhatta Boys Hostel |        3 |               6 |               83.3
 Kalam Girls Hostel     |        3 |               3 |               66.7
```

**Report 2. Average face-match confidence of every camera** (`LEFT JOIN`, `AVG`, `GROUP BY`)
```
 camera_id |         hostel         |   gate    |        location        | scans | avg_confidence | needed_attention
-----------+------------------------+-----------+------------------------+-------+----------------+------------------
         1 | Aryabhatta Boys Hostel | Main Gate | Main gate, entry lane  |     7 |          0.895 |                1
         2 | Aryabhatta Boys Hostel | Main Gate | Main gate, exit lane   |     2 |          0.913 |                0
         3 | Aryabhatta Boys Hostel | Back Gate | Back gate              |     0 |                |                0
         4 | Kalam Girls Hostel     | Main Gate | Girls hostel main gate |     4 |          0.823 |                1
```
Camera 3 has no scans, and its average is empty because there is nothing to average. The `LEFT JOIN` keeps it in the report.

**Report 3. Leave requests of every hostel: count and average length in days** (`AVG` of a date difference)
```
         hostel         |  status  | requests | avg_days
------------------------+----------+----------+----------
 Aryabhatta Boys Hostel | approved |        2 |      2.0
 Aryabhatta Boys Hostel | rejected |        1 |      2.0
 Kalam Girls Hostel     | pending  |        1 |      3.0
```

**Report 4. Violations of every student, most first**
```
 roll_no |    name    |         hostel         | violations | still_open
---------+------------+------------------------+------------+------------
 21EC012 | Rahul V    | Aryabhatta Boys Hostel |          2 |          1
 21EC020 | Sneha M    | Kalam Girls Hostel     |          2 |          2
 21CS001 | Arun Kumar | Aryabhatta Boys Hostel |          0 |          0
 21CS007 | Karthik R  | Aryabhatta Boys Hostel |          0 |          0
 21CS014 | Divya S    | Kalam Girls Hostel     |          0 |          0
 21IT003 | Meena R    | Kalam Girls Hostel     |          0 |          0
```

**Report 5. Gate traffic: entries and exits per gate**
```
         hostel         |   gate    | entries | exits | total
------------------------+-----------+---------+-------+-------
 Aryabhatta Boys Hostel | Back Gate |       0 |     0 |     0
 Aryabhatta Boys Hostel | Main Gate |       2 |     2 |     4
 Kalam Girls Hostel     | Main Gate |       0 |     1 |     1
```

## 4. Index evidence with EXPLAIN ANALYZE

`explain_demo.sql` generates 300,000 gate events, 40,000 roll calls, 120,000 attendance rows and 120,000 violations (1,203 of them open). For each of three real indexes from `schema.sql`, it drops the index, runs the query, recreates the index, and runs the query again. Everything is rolled back at the end.

| Query | Index | Before | After | Faster by |
|---|---|---|---|---|
| Last 10 gate events of one student | `idx_log_student_time` | Parallel Seq Scan + sort, 21.811 ms | Index Scan, 0.156 ms | about 140 times |
| One gate's traffic for one week | `idx_log_gate_time` | Parallel Seq Scan, 54.566 ms | Bitmap Index Scan, 0.643 ms | about 85 times |
| Oldest 20 open violations (warden queue) | `idx_violations_open` (partial) | Seq Scan + sort, 13.062 ms | Index Scan, 0.053 ms | about 245 times |

**Why the partial index is worth it.** `idx_violations_open` only stores rows where `status = 'open'`, so it is **48 kB**, while the ordinary index on the same table (`idx_violations_student`) is **6,624 kB**. The warden's queue only ever asks about open violations, so the small index is enough, and it stays small as resolved violations pile up.

**Why the first index matters.** Without it, PostgreSQL reads every gate event (125,002 rows removed by the filter in each of two workers) and sorts what is left. With it, the rows are already stored in the right order, so it reads exactly 10.

## 5. Where this fits in the documentation PDF

| Required section | Material |
|---|---|
| SQL implementation | `schema.sql`, `seed.sql`, `triggers.sql`, `procedures.sql` |
| Important queries | Section 2 above |
| Reports in the demo | Section 3 above |
| Testing results | Section 1 above, plus screenshots of the PASS/FAIL table |
| Indexing | Section 4 above, plus screenshots of the plans |
