# Test results: face matching

Run with the dev server on, after `npm run qdrant:reset -- --yes`, `npm run qdrant:init` and `npm run seed:faces`. The gate scan cooldown (`SCAN_COOLDOWN_SECONDS`) must have the same value for the server and for the test; a short one keeps the run fast:

```
cd app
SCAN_COOLDOWN_SECONDS=3 npm run dev                                          # terminal 1
SCAN_COOLDOWN_SECONDS=3 BASE_URL=http://localhost:3000 npm run test:match    # terminal 2
```

The script ([app/scripts/test-matching.ts](../app/scripts/test-matching.ts)) sends real HTTP requests to `POST /api/faces/match` with synthetic descriptors, checks the database after each case, and deletes every row it created (and the look-alike enrolment used for the margin rule). Metric: Euclidean distance. Thresholds: `MATCH_MAX_DISTANCE=0.45`, `REVIEW_MAX_DISTANCE=0.60`, margin 0.06. Output of one real run (cooldown 3 seconds, 11:36 IST):

| Case | Input | Expected | Actual | Result |
|---|---|---|---|---|
| Exact match | student 4's enrolled vector #1 (distance 0) | matched, attendance present | 200 matched dist=0.000 conf=1 -> present; rows=1 | PASS |
| Noisy copy | student 5 face + offset 0.25 (a new photo) | still matched, present | 200 matched dist=0.275 margin=1.113 -> present | PASS |
| Random vector | unrelated random vector | no_match, nobody marked | 200 no_match dist=1.281 conf=0 student=null | PASS |
| Review band | student 6 face + offset 0.5 (expect distance ~0.52) | low_confidence, NOT marked, event kept | 200 low_confidence dist=0.506 conf=0.494; attendance rows=0 | PASS |
| Duplicate scan | student 4 again, same roll call | 409 FT001, event still logged, still 1 attendance row | 409 FT001; events +1; rows=1 | PASS |
| No roll call open | student 1 at hostel 1 camera (no session at 11:36 IST) | 409 no_active_session | 409 matched no_active_session | PASS |
| Wrong hostel | student 1 (hostel 1) scanned at hostel 2 camera | 403 FT003 | 403 FT003 | PASS |
| Outside window (DB) | CALL mark_attendance on a past session | database rejects with FT004 | FT004 | PASS |
| Gate: first scan | student 4, direction inferred, 11:36 IST | OUT, violation null | 200 matched OUT violation=null | PASS |
| Gate: return | student 4, IN, 11:36 IST | IN, violation null | 200 IN violation=null | PASS |
| Gate: duplicate IN | student 4 IN twice | 409 FT022, event still logged | 409 FT022; events +1 | PASS |
| Cooldown config | SCAN_COOLDOWN_SECONDS = 0, 3, unset, '', abc, -5, 1.5 | 0, 3, 20, 20, 20, 20, 20 (0 disables) | 0, 3, 20, 20, 20, 20, 20 | PASS |
| Cooldown: second scan refused | student 4 gate scan right after another (cooldown 3s) | 429 scan_cooldown, Retry-After set, no new face event / gate log / violation, direction unchanged | 200 then 429 scan_cooldown retry=3 header=3; events +0, logs +0, violations +0, last=OUT | PASS |
| Cooldown: other student unaffected | student 5 gate scan while student 4 is cooling down | 200 recorded for 5, student 4 still 429 | student 5: 200 OUT; student 4: 429 | PASS |
| Cooldown: allowed again after waiting | student 4 after 4s | 200, direction flips from OUT | 200 IN | PASS |
| Cooldown: roll call unaffected | student 6 gate scan, then a roll-call scan right away | gate 200, roll call 200 present | 200 then 200 present | PASS |
| Margin rule | student 4 sample #2 with a look-alike of student 5 0.04 away | low_confidence (not auto-matched), nothing marked | 200 low_confidence dist=0.000 margin=0.040; new attendance rows=0 | PASS |
| Inactive camera | camera 3 (status inactive) | 409 | 409 Camera is not active | PASS |
| Bad descriptor | 3 numbers instead of 128 | 400 | 400 descriptor must be 128 finite numbers | PASS |
| Bad purpose | purpose='lunch' | 400 | 400 | PASS |
| Wrong role | role student | 403 | 403 | PASS |
| Not signed in | no session cookie | 401 | 401 | PASS |

22/22 passed

The same suite with the cooldown disabled (server and test both started with `SCAN_COOLDOWN_SECONDS=0`): **19/19 passed**. The four cooldown cases are replaced by `Cooldown disabled (0)`: student 5 scanned twice in a row gave `200 OUT, then 200 IN`. After each run the row counts were back to the seed values (13 face events, 5 gate logs, 9 attendance rows, 4 violations, 4 sessions).

Cooldown checks outside the suite (default `SCAN_COOLDOWN_SECONDS`, i.e. 20; one student, two gate scans 2 seconds apart; and a race):

| Check | Expected | Actual |
|---|---|---|
| Scan 1, then scan 2 two seconds later | 200, then 429 | `200 recorded OUT`, then `429` with `Retry-After: 18` and `Already scanned. Please wait 18 seconds.`; exactly one gate log row and one face event for the student |
| 6 simultaneous gate scans of one student, repeated 3 times | exactly one succeeds | 1 x 200 and 5 x 429 `scan_cooldown` each time; exactly 1 gate log row each time |

Not covered by this run:
- The late-night violation paths (`no_leave` after 20:00, `late_return` after 22:30). The test computes the expected violation from the clock, so only the "no violation" branch was exercised at midday. Those rules are exercised by `db/transactions_demo.sql` scenario A (a 23:05 exit raises `no_leave`).
- The automated run above uses synthetic inputs only: it proves the pipeline and the rules, not the model's accuracy. Real-face results are in the next section.
- A Qdrant outage in the middle of enrolment (the rollback and cleanup path was written but not fault-injected).

## Real-face test

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
| `/models/*.bin` and manifests served | 200 | 200 (6.4 MB recognition weights) |

## What must be tested by hand (needs a webcam)

1. `/enrol`: pick a student, allow the camera, click the button; the progress bar should reach 4 of 4 and show "Enrolled 4 face samples". Check the sample count in the dropdown after reloading.
2. `/gate`: with the same person, "Scan now" should show the student's name and `matched`. Try gate in/out (direction alternates) and, with an open roll call for that hostel, "Roll call".
3. Hold a photo of the person or a different person, and a poorly lit face, to see `low_confidence` and `no_match`; the first should appear on `/warden/review`.
4. Tune `MATCH_MAX_DISTANCE` and `REVIEW_MAX_DISTANCE` from the distances you actually see (the gate page shows them). Also check that two different people are not auto-matched.
5. Check that the face model loads in your browser (the network tab shows `/models/...` requests) and that auto-scan does not pile up requests.

Roll-call scans only work when an `attendance_sessions` row exists for the hostel covering the current IST time; the seed data has none for today (see NEEDS_FROM_PARTNER.md).

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

# Test results: reports (Stage 3)

Run on 2026-10-27 against a scratch PostgreSQL database loaded from the SQL files (`./db/load_b.sh --demo`, no errors on a second load either), a production build (`next start`) on port 3200, and real Google Chrome driven by puppeteer-core for the visual checks. The real database was not touched. Nothing in the existing schema changed, so `db/test_cases.sql` still passes **71 of 71** (run on a fresh seeded database).

## SQL: `db/b_reports_tests.sql` (fixture with known data, rolled back)
Builds a small hostel (3 students, 3 roll calls, gate trips, violations, leave requests, face events), calls every report for that hostel only and compares the whole result with the expected rows. Includes the HAVING threshold, RANK ties, zero-filled hours/bands, empty ranges and the hostel filter.
```
                           name                            | result | detail 
-----------------------------------------------------------+--------+--------
 attendance_by_hostel_month (CTE)                          | PASS   | 
 attendance report respects the date range                 | PASS   | 
 violations_by_type_hostel (GROUP BY / HAVING)             | PASS   | 
 HAVING hides groups below p_min                           | PASS   | 
 cumulative_violations (window SUM OVER)                   | PASS   | 
 late_return_rank (RANK / DENSE_RANK)                      | PASS   | 
 gate_traffic_by_hour (GROUP BY hour, 48 rows incl. zeros) | PASS   | 
 time_outside (LEAD via v_report_trips)                    | PASS   | 
 leave_summary (FILTER, percentile_cont)                   | PASS   | 
 recognition_outcomes (FILTER by week)                     | PASS   | 
 similarity_distribution (width_bucket, 30 rows)           | PASS   |
```
16/16 passed.

## Pages: `npm run test:reports`
Run after `npm run demo:history -- --days 30 --yes` (so `EXPECT_HISTORY_NOTE=1`).

| Case | Expected | Actual | Result |
|---|---|---|---|
| Access to /reports | student, parent, security, anonymous denied; warden and admin open | student:denied parent:denied security:denied anonymous:denied warden:open admin:open | PASS |
| Access to /reports/present | student, parent, security, anonymous denied; warden and admin open | student:denied parent:denied security:denied anonymous:denied warden:open admin:open | PASS |
| /reports has a section for every report | 11 sections | 11 found | PASS |
| Each slide states its SQL concept and has the query | 11 'SQL concept used' labels, each with a query panel | 11 labels, 11 query panels, CREATE FUNCTION in page: true | PASS |
| The shown query is read from db/b_reports.sql | a line of the file appears in the page | RETURNS TABLE (word TEXT, source TEXT, occurrences INT) | PASS |
| Presentation mode has controls and slides | Next / Previous buttons, Full screen, Print | Next:true Previous:true Full screen:true Print / PDF:true | PASS |
| /reports has the filters and the presentation link | date range, hostel, link | from:true to:true hostel:true link:true | PASS |
| Bad filter values are ignored | 14 requests: HTTP 200, report page still shown, no raw error text | 14/14 ok | PASS |
| A backwards range is swapped, not rejected | page shows 2026-01-01 to 2026-12-31 | shown | PASS |
| An empty range says 'No data for this range' | 11 reports, no raw errors | 11 messages, raw errors: false | PASS |
| The hostel filter narrows the data | the page for one hostel differs from all hostels and names it | 2 hostels; differs: true | PASS |
| Generated demo history is labelled | note shown (EXPECT_HISTORY_NOTE=1) | note shown: true | PASS |
| The generated-history note only shows for ranges that overlap it | no note for a 2001 range | note shown: false | PASS |
| /warden has no summary cards, keeps filters and tables | none of the 5 card labels; filters and 'Who is where' present | cards: 0, filters: true, table: true | PASS |

14/14 passed. Two real bugs were found by this test and fixed before it passed: an impossible date such as `2026-02-30` made the page show the generic error instead of being ignored, and the two zero-filled reports (gate traffic, similarity) never counted as "no data".

## Demo history: `npm run demo:history`
- Without `--yes`: prints what it would do and changes nothing (exit 1).
- On a database with 0 students: refuses ("Only 0 student(s) exist. Demo history needs at least 4").
- On the 6 sample students, `--days 30 --yes`: 60 roll calls, 154 marks through `mark_attendance`, 26 absent when closing, 151 gate crossings through `record_entry_exit`, 368 face events, 5 leave requests, 25 violations (8 resolved), in about one second, in one transaction. Reports then show the data and the "Includes generated demo history" note.
- A second run refuses ("Generated history already exists").

## Checked in real Chrome (headless, 1366x900)
- Keyboard navigation in `/reports/present`: ArrowRight x3 moved to slides 2, 3, 4; ArrowLeft back to 3; End to 11/11; Home to 1/11; the URL hash followed (`#slide-4`...). It works once the page has hydrated (about 2 seconds after load in this environment); keys pressed earlier do nothing.
- All 11 slides rendered with chart, key numbers, SQL-concept label and legend, in light and dark mode (checked slides 1-11 light, slides 1-2 dark); no console errors.
- The empty range (`from=2001-01-01&to=2001-01-31`) shows "No data for this range" with the query still available.
- Print: with print media emulated, the page produced an **11-page A4 landscape PDF**, one slide per page, light colours, no buttons or query panels (page 1 inspected as an image).
- A bug found this way and fixed: a custom line marker drew stray squares along the top of the cumulative-violations chart for days on which a hostel had no point.

## Not verified (needs you in a real browser)
- Safari/Firefox rendering and the browser's own Print dialog (only Chrome's print-to-PDF was exercised).
- Full-screen mode (`F`): the code calls the browser's full-screen API; headless Chrome cannot show it.
- Charts on a phone-width screen, and with a screen reader.
- Whether the generated demo numbers look right for your presentation (they are random but seeded).

