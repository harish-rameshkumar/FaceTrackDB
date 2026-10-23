# Important queries

All queries live in [db/b_queries.sql](../db/b_queries.sql) and [db/b_search.sql](../db/b_search.sql); load them with `./db/load_b.sh`. Output below is from the seeded database (first rows, trimmed).

## Views

**`v_current_presence`**: latest gate event per student decides inside/outside (LATERAL join); used by the warden dashboard.
```
 name       | hostel                 | last_direction | presence | on_leave_today
 Arun Kumar | Aryabhatta Boys Hostel |                | inside   | t
 Karthik R  | Aryabhatta Boys Hostel | IN             | inside   | f
 Sneha M    | Kalam Girls Hostel     | OUT            | outside  | f
```

**`v_attendance_summary`**: counts per status and an attendance percentage per student.
```
 name    | sessions_recorded | present | absent | attendance_pct
 Sneha M |                 1 |       0 |      1 |            0.0
 Karthik R |               2 |       1 |      0 |           50.0
 Arun Kumar |              2 |       2 |      0 |          100.0
```

**`v_open_violations`**: open violations joined to student and hostel.
```
 violation_id | type        | student | hostel
            1 | late_return | Rahul V | Aryabhatta Boys Hostel
            3 | no_leave    | Sneha M | Kalam Girls Hostel
```

**`v_review_queue`**: unreviewed low-confidence scans (uses `idx_face_events_review_queue`). Empty on the seed data because the only low-confidence event is already reviewed.

## CTEs

**Attendance % per hostel per month** (two chained CTEs):
```
 hostel                 | month      | marks | present | attendance_pct
 Aryabhatta Boys Hostel | 2026-10-01 |     6 |       4 |           66.7
 Kalam Girls Hostel     | 2026-10-01 |     3 |       2 |           66.7
```

**Students needing attention** (open violations + absences + current presence):
```
 name    | open_violations | absences | presence
 Sneha M |               2 |        1 | outside
 Rahul V |               1 |        1 | inside
```

## Window functions

**RANK / DENSE_RANK of students by violations within each hostel:**
```
 hostel                 | name       | violations | rank | dense_rank
 Aryabhatta Boys Hostel | Rahul V    |          2 |    1 |          1
 Aryabhatta Boys Hostel | Arun Kumar |          0 |    2 |          2
```

**Running count and gap since previous violation (`count() OVER`, `LAG`):**
```
 name    | type              | running_count | since_previous
 Rahul V | missed_attendance |             1 |
 Rahul V | late_return       |             2 | 02:10:20
```

**Time outside per trip (`LEAD` pairs each OUT with the next event):**
```
 name      | left_at             | returned_at         | time_outside
 Rahul V   | 2026-10-20 18:45:05 | 2026-10-21 00:40:22 | 05:55:17
 Karthik R | 2026-10-21 09:30:12 | 2026-10-21 21:50:40 | 12:20:28
```

## GROUP BY / HAVING, subqueries, JOIN, aggregates, DELETE

- **Q-A** GROUP BY + HAVING: hostels with at least one absence, busiest first (2 rows, 1 absence each).
- **Q-B** Subquery: students below their hostel's average attendance (Sneha M 0.0, Karthik R 50.0, Rahul V 50.0).
- **Q-C** `NOT EXISTS`: students with no gate crossing (Arun Kumar, Divya S, Meena R).
- **Q-D** Five-table JOIN: face events with camera, gate, hostel and student (latest: event 10, Rahul V, matched, 0.903).
- **Q-E** Aggregates by outcome: matched 11 (avg 0.924), low_confidence 1 (0.712), no_match 1 (0.512).
- **Q-F** UPDATE inside a rolled-back transaction.
- **Q-G** DELETE of resolved violations inside `BEGIN ... ROLLBACK`: count goes 1 → 0 → back to 1.

## Full-text search (GIN on generated `tsvector` columns)

- **FTS 1** `to_tsquery('curfew | leave')` over `violations.details`, ranked by `ts_rank`: violations 1 and 3 (rank 0.0304).
- **FTS 2** `absent & roll & call` with `ts_headline`: `[Absent] at the evening [roll] [call] on 20 October` (rank 0.2595).
- **FTS 3** `medic:* | wedding` over `leave_requests.reason`: Medical appointment, Cousin wedding.
