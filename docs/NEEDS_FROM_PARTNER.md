Hi Harshit, here is where my side stands and what I need from you. Everything is on branch `b/vector-and-queries`; I did not edit any of your files.

**What I built**
- Qdrant collection `face_embeddings` (128-d, distance Euclid; descriptors are stored and searched raw, not normalised), enrolment API (`/api/faces/enrol`, delete), matching API (`/api/faces/match`) that writes `face_events` and calls `mark_attendance` / `record_entry_exit` in one transaction, review API for low-confidence events.
- Match rules: distance at or below `MATCH_MAX_DISTANCE` (0.45) is an automatic match; above that up to `REVIEW_MAX_DISTANCE` (0.60) goes to the warden as `low_confidence`; above 0.60 is `no_match`. Margin rule: a scan also goes to review if the nearest different student is less than 0.06 farther away than the best match.
- Real-face tests gave a distance of 0.222 for my face, 0.252 for a friend and 0.721 (no_match) for an unenrolled face.
- Pages: `/enrol`, `/gate`, `/warden/review`, a landing page.
- SQL in new files only: `db/b_queries.sql` (4 views, CTEs, window functions), `db/b_search.sql` (full-text search), `db/b_explain_demo.sql`, `db/load_b.sh`.
- `app/lib/db.ts` (one shared pg pool, Asia/Kolkata session timezone, TIMESTAMP/DATE returned as strings), `.mailmap`, localhost-only ports, Qdrant API key.

**What I need from you**
1. ~~Real auth replacing `app/lib/auth-stub.ts`.~~ **Done**: real JWT login is in `app/lib/auth.ts` and `app/lib/session.ts`, with the same exports, and my routes and pages use it unchanged. `auth-stub.ts` is now only a re-export and can be deleted once nothing imports it.
2. **Roll-call sessions.** Matching for attendance needs an `attendance_sessions` row for the hostel covering the current IST time. The seed has none for today, and nothing creates them. Please add a way to create them (warden/admin page or a job); I tested by inserting one.
3. **Decide about a `purpose` column on `face_events`** (optional). When a warden confirms a low-confidence scan, I only update the event (`outcome='matched'`, `reviewed_by`). I do not call `mark_attendance` / `record_entry_exit` because the event does not record whether it was a roll-call or gate scan. Proposed:
   ```sql
   ALTER TABLE face_events ADD COLUMN purpose VARCHAR(12)
       CHECK (purpose IN ('attendance', 'entry_exit'));
   ```
   Then confirm could finish the job. Not blocking.
4. **Re-run `./db/load_b.sh` after any `schema.sql` reload.** `schema.sql` drops the tables with CASCADE, which also drops my views and the extra columns below.

**What I assumed about your work**
- Procedure signatures exactly as in `db/procedures.sql`: `CALL mark_attendance(student, session, event, NULL)`, `CALL record_entry_exit(student, gate, event, 'IN'|'OUT', NULL, NULL)`. Error codes FT001-FT040 as in `phase3-logic.md`; I map them to fixed JSON messages.
- A `matched` event is the only kind that touches attendance or the gate log; `low_confidence` and `no_match` only create a `face_events` row.
- `face_events.confidence` is `max(0, 1 - distance)` (Euclidean distance), so it stays in your 0..1 CHECK.

**Changes my SQL makes to your tables (in `db/b_search.sql`)**
```sql
ALTER TABLE violations ADD COLUMN IF NOT EXISTS details_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(details, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_violations_details_fts ON violations USING gin (details_tsv);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reason_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(reason, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_leave_reason_fts ON leave_requests USING gin (reason_tsv);
```
Adds columns only; existing inserts are unaffected. If you would rather own this, move it into `schema.sql`.

**Things in your files that look wrong or risky**
1. `db/load_all.ps1` is PowerShell-only and hard-codes `-U facetrack -d facetrackdb`. There is no bash loader (I added only `load_b.sh`; the README has a loop for the base files).
2. `seed.sql` has `REPLACE_WITH_BCRYPT_HASH` for every user, so nobody can log in until real hashes exist.
3. `leave_requests.decided_by` is a parent id by foreign key, so a warden/admin can never decide leave. Fine if intended.
4. `fn_leave_guard` (`triggers.sql`, line 139) blocks every update on a decided leave, including an admin correction or cancellation.
5. `record_entry_exit`: the "on leave" test uses only the date of the event, so a late return after midnight on the day after the leave ends is flagged, and one before midnight on the first leave day is not. Check this is the rule you want.
6. `violations` has no `resolved_at` timestamp, so there is no record of when a violation was resolved.
7. `settings.sql` sets the database timezone with `ALTER DATABASE`, which only affects new connections. The app now forces Asia/Kolkata per connection, so it is safe, but psql sessions opened before the change still show UTC.
8. Updating `face_events.student_id` is blocked by the composite foreign keys from `attendance` / `entry_exit_log` (no `ON UPDATE`), so a warden cannot reassign an event that already produced attendance or a gate log. Review only touches unmarked low-confidence events, so this is fine today.
