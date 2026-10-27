# FaceTrackDB
## Person B: face recognition, vector search and reporting

Face embedding service (InsightFace), Qdrant setup, face enrolment and matching, reporting SQL (views, CTEs, window functions, full-text search), and the enrolment / gate / warden review pages. Design details: [docs/vector-design.md](docs/vector-design.md). Test results: [docs/test-results.md](docs/test-results.md). Queries: [docs/important-queries.md](docs/important-queries.md), [docs/query-optimization.md](docs/query-optimization.md).

### Setup

Needs Docker, Node 20+ and (for the camera pages) a webcam and a browser on `localhost` or HTTPS.

1. **Environment files** (never committed). From the repo root:
   ```bash
   cp .env.example .env            # read by docker compose and db/load_b.sh
   cp .env app/.env.local          # read by the Next.js app and the scripts
   ```
   Edit both: set real values for `POSTGRES_PASSWORD` (and the same password inside `DATABASE_URL`), set `QDRANT_API_KEY` to a long random string (for example `openssl rand -hex 16`), and set `JWT_SECRET` to a random string of **at least 32 characters** (for example `openssl rand -hex 32`); login refuses to work with a shorter or missing secret, and `app/.env.local` needs the same values. Also set `EMBEDDER_TOKEN` (a shared secret for the face embedding service, at least 16 characters, for example `openssl rand -hex 16`) in both files; `EMBEDDER_URL` is `http://127.0.0.1:8001`.
2. **Start the databases** (ports are bound to 127.0.0.1 only):
   ```bash
   docker compose up -d --build
   ```
   This also builds and starts the **embedder** (the InsightFace face-embedding service in [embedder/](embedder/README.md)). The first build takes a few minutes and the first start downloads the model pack (about 280 MB) into a Docker volume; check with `curl http://127.0.0.1:8001/health` and `docker compose exec embedder python smoke_test.py`. If Docker cannot build it on your machine, use the local-virtualenv alternative described in `embedder/README.md`; the app only needs `EMBEDDER_URL`. The InsightFace pretrained models are for non-commercial research use only (this is a university project).

   If the containers already exist from an older compose file, recreate them so the new port binding and Qdrant API key take effect; data volumes are kept: `docker compose down && docker compose up -d`.
3. **Load the base SQL** in this order (Person A's files; `load_all.ps1` does the same on Windows). `demo_passwords.sql` must come after `seed.sql`: the seed has placeholder password hashes, so nobody can sign in without it.
   ```bash
   set -a; . ./.env; set +a
   for f in settings schema seed triggers procedures demo_passwords; do
     docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/$f.sql
   done
   ```
   **Warning: do not reload `db/schema.sql` (or run `load_all.ps1`) on a database with enrolled faces without re-enrolling.** It drops `face_profiles`, which orphans every vector in Qdrant. If you do reload, run `cd app && npm run qdrant:reset -- --yes`, then enrol everyone again at `/enrol`. To only set the demo passwords on an existing database, run `db/demo_passwords.sql` alone: it just updates `users`.
4. **Load the reporting SQL** (views, example queries, full-text search). Re-run it whenever `schema.sql` is reloaded, because that drops the tables and their views:
   ```bash
   ./db/load_b.sh            # add --demo for the EXPLAIN before/after demo
   ```
5. **App, Qdrant collection and test vectors:**
   ```bash
   cd app
   npm install
   npm run qdrant:init       # creates face_embeddings (512-d, Cosine); safe to repeat
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
| `/enrol` | admin | guided capture of 5 webcam frames, quality check, duplicate-face check, store 5 face embeddings |
| `/gate` | security, admin | scan faces (3 frames per scan) for gate in/out or roll call |
| `POST /api/faces/enrol`, `DELETE /api/faces/[id]` | admin | enrol (5 JPEG frames, multipart) / remove face embeddings (PostgreSQL + Qdrant) |
| `POST /api/faces/match` | security, admin | match 3 JPEG frames (multipart), log the face event, mark attendance or gate log |
| `POST /api/review/[eventId]` | warden, admin | decide a low-confidence event |
| `GET /api/health` | none | PostgreSQL, Qdrant and collection status (the embedder has its own `/health` on port 8001) |

The dashboard and search read the views and full-text columns created by `./db/load_b.sh` (step 4), so run it before opening them.

### Face recognition and thresholds

The browser only captures JPEG frames. The Next.js server sends them to the embedder (InsightFace buffalo_l: SCRFD detector + ArcFace 512-d embeddings), checks image quality, and searches Qdrant (collection `face_embeddings`, 512-d, **Cosine**; higher similarity is closer). Full design: [docs/vector-design.md](docs/vector-design.md).

| Variable | Default | Meaning |
|---|---|---|
| `MATCH_MIN_SIMILARITY` | 0.50 | a student's score at or above this is an automatic match |
| `REVIEW_MIN_SIMILARITY` | 0.35 | from here up to the match value the scan goes to the warden; below it is no match. Also the duplicate-face limit at enrolment |
| `MIN_MARGIN` | 0.08 | the winner must beat the best other student by this much, otherwise the scan goes to the warden |
| `FACE_MIN_DET_SCORE`, `FACE_MIN_WIDTH`, `FACE_MIN_BLUR` | 0.6, 80 px, 20 | quality gate on every image (exactly one face; clear, big and sharp enough) |
| `EMBEDDER_URL`, `EMBEDDER_TOKEN` | `http://127.0.0.1:8001`, (secret) | the embedding service and its shared secret |
| `SCAN_COOLDOWN_SECONDS` | 20 | minimum seconds between two **gate in/out** scans of the same student (not roll call). `0` turns it off; anything that is not a non-negative integer falls back to 20 with a warning in the server log |

A student's score is the mean of their best two sample similarities. At the gate three frames are sent about 300 ms apart and the same student must win on at least two of them. Enrolment uses five guided frames and refuses a face that already matches another student. **The default numbers are starting guesses, not measured values.** Calibrate them with your own photos: `cd app && npm run faces:eval -- <folder>` (one subfolder per person, 5+ photos each, at least 4 people; details in vector-design.md section 7).

**Known limits:** no liveness check (a printed photo can pass); accuracy has only been measured on the evaluation set you give it.

**Scan cooldown.** Without it, a student standing in front of the camera is scanned again and again and flips IN/OUT. A gate scan of a recognised student less than `SCAN_COOLDOWN_SECONDS` after their last gate scan is refused with HTTP 429 (`{ "code": "scan_cooldown", "retryAfterSeconds": N }` and a `Retry-After` header). Nothing is written, and `/gate` shows a calm "Already scanned. Please wait N seconds." notice. The check runs in the match endpoint under a per-student lock, so simultaneous scans cannot both pass.

**Upgrading from the old 128-d face-api version:** the old vectors are invalid. Run `cd app && npm run qdrant:reset -- --yes` (prints what it will delete, then deletes the `face_profiles` rows and recreates the 512-d collection; scan history is kept) and re-enrol everyone at `/enrol`.

### Tests

The matching tests write fake enrolments, so they only run against a scratch database and a `_test` Qdrant collection (they refuse anything else). Details and real output: [docs/test-results.md](docs/test-results.md).

```bash
# 1. a scratch database loaded with the SQL files, and the embedder running (docker compose up -d)
cd app
export DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/<scratch_db>   # name must contain "test" or "scratch"
export QDRANT_COLLECTION=face_embeddings_test
npm run qdrant:reset -- --yes && npm run seed:faces      # synthetic 512-d vectors, test collection only
# 2. a server with the same environment (the tests use it for the 401/403/400 checks)
SCAN_COOLDOWN_SECONDS=3 npm run dev                     # terminal 1
# 3. the rules: synthetic vectors, in-process
SCAN_COOLDOWN_SECONDS=3 BASE_URL=http://localhost:3000 npm run test:match      # terminal 2
SCAN_COOLDOWN_SECONDS=0 BASE_URL=http://localhost:3000 npm run test:match      # again, cooldown off
# 4. the embedder
docker compose exec embedder python smoke_test.py
# 5. real images through the HTTP API (unset QDRANT_COLLECTION and run qdrant:reset first; folder layout as for faces:eval)
BASE_URL=http://localhost:3000 npm run test:faces -- <folder with 4+ people, 8+ photos each>
npx tsc --noEmit && npm run lint && npm run build
```
The camera pages cannot be tested without a camera; see the hand-test list in [docs/test-results.md](docs/test-results.md).
