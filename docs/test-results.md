# Test results: face matching

Run with the dev server on, after `npm run qdrant:init` and `npm run seed:faces`:

```
cd app && BASE_URL=http://localhost:3000 npm run test:match
```

The script ([app/scripts/test-matching.ts](../app/scripts/test-matching.ts)) sends real HTTP requests to `POST /api/faces/match` with the synthetic descriptors, checks the database after each case, and deletes every row it created (row counts before and after were identical: 13 face events, 5 gate logs, 9 attendance rows, 4 violations, 4 sessions). Thresholds: `MATCH_MIN_SCORE=0.85`, `REVIEW_MIN_SCORE=0.70`. Output of one real run at 12:28 IST:

| Case | Input | Expected | Actual | Result |
|---|---|---|---|---|
| Exact match | student 4's enrolled vector #1 | matched, attendance present | 200 matched score=1.000 -> present; rows=1 | PASS |
| Noisy copy | student 5 base + noise 0.3 (new photo) | still matched, present | 200 matched score=0.956 margin=0.004 -> present | PASS |
| Random vector | unrelated random vector | no_match, nobody marked | 200 no_match score=0.175 student=null | PASS |
| Review band | student 6 face at cosine 0.78 | low_confidence, NOT marked, event kept | 200 low_confidence score=0.781; attendance rows=0 | PASS |
| Duplicate scan | student 4 again, same roll call | 409 FT001, event still logged, still 1 attendance row | 409 FT001; events +1; rows=1 | PASS |
| No roll call open | student 1 at hostel 1 camera (no session at 12:28 IST) | 409 no_active_session | 409 matched no_active_session | PASS |
| Wrong hostel | student 1 (hostel 1) scanned at hostel 2 camera | 403 FT003 | 403 FT003 | PASS |
| Outside window (DB) | CALL mark_attendance on a past session | database rejects with FT004 | FT004 | PASS |
| Gate: first scan | student 4, direction inferred, 12:28 IST | OUT, violation null | 200 matched OUT violation=null | PASS |
| Gate: return | student 4, IN, 12:28 IST | IN, violation null | 200 IN violation=null | PASS |
| Gate: duplicate IN | student 4 IN twice | 409 FT022, event still logged | 409 FT022; events +1 | PASS |
| Inactive camera | camera 3 (status inactive) | 409 | 409 Camera is not active | PASS |
| Bad descriptor | 3 numbers instead of 128 | 400 | 400 descriptor must be 128 finite numbers | PASS |
| Bad purpose | purpose='lunch' | 400 | 400 | PASS |
| Wrong role | role student | 403 | 403 | PASS |
| Not signed in | no role header | 401 | 401 | PASS |

16/16 passed

Not covered by this run:
- The late-night violation paths (`no_leave` after 20:00, `late_return` after 22:30). The test computes the expected violation from the clock, so only the "no violation" branch was exercised at midday. Those rules are exercised by `db/transactions_demo.sql` scenario A (a 23:05 exit raises `no_leave`).
- Real faces. All inputs are synthetic.
- A Qdrant outage in the middle of enrolment (the rollback and cleanup path was written but not fault-injected).
