# Test results: face matching

Run with the dev server on, after `npm run qdrant:reset -- --yes`, `npm run qdrant:init` and `npm run seed:faces`:

```
cd app && BASE_URL=http://localhost:3000 npm run test:match
```

The script ([app/scripts/test-matching.ts](../app/scripts/test-matching.ts)) sends real HTTP requests to `POST /api/faces/match` with synthetic descriptors, checks the database after each case, and deletes every row it created (and the look-alike enrolment used for the margin rule). Metric: Euclidean distance. Thresholds: `MATCH_MAX_DISTANCE=0.45`, `REVIEW_MAX_DISTANCE=0.60`, margin 0.06. Output of one real run at 13:15 IST:

| Case | Input | Expected | Actual | Result |
|---|---|---|---|---|
| Exact match | student 4's enrolled vector #1 (distance 0) | matched, attendance present | 200 matched dist=0.000 conf=1 -> present; rows=1 | PASS |
| Noisy copy | student 5 face + offset 0.25 (a new photo) | still matched, present | 200 matched dist=0.275 margin=1.113 -> present | PASS |
| Random vector | unrelated random vector | no_match, nobody marked | 200 no_match dist=1.281 conf=0 student=null | PASS |
| Review band | student 6 face + offset 0.5 (expect distance ~0.52) | low_confidence, NOT marked, event kept | 200 low_confidence dist=0.506 conf=0.494; attendance rows=0 | PASS |
| Duplicate scan | student 4 again, same roll call | 409 FT001, event still logged, still 1 attendance row | 409 FT001; events +1; rows=1 | PASS |
| No roll call open | student 1 at hostel 1 camera (no session at 13:15 IST) | 409 no_active_session | 409 matched no_active_session | PASS |
| Wrong hostel | student 1 (hostel 1) scanned at hostel 2 camera | 403 FT003 | 403 FT003 | PASS |
| Outside window (DB) | CALL mark_attendance on a past session | database rejects with FT004 | FT004 | PASS |
| Gate: first scan | student 4, direction inferred, 13:15 IST | OUT, violation null | 200 matched OUT violation=null | PASS |
| Gate: return | student 4, IN, 13:15 IST | IN, violation null | 200 IN violation=null | PASS |
| Gate: duplicate IN | student 4 IN twice | 409 FT022, event still logged | 409 FT022; events +1 | PASS |
| Margin rule | student 4 sample #2 with a look-alike of student 5 0.04 away | low_confidence (not auto-matched), nothing marked | 200 low_confidence dist=0.000 margin=0.040; new attendance rows=0 | PASS |
| Inactive camera | camera 3 (status inactive) | 409 | 409 Camera is not active | PASS |
| Bad descriptor | 3 numbers instead of 128 | 400 | 400 descriptor must be 128 finite numbers | PASS |
| Bad purpose | purpose='lunch' | 400 | 400 | PASS |
| Wrong role | role student | 403 | 403 | PASS |
| Not signed in | no role header | 401 | 401 | PASS |

17/17 passed

Not covered by this run:
- The late-night violation paths (`no_leave` after 20:00, `late_return` after 22:30). The test computes the expected violation from the clock, so only the "no violation" branch was exercised at midday. Those rules are exercised by `db/transactions_demo.sql` scenario A (a 23:05 exit raises `no_leave`).
- Real faces. All inputs are synthetic, so these results prove the pipeline and the rules, not the model's accuracy. The reported cosine problem (a different person at about 0.90) was observed on real faces and has not been re-measured with Euclid.
- A Qdrant outage in the middle of enrolment (the rollback and cleanup path was written but not fault-injected).

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
| `/models/*.bin` and manifests served | 200 | 200 (6.4 MB recognition weights) |

## What must be tested by hand (needs a webcam)

1. `/enrol`: pick a student, allow the camera, click the button; the progress bar should reach 4 of 4 and show "Enrolled 4 face samples". Check the sample count in the dropdown after reloading.
2. `/gate`: with the same person, "Scan now" should show the student's name and `matched`. Try gate in/out (direction alternates) and, with an open roll call for that hostel, "Roll call".
3. Hold a photo of the person or a different person, and a poorly lit face, to see `low_confidence` and `no_match`; the first should appear on `/warden/review`.
4. Tune `MATCH_MAX_DISTANCE` and `REVIEW_MAX_DISTANCE` from the distances you actually see (the gate page shows them). Also check that two different people are not auto-matched.
5. Check that the face model loads in your browser (the network tab shows `/models/...` requests) and that auto-scan does not pile up requests.

Roll-call scans only work when an `attendance_sessions` row exists for the hostel covering the current IST time; the seed data has none for today (see NEEDS_FROM_PARTNER.md).
