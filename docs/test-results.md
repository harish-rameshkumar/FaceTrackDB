# Test results: face matching (InsightFace ArcFace, 512-d cosine)

Everything below was run on 2026-10-27 on the author's MacBook (Apple Silicon, Docker Desktop) against a **scratch** PostgreSQL database (`facetrack_scratch`, loaded from the SQL files) and a **second Qdrant** container on port 6334, so the real database and the real Qdrant collection were not touched. The embedder was the real `embedder` container.

## 1. Matching rules: `npm run test:match` (synthetic vectors)

These tests use **synthetic 512-d unit vectors** and call the scan logic (`processScan`, `enrolEmbeddings`) in-process; only the 401/403/400 checks go through HTTP. They prove the **rules** (thresholds, margin, multi-frame voting, duplicate guard, quality-gate decisions, cooldown, procedure errors), **not** that the model separates real people. Random directions in 512-d are almost orthogonal, which is far easier than real look-alikes.

The script refuses to run unless the database name contains `test` or `scratch` and `QDRANT_COLLECTION` ends in `_test`. How to run it:

```
cd app
export DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/facetrack_scratch   # scratch DB with db/*.sql + ./db/load_b.sh loaded
export QDRANT_COLLECTION=face_embeddings_test
npm run qdrant:reset -- --yes && npm run seed:faces          # empties the scratch face_profiles, creates the test collection, 3 samples for students 4-6
npm run build && npx next start -p 3200                      # or npm run dev; same env; only used for the 401/403/400 checks
SCAN_COOLDOWN_SECONDS=3 BASE_URL=http://localhost:3200 npm run test:match
SCAN_COOLDOWN_SECONDS=0 BASE_URL=http://localhost:3200 npm run test:match   # second run: cooldown disabled
```
Output of the run with `SCAN_COOLDOWN_SECONDS=3` (thresholds: match 0.50, review 0.35, margin 0.08; times IST):


| Case | Input | Expected | Actual | Result |
|---|---|---|---|---|
| Score: mean of best two | student 1 samples 0.9, 0.7, 0.1; student 2 sample 0.8 | student 1 = 0.800, student 2 = 0.800 (single sample) | 1=0.800, 2=0.800 | PASS |
| Thresholds and margin | score 0.6, 0.5, 0.45, 0.35, 0.34; 0.7 vs other 0.65; 0.7 vs other 0.55 (defaults 0.50/0.35/0.08) | matched, matched, low_confidence, low_confidence, no_match, low_confidence (margin 0.05), matched (margin 0.15) | matched, matched, low_confidence, low_confidence, no_match, low_confidence, matched | PASS |
| Frames: 3 of 3 agree | student 1 wins all three frames | matched, 3 agreeing | matched 3/3 | PASS |
| Frames: 2 of 3 agree | student 1 wins two frames, third is no_match | matched, 2 agreeing | matched 2/3 | PASS |
| Frames: all disagree | three different winners | low_confidence (never matched) | low_confidence | PASS |
| Frames: only 1 of 3 | one confident frame, two no_match | low_confidence | low_confidence | PASS |
| Frames: nobody | three no_match frames | no_match, no student | no_match student=null | PASS |
| Frames: one confident + weak agreement | student 1: matched + low_confidence; student 2: low_confidence | low_confidence (needs 2 CONFIDENT frames) | low_confidence student=1 | PASS |
| Quality gate | limits: score>=0.6, width>=80px, blur>=20 | no_face, multiple_faces, low_score, too_small, too_blurry, ok | no_face, multiple_faces, low_score, too_small, too_blurry, ok | PASS |
| Exact match | student 4's enrolled sample #1, three frames | matched, attendance present | 200 matched sim=0.868 conf=0.868 -> present; rows=1 | PASS |
| Noisy copy | student 5, three new photos at cosine 0.80 to the face | still matched, present | 200 matched sim=0.690 margin=0.601 -> present | PASS |
| Random vector | three unrelated random vectors | no_match, nobody marked | 200 no_match sim=0.134 conf=0.134 student=null | PASS |
| Review band | student 6, three photos at cosine 0.50 to the face (score ~0.42) | low_confidence, NOT marked, event kept | 200 low_confidence sim=0.445 conf=0.445; attendance rows=0 | PASS |
| Duplicate scan | student 4 again, same roll call | 409 FT001, event still logged, still 1 attendance row | 409 FT001; events +1; rows=1 | PASS |
| No roll call open | student 1 at hostel 1 camera (no session at 11:43 IST) | 409 no_active_session | 409 matched no_active_session | PASS |
| Wrong hostel | student 1 (hostel 1) scanned at hostel 2 camera | 403 FT003 | 403 FT003 | PASS |
| Multi-frame: only 1 of 3 frames | student 6 on one frame, random on the others | low_confidence, NOT marked | 200 low_confidence agreeing=1/3; rows=0 | PASS |
| Multi-frame: frames disagree | three different students, one frame each | low_confidence, NOT marked | 200 low_confidence student=4; rows(6)=0 | PASS |
| Multi-frame: 2 of 3 frames agree | student 6 on two frames, random on the third | matched, present | 200 matched agreeing=2/3; rows=1 | PASS |
| Outside window (DB) | CALL mark_attendance on a past session | database rejects with FT004 | FT004 | PASS |
| Gate: first scan | student 4, direction inferred, 11:43 IST | OUT, violation null | 200 matched OUT violation=null | PASS |
| Gate: return | student 4, IN, 11:43 IST | IN, violation null | 200 IN violation=null | PASS |
| Gate: duplicate IN | student 4 IN twice | 409 FT022, event still logged | 409 FT022; events +1 | PASS |
| Cooldown config | SCAN_COOLDOWN_SECONDS = 0, 3, unset, '', abc, -5, 1.5 | 0, 3, 20, 20, 20, 20, 20 (0 disables) | 0, 3, 20, 20, 20, 20, 20 | PASS |
| Cooldown: second scan refused | student 4 gate scan right after another (cooldown 3s) | 429 scan_cooldown, Retry-After set, no new face event / gate log / violation, direction unchanged | 200 then 429 scan_cooldown retry=3 header=3; events +0, logs +0, violations +0, last=OUT | PASS |
| Cooldown: other student unaffected | student 5 gate scan while student 4 is cooling down | 200 recorded for 5, student 4 still 429 | student 5: 200 OUT; student 4: 429 | PASS |
| Cooldown: allowed again after waiting | student 4 after 4s | 200, direction flips from OUT | 200 IN | PASS |
| Cooldown: roll call unaffected | student 6 gate scan, then a roll-call scan right away | gate 200, roll call 409 FT001 (already present) rather than 429 | 200 then 409 FT001 | PASS |
| Margin rule | student 4 sample #2 with a look-alike of student 5 at cosine 0.82 | low_confidence (not auto-matched), margin < 0.08, nothing marked | 200 low_confidence sim=0.864 margin=0.044; new attendance rows=0 | PASS |
| Duplicate-face guard | enrol student 6 with faces that look like student 4 (cosine 0.9) | refused: "This face already matches Divya S (21CS014)", nothing stored | duplicate_face: This face already matches Divya S (21CS014); profiles +0 | PASS |
| Duplicate guard: new face and re-enrol | a brand-new face, then more samples of student 6's own face | both accepted | 2 + 1 profiles | PASS |
| Wrong role | role student | 403 | 403 | PASS |
| Not signed in | no session cookie | 401 | 401 | PASS |
| Bad purpose | purpose='lunch' | 400 | 400 | PASS |
| Bad camera id | camera_id='four' | 400 | 400 | PASS |
| Wrong number of frames | 1 image instead of 3 | 400 | 400 Send 3 images | PASS |
| Inactive camera | camera 3 (status inactive) | 409 | 409 Camera is not active | PASS |

37/37 passed

The same suite with `SCAN_COOLDOWN_SECONDS=0`: **34/34 passed** (the five cooldown cases are replaced by `Cooldown disabled (0)`: student 5 scanned twice in a row gave `200 OUT, then 200 IN`). Both runs were repeated from a clean reset (`qdrant:reset -- --yes` then `seed:faces`) and passed again; one earlier run failed (36/37) only because I had mixed runs against two collections and left duplicate samples behind. That was a test-setup mistake, not a product bug, and the setup commands above avoid it.

## 2. Embedder smoke test

`docker compose exec embedder python smoke_test.py` (uses InsightFace's bundled sample photo, 6 faces): **8/8 checks passed**: health; faces detected (count=6); 512-d embedding; L2 norm 1.000000; det_score, size and blur present (det 0.92, width 108, blur 80); same image twice gives cosine 1.00000; blank image has no face; wrong token gives HTTP 401.

## 3. End-to-end through the HTTP API with images: `npm run test:faces -- <folder>`

Images: the 6 faces of InsightFace's sample photo, cropped, each with 8 variants (original, flipped, brighter, darker, rotated +-9 degrees, zoomed, noisy) saved as JPEG. People 1-4 were enrolled as students 1-4 with 5 images each (first five variants), and scanned with three other variants each. **These are variants of one photo per person, so the results show the pipeline works; they say little about accuracy on real people.**

| Case | Result detail | |
|---|---|---|
| Enrol person1 as student 1 | HTTP 201 5 samples | PASS |
| Enrol person2 as student 2 | HTTP 201 5 samples | PASS |
| Enrol person3 as student 3 | HTTP 201 5 samples | PASS |
| Enrol person4 as student 4 | HTTP 201 5 samples | PASS |
| Duplicate-face guard | HTTP 409 This face already matches Arun Kumar (21CS001) | PASS |
| Enrol rejects an unusable frame | HTTP 422 [{"index":4,"ok":false,"code":"no_face","message":"No face found. Face the camera in good light."}] | PASS |
| Scan person1 | HTTP 200 matched student=1 similarity=0.983 margin=0.910 frames=3/3 | PASS |
| Scan person2 | HTTP 200 matched student=2 similarity=0.983 margin=0.878 frames=3/3 | PASS |
| Scan person3 | HTTP 200 matched student=3 similarity=0.989 margin=0.897 frames=2/2 | PASS |
| Scan person4 | HTTP 200 matched student=4 similarity=0.986 margin=0.912 frames=3/3 | PASS |
| Scan an unenrolled person | HTTP 200 no_match similarity=0.210 | PASS |
| Scan with no face | HTTP 422 {"error":"No face found. Face the camera in good light.","code":"quality","quality":"no_face"} | PASS |
| Unusable scans log nothing | 5 face events since the start (expected 5) | PASS |

13/13 passed (run twice; the second run started from the cleanup of the first). Notes: for person3 one of the three scan frames (rotated) was rejected by the quality gate as "multiple faces" (the border reflection created a second face), so the decision was made on 2 usable frames, which is the allowed minimum.

## 4. Evaluation tool: `npm run faces:eval -- <folder>` on the same images

```
People: 6, usable photos: 46, rejected by the quality gate: 2
  rejected  person2/dark.jpg: too_blurry (score 0.88, width 128, blur 21)    (with the earlier default FACE_MIN_BLUR=25; the default is now 20)
  rejected  person3/rotn.jpg: multiple_faces (score 0.88, width 119, blur 59)
Cosine similarity
  same person       n=154  min 0.899  mean 0.965  max 0.993
  different people  n=881  min -0.103  mean 0.038  max 0.257
Best separating threshold: 0.899  (false accept rate 0.00%, false reject rate 0.00%)
Leave-one-out identification (single frame, match>=0.5, review>=0.35, margin>=0.08):
  matched, right student 46 (100.0%); matched wrong 0; warden review 0; no match 0
```
**Not representative:** the same-person pairs are augmentations of one photo. Only the different-person numbers are real model output. Real calibration needs your own photos (see vector-design.md section 7).

## 5. Build checks
`npx tsc --noEmit`, `npm run lint` and `npm run build` pass (see the stage summary for the final run).

## 6. NOT verified (needs a webcam and a person)
- Camera capture in the browser: the 5-frame guided enrolment with prompts, the 3-frame scan about 300 ms apart, and how fast a scan feels on this laptop.
- Real accuracy on real people with the real webcam; whether `FACE_MIN_BLUR=20`, `FACE_MIN_WIDTH=80` and the similarity thresholds are right.
- Behaviour with glasses, masks, poor light, and a printed photo (no liveness check exists).
- Qdrant or embedder failing in the middle of an enrolment (the rollback path is written but not fault-injected). A stopped embedder was not tested either; the code maps it to a fixed 503 message.

## Historical: real-face test with the OLD model (128-d face-api, Euclid)

> Kept for the record. This was measured with the previous setup, which has been replaced by InsightFace ArcFace (see the sections above and [vector-design.md](vector-design.md)). None of these numbers apply to the current model.

Setup: browser webcam on a MacBook, `@vladmandic/face-api` 128-d descriptors, two people enrolled (the author as Arun Kumar and a friend as Karthik R, 8 samples each), plus one unenrolled face.

| Case | Expected | Actual |
|---|---|---|
| Before the switch (cosine similarity, thresholds 0.85 / 0.70): friend scanned | not matched as Arun Kumar | scored about 0.90 against Arun Kumar and was auto-matched (wrong) |
| Before the switch: author's own face | matched as Arun Kumar | scored up to 0.992 |
| After the switch (Euclidean distance, thresholds 0.45 / 0.60): author's face | matched as Arun Kumar | matched Arun Kumar at distance 0.222 |
| After the switch: friend's face | matched as Karthik R | matched Karthik R at distance 0.252; the recent scans list showed each person recognised as themselves, no mix-ups |
| After the switch: unenrolled face | no_match | no_match at distance 0.721 (three no_match scans in a row) |

Limits:
- Very small sample: two enrolled people, one unenrolled face, a handful of scans each, one camera and one room. The thresholds 0.45 and 0.60 are validated only on that sample and should be re-checked with more people and different lighting before real use.
- The warden confirm/reject buttons and the roll-call scan were not hand-tested with a camera.

## Pages and review API (checked with curl against `next dev`)

| Check | Expected | Actual |
|---|---|---|
| `/enrol`, `/gate`, `/warden/review` with no role | "Access denied" page | as expected (all three) |
| `/enrol` as admin; as warden | form with 6 students; Access denied | as expected |
| `/gate` as security | lists active cameras only (inactive back-gate camera absent) | as expected |
| Review page, empty queue; with 2 low-confidence events | "Nothing to review"; both rows with Confirm/Reject | as expected |
| `POST /api/review/{id}` as security | 403 | 403 |
| confirm, then confirm the same event again | 200 `matched` + reviewer set; then 404 | as expected |
| reject | 200 `no_match`, student NULL, reviewer set | as expected |
| reviewer user id belonging to a student account | 422 (trigger FT040) | 422 |
| confirm with student 99 | 409 | 409 |

## What must be tested by hand (needs a webcam)

Prerequisites: `docker compose up -d --build` (embedder healthy), `cd app && npm run qdrant:reset -- --yes` (drops the old 128-d data and creates the 512-d collection), `npm run dev`, sign in as admin / security.

1. `/enrol`, pick a student, click the button. The prompts should change every 2 seconds (straight, left, right, chin up, relax) and the result should read "Enrolled 5 face samples". Check the sample count in the dropdown after reloading.
2. `/enrol` with a bad frame: cover the lens or turn away during one prompt. The page must name the frame and the fixed message (for example "Frame 3 (...): No face found...") and save nothing. Also try two people in view ("More than one face..."), standing far away ("Face too small...") and moving the head quickly ("The image is blurry...").
3. Enrol a second student with a different person, then try to enrol the first person's face again under the second student: it must be refused with "This face already matches <name> (<roll no>)".
4. `/gate`: "Scan now" with an enrolled person should show their name, `matched`, a similarity value and the IN/OUT result. Time one scan (three frames plus the server call) and check it is acceptable.
5. Auto-scan: a person standing still should get one entry, then the "Already scanned" cooldown notice, not repeated flips.
6. Two different enrolled people, one after the other: each must be recognised as themselves. Then a stranger: expect `no_match` or `low_confidence` (visible on `/warden/review`), never `matched`.
7. Look-alikes (siblings) if available, glasses on/off, a dim room, and a phone screen showing an enrolled face (it will probably be accepted: there is no liveness check).
8. Watch the server log for `frame N rejected: ... blur=..` lines to see the real blur / width / score values of your camera; adjust `FACE_MIN_BLUR`, `FACE_MIN_WIDTH`, `FACE_MIN_DET_SCORE` if good frames are rejected.
9. Calibrate: collect photos as described in [vector-design.md](vector-design.md) section 7, run `npm run faces:eval -- <folder>` and set `MATCH_MIN_SIMILARITY`, `REVIEW_MIN_SIMILARITY`, `MIN_MARGIN` in `.env` and `app/.env.local`.

Roll-call scans only work when an `attendance_sessions` row exists for the hostel covering the current IST time; the seed data has none for today.

## Dashboard and search (`/warden`, `/warden/search`)

Checked with curl against `next dev`, logged in through `POST /api/login` as the seeded warden, admin, security and student accounts. Everything ran against a scratch database (seed data + `demo_passwords.sql` + `db/b_queries.sql` + `db/b_search.sql`) and a scratch Qdrant, not the real data. `npx tsc --noEmit`, `npm run lint` and `npm run build` pass (`/warden`, `/warden/search`, `/warden/review`, `/enrol`, `/gate` are partially prerendered with dynamic content).

| Check | Expected | Actual |
|---|---|---|
| `/warden` and `/warden/search` as warden and as admin | page with data | shown for both |
| same pages as security, as student, and not logged in | no data | "Access denied" page (HTTP 200, with Sign in link), no data in the HTML |
| Summary cards vs the database | match `v_current_presence` / `v_open_violations` / `v_review_queue` | inside 5, outside 1, on leave today 1, open violations 3, scans waiting 0: identical to the SQL |
| Filter `hostel=2` | only Kalam Girls Hostel rows | presence 3, attendance 3, violations 2 |
| Filter `presence=outside` | only outside students | 1 row (Sneha M) |
| Filter `q=ar` (name) | names containing "ar" | 2 rows (Arun Kumar, Karthik R) |
| Filter `vtype=late_return` | only that type | 1 violation |
| `sort=name`, `sort=pct_desc` | order changes | attendance table re-ordered as expected |
| Invalid values: `hostel=999`, `hostel=abc`, `presence=zzz`, `hostel[]=1`, 80-character `q` | ignored (no filter) / shortened | 999, abc, zzz, array: unfiltered pages; long `q` cut to 50 characters |
| Injection-style values: `vtype=x';drop table violations;--`, `sort=name;drop table students` | ignored, nothing runs | unfiltered page; `violations` and `students` row counts unchanged |
| `q=%` | literal text, not a wildcard | 0 rows |
| Search `curfew` | ranked, highlighted | 2 hits, `curfew` inside `<mark>` |
| Search `medical` | ranked, highlighted | 2 hits (a seeded leave and one created through the API), `Medical`/`medical` in `<mark>` |
| Empty search | hint | "Type a word or phrase above to search…" |
| `"roll call"` (phrase) in violations; `medical OR wedding` in leave reasons; `curfew -hostel` | phrase / OR / exclusion work | 2 hits; 3 hits; exclusion handled (no error) |
| Scope select | restricts the sources | `medical`: violations 0, leave reasons 2, both 2; invalid scope falls back to both |
| Only a stop word (`the`) | no error | "No results for this search." |
| Hostile queries: `'; drop table violations; --`, `"unbalanced`, `<script>alert(1)</script>`, `' OR 1=1 --`, `\`, `()&|!:*`, a NUL byte | run safely | HTTP 200, "No results" (the NUL byte is stripped first); `violations` table intact |
| Stored HTML (a violation detail `<img src=x onerror=alert(2)> …` and a leave reason `<script>alert(1)</script> medical check`) | shown as text | HTML-escaped (`&lt;img …`); no `<script>alert` and no `<img` tag in the response |
| Stored text containing the old marker `[[fake]]` | not highlighted | shown literally; highlight markers are random per request |
| Query longer than 200 characters | shortened with a note | note shown |
| 60 matching rows, search `bulk` | at most 50 shown | "Showing the best 50 results", 50 items |
| `npm run test:match` (now logs in through `/api/login`) | 17/17 | 17/17 passed |
| `POSTGRES_DB=does_not_exist ./db/load_b.sh` | fails: the environment wins over `.env` | `database "does_not_exist" does not exist` |
| `POSTGRES_DB=dash_scratch ./db/load_b.sh` after dropping a view there | view recreated in the scratch database | recreated |
| `load_b.sh` with no `POSTGRES_*` in the environment | falls back to `.env` | used the database named in `.env` |
| Shared header on `/enrol`, `/gate`, `/warden/review`; Sign in link on Access denied | present | `<header>` present on all three; Access denied page has the `/login` link |

### Not verified (needs a browser)
1. The header's **Sign out** button and the per-role nav links (`AppHeader` fills these in with a request after the page loads, so they do not appear in curl output): check Dashboard, Search, Review scans, Gate, Enrol faces for the warden and admin accounts, and that Sign out returns to `/login`.
2. Layout and look of `/warden` and `/warden/search` (card grid, tables on a narrow window, dark mode), and that the highlighted words are visibly marked.
3. The filter forms by clicking: choosing a hostel and pressing Apply updates the URL and the tables; Reset clears them; the search form works with Enter.
4. The warden confirm/reject buttons and the roll-call scan with a camera (unchanged and still not hand-tested).
