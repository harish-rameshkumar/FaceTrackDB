# FaceTrackDB
## Person B: face recognition, vector search and reporting

Qdrant setup, face enrolment and matching, reporting SQL (views, CTEs, window functions, full-text search), and the enrolment / gate / warden review pages. Design details: [docs/vector-design.md](docs/vector-design.md). Test results: [docs/test-results.md](docs/test-results.md). Queries: [docs/important-queries.md](docs/important-queries.md), [docs/query-optimization.md](docs/query-optimization.md).

### Setup

Needs Docker, Node 20+ and (for the camera pages) a webcam and a browser on `localhost` or HTTPS.

1. **Environment files** (never committed). From the repo root:
   ```bash
   cp .env.example .env            # read by docker compose and db/load_b.sh
   cp .env app/.env.local          # read by the Next.js app and the scripts
   ```
   Edit both: set real values for `POSTGRES_PASSWORD` (and the same password inside `DATABASE_URL`), set `QDRANT_API_KEY` to a long random string (for example `openssl rand -hex 16`), and set `JWT_SECRET` to a random string of **at least 32 characters** (for example `openssl rand -hex 32`); login refuses to work with a shorter or missing secret, and `app/.env.local` needs the same values.
2. **Start the databases** (ports are bound to 127.0.0.1 only):
   ```bash
   docker compose up -d
   ```
   If the containers already exist from an older compose file, recreate them so the new port binding and Qdrant API key take effect; data volumes are kept: `docker compose down && docker compose up -d`.
3. **Load the base SQL** in this order (Person A's files; `load_all.ps1` does the same on Windows). `demo_passwords.sql` must come after `seed.sql`: the seed has placeholder password hashes, so nobody can sign in without it.
   ```bash
   set -a; . ./.env; set +a
   for f in settings schema seed triggers procedures demo_passwords; do
     docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/$f.sql
   done
   ```
   **Warning: do not reload `db/schema.sql` (or run `load_all.ps1`) on a database with enrolled faces without re-enrolling.** It drops `face_profiles`, which orphans every vector in Qdrant. If you do reload, run `cd app && npm run qdrant:reset -- --yes`, then enrol everyone again at `/enrol` (or `npm run seed:faces` for the synthetic test students). To only set the demo passwords on an existing database, run `db/demo_passwords.sql` alone: it just updates `users`.
4. **Load the reporting SQL** (views, example queries, full-text search). Re-run it whenever `schema.sql` is reloaded, because that drops the tables and their views:
   ```bash
   ./db/load_b.sh            # add --demo for the EXPLAIN before/after demo
   ```
5. **App, Qdrant collection and test vectors:**
   ```bash
   cd app
   npm install
   npm run qdrant:init       # creates face_embeddings (128-d, Euclid); safe to repeat
   npm run seed:faces        # synthetic descriptors for the 6 seeded students (--reset to redo)
   npm run dev               # http://localhost:3000
   ```
6. **Signing in.** Open <http://localhost:3000/login>. Every seeded account has the shared demo password written in `db/demo_passwords.sql` (development only; change it for anything real). Seeded accounts by role: `admin1@facetrack.test`, `security1@facetrack.test`, `warden1@facetrack.test`, student `arun.kumar@facetrack.test`, parent `parent.senthil@facetrack.test` (more in `db/seed.sql`). Login sets an HttpOnly session cookie (JWT signed with `JWT_SECRET`, 8 hours); with curl use `POST /api/login` and send the cookie back. The old dev-only `x-dev-role` header and `dev_role` cookie no longer exist.

### Pages and endpoints

| Path | Role | What |
|---|---|---|
| `/login`, `POST /api/login`, `/api/logout`, `/api/me` | everyone | sign in / out (Person A) |
| `/student/leave`, `/parent/leave`, `/violations` | student, parent, warden/admin (violations) | leave requests and decisions, violations list (Person A) |
| `/warden` | warden, admin | dashboard: students inside/outside, on leave, open violations, scans waiting for review, presence and attendance tables with filters, monthly attendance per hostel |
| `/warden/search` | warden, admin | full-text search over violation details and leave reasons, ranked with highlighted matches |
| `/warden/review` | warden, admin | confirm or reject low-confidence scans |
| `/enrol` | admin | capture frames from the webcam, store face vectors |
| `/gate` | security, admin | scan faces for gate in/out or roll call |
| `POST /api/faces/enrol`, `DELETE /api/faces/[id]` | admin | enrol / remove face vectors (PostgreSQL + Qdrant) |
| `POST /api/faces/match` | security, admin | match a descriptor, log the face event, mark attendance or gate log |
| `POST /api/review/[eventId]` | warden, admin | decide a low-confidence event |
| `GET /api/health` | none | PostgreSQL, Qdrant and collection status |

The dashboard and search read the views and full-text columns created by `./db/load_b.sh` (step 4), so run it before opening them.

### Match thresholds

Matching uses **Euclidean distance** between face descriptors (smaller is closer), the metric the face-api model is trained for.

| Variable | Default | Meaning |
|---|---|---|
| `MATCH_MAX_DISTANCE` | 0.45 | distance at or below this is an automatic match |
| `REVIEW_MAX_DISTANCE` | 0.60 | above `MATCH_MAX_DISTANCE` up to this goes to the warden; above it is no match |

A match is also sent to the warden when another student's face is less than 0.06 further away than the best one. The defaults are starting guesses: tune them with real faces from your gate camera before relying on them (see [docs/vector-design.md](docs/vector-design.md)).

If you ever change the vector space or metric, run `cd app && npm run qdrant:reset -- --yes` (prints what it will delete, then deletes the `face_profiles` rows and recreates the collection; scan history is kept) and re-enrol everyone, or `npm run seed:faces` for the synthetic test students.

### Tests

```bash
cd app
npm run dev                                   # in one terminal
BASE_URL=http://localhost:3000 npm run test:match   # in another; cleans up after itself
npx tsc --noEmit && npm run lint && npm run build
```
The camera pages cannot be tested without a camera; see the hand-test list in [docs/test-results.md](docs/test-results.md).
