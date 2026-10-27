# Status of the work handed to Harshit

This file used to be a list of requests from Person B (Harish) to Person A (Harshit). Harshit's remaining items were finished by Harish instead, once the rule "do not edit Harshit's files" was lifted. Each change is a small commit on `b/hardening-and-docs` (or an earlier stage branch) so it can be reviewed. Harshit still owns the original design, schema, triggers, procedures, login and leave pages; the entries below say what was added on top.

| Item (from AUDIT2 section 8) | Status | Done in | Why Harish did it |
|---|---|---|---|
| Roll-call sessions: create and close from the app | Done | `/warden/sessions` and `db/b_register.sql` (`create_attendance_session`, `session_close_preview`) | Blocked the attendance demo; the page uses the existing `close_attendance_session` procedure unchanged |
| `violations.resolved_at` | Done | migration `001`, `schema.sql`, `seed.sql`, resolve route, violations page | Needed for the audit trail; older resolved rows are backfilled with `raised_at` (an approximation, stated in the migration) |
| Raw database messages no longer returned | Done | `app/lib/db-errors.ts`, `app/lib/api-helpers.ts` | Messages contained ids (for example "Parent 3 is not a parent of student 4"); every FT code now has a fixed message |
| Login rate limiting | Done | migration `003`, `login_retry_after` / `login_record`, login route | In the database so it survives restarts; 5 failures per email or 20 per address in 15 minutes |
| Placeholder `JWT_SECRET` rejected | Done | `app/lib/jwt-secret.ts`, `.env.example` | The example value was 33 characters and passed the length check |
| Token revocation | Done | migration `002`, `app/lib/auth.ts` | A deleted or signed-out user kept access for up to 8 hours |
| Bash loader for the base SQL | Done | `db/load_all.sh`, `db/migrate.sh` | `load_all.ps1` is Windows-only (it still works); the new script refuses to wipe enrolled faces without `--yes` |
| README overview, objectives, requirements | Done | `README.md` (top), `docs/architecture.md`, `app/README.md` | Needed for the report and for new readers |
| Leave cancellation decision | Decided and done | `DELETE /api/leave/[id]` | A student may cancel their own **pending** request; a decided request stays final (`fn_leave_guard` is unchanged) |
| Page-level role checks on `/violations`, `/student/leave`, `/parent/leave`, `/student/history` | Done | `app/components/RoleGate.tsx` | The pages rendered an empty shell for any role and relied on the API |
| Cross-review of PRs | **Open** | n/a | Reviews need a second person; nothing a script can do. Please review the Stage 1 to 4 PRs and leave comments |

## Still open (not code)
- PR cross-review (above).
- A decision from the institution on how long face data and old history are kept (see `docs/privacy-and-biometric-policy.md`).
- Screenshots for the final report.

## Things to know before merging
- Schema changes are in `db/migrations/` **and** in `db/schema.sql`. On a database you want to keep, run `./db/migrate.sh`; do not reload `schema.sql` (it wipes `face_profiles` and orphans the Qdrant vectors).
- `db/load_all.sh` is the macOS/Linux counterpart of `load_all.ps1`. The PowerShell script was not changed.
- `dbErrorResponse` now returns `null` only for errors that are not database errors; routes that do `?? dbErrorResponse(e)` then `throw e` still work.
