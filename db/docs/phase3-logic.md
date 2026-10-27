# FaceTrackDB: Database Logic (Phase 3)

Triggers, stored procedures, transactions and a concurrency test for the PostgreSQL side. Everything here was run against PostgreSQL 16, the same major version as the project's Docker image.

## 1. Files and load order

| File | Purpose |
|---|---|
| `db/settings.sql` | Sets the database timezone to Asia/Kolkata and enables `btree_gist` |
| `db/schema.sql` | Tables, constraints, indexes (Phase 2) |
| `db/seed.sql` | Sample data (Phase 2) |
| `db/triggers.sql` | Triggers and supporting constraints |
| `db/procedures.sql` | The four stored procedures |
| `db/transactions_demo.sql` | Three transaction scenarios, repeatable (each ends in ROLLBACK) |
| `db/migrations/*.sql` | Idempotent upgrades (`resolved_at`, `token_version`, `login_attempts` and its two functions). `schema.sql` and `procedures.sql` already contain the same objects; the migrations exist so a database that must be kept can be upgraded without reloading |
| `db/load_all.ps1` | Runs the five files above in order (Windows) |
| `db/load_all.sh`, `db/migrate.sh` | macOS/Linux: everything in order incl. migrations, demo passwords and `load_b.sh`; refuses to wipe enrolled faces without `--yes`. `migrate.sh` alone upgrades an existing database |

Load order matters: `settings, schema, seed, triggers, procedures`. `schema.sql` drops the tables, which also drops their triggers, so after reloading the schema always run `triggers.sql` again. `load_all.ps1` does all of it:

```powershell
powershell -ExecutionPolicy Bypass -File .\db\load_all.ps1
```

**Why `settings.sql` exists.** The Postgres container runs on UTC. Without the timezone setting, `now()` defaults would be 5h30m behind the hostel clock and no scan would ever fall inside a roll-call window.

## 2. Where each rule is enforced

| Rule | Mechanism |
|---|---|
| One attendance row per student per session | Primary key (session_id, student_id) |
| Student must live in the session's hostel | Trigger `trg_attendance_validate` |
| Present/low-confidence mark must fall inside the session window | Trigger `trg_attendance_validate` |
| A present mark can never be downgraded | Trigger `trg_attendance_validate` |
| A decided leave request is final | Trigger `trg_leave_guard` |
| An ended leave cannot be approved | Trigger `trg_leave_guard` |
| No two approved leaves overlap for one student | Exclusion constraint `leave_no_overlap` (safe under concurrency) |
| Only a parent linked to the student can decide leave | Composite foreign key (Phase 2) plus a friendly check in `decide_leave` |
| Gate must belong to the student's hostel | Trigger `trg_entry_exit_validate` |
| Gate events arrive in time order, and IN/OUT alternate | Trigger `trg_entry_exit_validate` with a per-student advisory lock |
| Camera of a face event must be at the gate used | `record_entry_exit` |
| Student/parent/warden user ids must have the matching role | Trigger `fn_check_user_role` on students, parents, `face_events.reviewed_by`, `violations.resolved_by` |
| Same violation cannot be raised twice | Partial unique indexes on violations |

## 3. Procedures

All four run as a single transaction: if any step fails, everything the procedure did is undone. Pass `NULL` for OUT parameters.

| Procedure | Returns | What it does |
|---|---|---|
| `mark_attendance(student_id, session_id, event_id)` | `p_status`: `present` or `low_confidence` | Records one student's roll-call result. `event_id` NULL means a warden marked manually. |
| `record_entry_exit(student_id, gate_id, event_id, direction)` | `p_log_id`, `p_violation_type` | Writes the gate log, then applies the hostel rules and raises a violation in the same transaction. |
| `close_attendance_session(session_id)` | `p_absent`, `p_violations` | After a roll call ends: marks non-scanners absent, raises `missed_attendance` for those without approved leave. Safe to call twice. |
| `decide_leave(leave_id, parent_id, decision)` | nothing | A parent approves or rejects a pending request. |

**Hostel rules used by `record_entry_exit`** (constants at the top of the procedure, easy to change):

| Event | Violation | Unless |
|---|---|---|
| OUT at or after 20:00, or before 05:00 | `no_leave` | approved leave covers that date |
| IN at or after 22:30, or before 05:00 | `late_return` | approved leave covers that date |

### Calling them from Next.js

```ts
const { rows } = await pool.query(
  "CALL mark_attendance($1, $2, $3, NULL)",
  [studentId, sessionId, eventId]
);
// rows[0].p_status is 'present' or 'low_confidence'
```

Failures arrive as errors whose `code` is one of the codes in section 4:

```ts
try {
  await pool.query("CALL decide_leave($1, $2, $3)", [leaveId, parentId, decision]);
} catch (e: any) {
  if (e.code === "FT032") return Response.json({ error: e.message }, { status: 409 });
  throw e;
}
```

### Saving the face event and the mark together

The matching endpoint should write the `face_events` row and call the procedure in one transaction. A duplicate scan is common, so use a savepoint to keep the event log even when the mark is rejected:

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const ev = await client.query(
    "INSERT INTO face_events (camera_id, student_id, confidence, outcome) VALUES ($1,$2,$3,$4) RETURNING event_id",
    [cameraId, studentId, confidence, outcome]);
  await client.query("SAVEPOINT attempt");
  try {
    await client.query("CALL mark_attendance($1,$2,$3,NULL)", [studentId, sessionId, ev.rows[0].event_id]);
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT attempt");   // keep the event, drop the failed mark
    // report e.code to the caller
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
}
```

## 4. Error codes

| Code | Meaning | Suggested HTTP |
|---|---|---|
| FT001 | Attendance already recorded for this student and session | 409 |
| FT002 | Attendance session not found | 404 |
| FT003 | Student does not live in the session's hostel | 403 |
| FT004 | Mark time is outside the session window | 422 |
| FT005 | A present mark cannot be downgraded | 409 |
| FT006 | Face event not found | 404 |
| FT007 | Face event does not belong to this student | 422 |
| FT008 | Session has not ended yet | 409 |
| FT009 | Student not found | 404 |
| FT010 | Decided leave request cannot be changed | 409 |
| FT011 | Leave that already ended cannot be approved | 422 |
| FT020 | Direction must be IN or OUT | 400 |
| FT021 | Gate does not belong to the student's hostel | 422 |
| FT022 | Student is already IN/OUT (directions must alternate) | 409 |
| FT023 | Event is not after the student's last gate event | 409 |
| FT024 | Face event was captured at a different gate | 422 |
| FT030 | Leave decision must be approved or rejected | 400 |
| FT031 | Leave request not found | 404 |
| FT032 | Leave request already decided | 409 |
| FT033 | Parent is not a parent of this student | 403 |
| FT034 | Approving would overlap another approved leave | 409 |
| FT040 | A user id has the wrong role for this column | 422 |

FT050 to FT055 and FT060 to FT061 come from `db/b_register.sql` (registration, deletion rules, roll-call creation). The app never sends the database's own message text: every code has a fixed message in `app/lib/db-errors.ts`.

Standard PostgreSQL codes can also appear: `23505` unique violation, `23503` foreign key, `23514` CHECK, `23P01` exclusion.

## 4b. Login rate limiting

`login_retry_after(email, ip)` returns the seconds to wait (0 = allowed) and `login_record(email, ip, succeeded)` records an attempt. 5 failures for one email within 15 minutes lock that email until the 5th most recent failure is 15 minutes old; a success clears the email's counter; 20 failures from one address lock the address. Known and unknown emails are treated identically. The app checks it before looking the email up.

## 4c. Leave cancellation

A student may cancel (DELETE) their own request **only while it is pending**; the app does it with `DELETE ... WHERE status = 'pending'` so it cannot race a parent's decision. A decided request is never deleted by the app, and `fn_leave_guard` still refuses to change it.

## 5. Transactions

`db/transactions_demo.sql` runs three scenarios and ends each with ROLLBACK, so it can be repeated. Real output:

**A. Late-night exit.** A face event, a gate log row and a violation are written in one transaction.
```
 log_id | direction |     event_time      | violation
      6 | OUT       | 2026-10-22 23:05:00 | no_leave
After ROLLBACK:  gate_logs_for_arun = 0
```

**B. Duplicate scan.** The procedure raises FT001, and the face event inserted earlier in the same transaction is undone with it.
```
face_events_before = 13
ERROR:  Student 1 already has attendance for session 1 (present)
face_events_after  = 13
```

**C. Closing a roll call.** Absent rows and violations appear together (3 absent, 3 violations).

## 6. Concurrency test

Three situations where two requests arrive at the same moment. I ran each with two real database sessions: session 1 held its transaction open for 4 seconds, and session 2 started one second later.

| Scenario | Session 1 | Session 2 | Result |
|---|---|---|---|
| 1. Two scans of the same student for the same roll call | marks present | waited about 3 s, then `FT001` | exactly 1 attendance row |
| 2. Two OUT scans of the same student | records OUT | waited about 3 s, then `FT022` | exactly 1 gate log row |
| 3. Both parents decide the same leave | approves | waited about 3 s, then `FT032` | leave approved once, by the first parent |

Why it is safe: scenario 1 relies on the unique index (the second insert waits for the first to commit, then `ON CONFLICT DO NOTHING` inserts nothing). Scenario 2 relies on a per-student advisory lock taken in the trigger. Scenario 3 relies on `SELECT ... FOR UPDATE` on the leave row.

### Run it yourself (two terminals)

Start from a freshly loaded database (`load_all.ps1`). In either terminal, open psql with
`docker compose exec postgres psql -U facetrack -d facetrackdb` and run the setup once:

```sql
INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time) VALUES
  (1, 1, 0.930, 'matched', '2026-10-22 22:10:00'),
  (1, 1, 0.920, 'matched', '2026-10-22 22:10:01'),
  (2, 1, 0.950, 'matched', '2026-10-22 18:00:00'),
  (2, 1, 0.940, 'matched', '2026-10-22 18:00:01')
RETURNING event_id;
INSERT INTO leave_requests (student_id, start_date, end_date, reason)
VALUES (1, '2026-11-10', '2026-11-12', 'Diwali break') RETURNING leave_id;
```

On a fresh load the event ids are 14, 15, 16, 17 and the leave id is 5. If yours differ, use the numbers printed by `RETURNING`.

**Scenario 1**

| Terminal 1 | Terminal 2 |
|---|---|
| `BEGIN;` | |
| `CALL mark_attendance(1, 4, 14, NULL);` | |
| | `CALL mark_attendance(1, 4, 15, NULL);` (hangs, waiting) |
| `COMMIT;` | the error `FT001` appears now |

**Scenario 2**

| Terminal 1 | Terminal 2 |
|---|---|
| `BEGIN;` | |
| `CALL record_entry_exit(1, 1, 16, 'OUT', NULL, NULL);` | |
| | `CALL record_entry_exit(1, 1, 17, 'OUT', NULL, NULL);` (hangs) |
| `COMMIT;` | the error `FT022` appears now |

**Scenario 3**

| Terminal 1 | Terminal 2 |
|---|---|
| `BEGIN;` | |
| `CALL decide_leave(5, 2, 'approved');` | |
| | `CALL decide_leave(5, 1, 'rejected');` (hangs) |
| `COMMIT;` | the error `FT032` appears now |

Check the result in either terminal:

```sql
SELECT count(*) FROM attendance WHERE session_id = 4 AND student_id = 1;   -- 1
SELECT count(*) FROM entry_exit_log WHERE student_id = 1;                  -- 1
SELECT status, decided_by FROM leave_requests WHERE leave_id = 5;          -- approved, 2
```

Reload with `load_all.ps1` afterwards to reset.

## 7. Syllabus mapping

| Feature | Where | Unit |
|---|---|---|
| Triggers | attendance, leave, gate log, role checks | 2 |
| Stored procedures | the four procedures above | 2 |
| Transactions | all-or-nothing procedures, `transactions_demo.sql`, savepoint pattern | 4 |
| Concurrency control | unique index, advisory lock, row lock, exclusion constraint | 4 |
| Indexing | 12 indexes in `schema.sql`, 2 partial unique indexes here | 3 |
| Database-level validation | CHECK, UNIQUE, composite foreign keys (Phase 2) | 1 |
