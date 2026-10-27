# Vector design: face recognition with InsightFace and Qdrant

## 1. What is embedded
One **face embedding** per enrolment image: a 512-number vector that summarises the identity-relevant features of one face. Images of the same person land close together in angle; images of different people land far apart. Only the vector is stored. **No photo is ever stored**: the JPEG frames are held in memory while the request runs and then discarded.

## 2. The pipeline
```
browser: 640 px JPEG frames --> Next.js API route --> embedder service --> embedding + quality numbers
                                     |
                                     +--> quality gate --> Qdrant search / PostgreSQL
```
- The browser does **no face analysis**. It captures JPEG frames from the camera (canvas, about 640 px wide, quality 0.85) and posts them as `multipart/form-data` to `/api/faces/enrol` (5 frames) or `/api/faces/match` (3 frames).
- The Next.js server sends each frame to the **embedder** (`/embedder`, FastAPI): InsightFace model pack **buffalo_l**, with the **SCRFD** detector (`det_10g`) and the **ArcFace** recogniser (`w600k_r50`, ResNet-50 trained on WebFace600K), on onnxruntime CPU. The service returns the face count and, for the largest face, the L2-normalised 512-d embedding, the detection score, the face box size and a blur score.
- The embedder listens on `127.0.0.1:8001` only and needs the shared secret `EMBEDDER_TOKEN`; its models live in a named Docker volume.

**Why this replaced face-api.** The previous setup (128-d `@vladmandic/face-api` descriptors from one browser frame) recognised an enrolled name for a different person's face. ArcFace is a much stronger recogniser (additive angular margin loss, trained for exactly the cosine comparison used here), SCRFD detects and aligns faces more robustly, and moving inference to the server lets us measure quality and use several frames. This is a claim about the model design; the actual accuracy on *your* people is only known after `npm run faces:eval` (section 7).

**Licence.** InsightFace's pretrained models are for non-commercial research use. This is a university project. See [embedder/README.md](../embedder/README.md).

## 3. How vectors are stored
- **Collection** `face_embeddings`: 512 dimensions, **Cosine** distance (created by `npm run qdrant:init`, checked by `/api/health` field `collection`). Embeddings are L2-normalised by the embedder and again by `app/lib/vectors.ts`, so cosine similarity is a dot product. In a Cosine collection Qdrant's score is the similarity itself: **higher is closer**, 1 is identical.
- **Point id**: a UUID, also stored in PostgreSQL as `face_profiles.qdrant_point_id` (UNIQUE).
- **Payload**: `{ "student_id", "face_profile_id" }`, with a payload index on `student_id`.
- **Link to PostgreSQL**: one `face_profiles` row per vector (5 per enrolment). Enrolment checks the duplicate guard, inserts the rows in a transaction, writes the points, then commits; any failure rolls back the rows and deletes the points (`app/lib/faces.ts`). Deleting a profile removes both sides.
- The collection name can be overridden with `QDRANT_COLLECTION`; this exists only so the tests can use `face_embeddings_test`.

**Existing 128-d data is invalid.** A 128-d Euclid collection cannot be used with 512-d vectors. `npm run qdrant:reset -- --yes` deletes the Qdrant collection and every `face_profiles` row together, recreates the 512-d Cosine collection and tells you to re-enrol everyone. Scan history (`face_events`) is kept, but its old `confidence` values came from a different model and are not comparable.

## 4. Quality gate (every image, enrolment and scan)
An image is used only if the embedder finds **exactly one face** and:

| Check | Variable | Default | Message shown |
|---|---|---|---|
| no face | | | "No face found. Face the camera in good light." |
| more than one face | | | "More than one face in view. Only one person at a time." |
| detection score at least | `FACE_MIN_DET_SCORE` | 0.6 | "The face is not clear enough. Look straight at the camera." |
| face width at least (px, in the submitted image) | `FACE_MIN_WIDTH` | 80 | "Face too small. Move closer to the camera." |
| blur score at least | `FACE_MIN_BLUR` | 20 | "The image is blurry. Hold still and try again." |

The messages are fixed text (`app/lib/quality.ts`); nothing from the embedder is passed to the browser. The server logs the numbers of a rejected frame (`frame 1 rejected: too_blurry; ... blur=18`) to help calibration.

**Blur calibration (what was actually measured).** The blur score is the variance of the Laplacian over the face crop resized to 160x160 px, so it does not depend on face size. On the 6 faces of InsightFace's sample photo (crops upscaled to 400 px) sharp images scored 43 to 98; Gaussian blur with sigma 0.8 scored 33, sigma 1.2 scored 18, sigma 2 scored 9; horizontal motion blur with a 5/9/15-pixel kernel scored 27/16/10; a darkened copy of the softest face scored 21-25. The default of 20 sits between "mildly soft" and "clearly blurry" **on those degraded images only**. It has not been checked on your webcam: watch the `rejected` lines in the server log during real use and adjust `FACE_MIN_BLUR` if good frames are rejected or soft ones accepted.

## 5. Matching rules (`app/lib/matching.ts`)
For each usable frame:
1. Ask Qdrant for the **10 nearest points**.
2. Group the hits by student. A student's score is the **mean of their best two sample similarities** (the best one if only one sample is among the hits).
3. Classify the frame by the best student's score `s` and their margin `m` over the best *other* student (no margin if nobody else is among the hits):

| Condition | Frame outcome |
|---|---|
| `s >= MATCH_MIN_SIMILARITY` (default 0.50) and `m >= MIN_MARGIN` (default 0.08) | `matched` |
| `s >= MATCH_MIN_SIMILARITY` but `m < MIN_MARGIN` | `low_confidence` (ambiguous) |
| `REVIEW_MIN_SIMILARITY` (0.35) `<= s <` 0.50 | `low_confidence` (warden review band) |
| `s <` 0.35 | `no_match` |

**Multi-frame decision at the gate.** The gate page sends **3 frames about 300 ms apart**. At least 2 must be usable (otherwise HTTP 422 "no usable face", nothing logged). The scan is `matched` only if the **same student is a `matched` winner on at least 2 of the usable frames**. Otherwise, if any frame saw a plausible student (`matched` or `low_confidence`), the scan is `low_confidence` and the student with the most votes goes to the warden queue; if no frame reached 0.35 it is `no_match`. A frame that is only `low_confidence` does not count towards the 2. The recorded similarity is the mean score over the frames that back the decision, and `margin` is the smallest of their margins.

`face_events.confidence` = the similarity **clamped to 0..1**, rounded to 3 places (the column is `NUMERIC(4,3)` with `CHECK (confidence BETWEEN 0 AND 1)`). For a `no_match` it holds the best similarity seen. A matched scan still calls `mark_attendance` / `record_entry_exit` in the same transaction, exactly as before, with the same error mapping.

**Gate scan cooldown** (unchanged). A gate (`entry_exit`) scan of a `matched` student is refused when their latest gate log row is younger than `SCAN_COOLDOWN_SECONDS` (default 20; `0` disables it; an invalid value falls back to 20 with a server-side warning). It does not apply to roll-call scans or to low-confidence and no-match scans. The refusal is HTTP 429 with `code: "scan_cooldown"`, `retryAfterSeconds` and a `Retry-After` header, and it writes nothing. It takes a per-student advisory lock, `pg_advisory_xact_lock(hashtext('gate_cooldown'), student_id)`, in the same transaction as the insert, and the age is computed in PostgreSQL on the same Asia/Kolkata wall-clock basis as `entry_exit_log.event_time`.

**The numbers 0.50 / 0.35 / 0.08 are starting guesses, not measured values.** They follow the usual range for ArcFace cosine similarity (same person typically well above 0.4, different people typically below 0.3) but the right cut-offs depend on your camera, light and the people enrolled. Calibrate them with `npm run faces:eval` (section 7).

## 6. Duplicate-face guard at enrolment
Before anything is saved, each new embedding is compared with every stored sample of every **other** student. If the best similarity to another student is at or above `REVIEW_MIN_SIMILARITY`, enrolment is refused with HTTP 409 and "This face already matches <name> (<roll no>)". There is no override. The student's own old samples are excluded, so re-enrolling is fine. This stops one person being registered under two names, which would otherwise make both names ambiguous at the gate.

## 7. Evaluation and calibration: `npm run faces:eval -- <folder>`
`<folder>` holds one subfolder per person, each with several photos (jpg/png). The tool embeds every photo through the embedder, drops those the quality gate rejects, then prints:
- min / mean / max cosine similarity for **same-person** pairs and **different-person** pairs;
- the **best separating threshold** (fewest wrong pair decisions) with its false-accept and false-reject rates;
- a **leave-one-out identification summary** at the configured thresholds: each photo is identified against all the others using the same grouping and margin rules as the gate (single frame): matched right, matched **wrong** (the dangerous case, keep at 0), warden review right/wrong, no match.

**How to collect the photos.** Use the actual gate camera and lighting. At least **4 people, 5 or more photos each** (8 or more is better): different days or times if possible, slight head turns, with and without glasses or cap if people wear them. Name the folders after people (`ravi/`, `meena/`...). Do not mix two people in a folder. These photos are used locally for the test and are not stored by the system; delete them afterwards (see the privacy note in the README).

Then set `MATCH_MIN_SIMILARITY` above the highest different-person value you saw (with margin) and `REVIEW_MIN_SIMILARITY` just above it or slightly lower, and keep `MIN_MARGIN` large enough that look-alike pairs fall into review.

**Status of the defaults.** No folder of real photos was available when this was built. The tool was run on 46 images made from the 6 faces of InsightFace's sample photo (8 augmented variants each: flip, brightness, rotation, zoom, noise). The different-person values from that run are real model output (mean 0.038, max 0.257 over 881 pairs, so 0.35 sits above all of them) but the same-person values (mean 0.965) are inflated because they are copies of one photo, so they say nothing about real webcam variation. **The defaults are therefore uncalibrated for your camera.**

## 8. Why Qdrant for vectors and PostgreSQL for records
- **Qdrant** is built for nearest-neighbour search over vectors (HNSW index, cosine/Euclid/dot distances, payload filters). "Which of N stored faces is closest to this one" is a similarity query, which a B-tree cannot answer, and it scales as enrolments grow.
- **PostgreSQL** holds everything relational and rule-bound: students, hostels, sessions, attendance, gate logs, violations, with keys, constraints, triggers and transactions. Qdrant has none of that. All records, rules and reports stay in PostgreSQL; the Python service only produces embeddings.
- The two meet in two places: the payload `student_id` in Qdrant, and `face_profiles.qdrant_point_id` in PostgreSQL. Qdrant is the source of truth for vectors, PostgreSQL for who they belong to.

## 9. Known limits
- **No liveness detection:** a printed photo or a photo on a phone screen can pass.
- **Accuracy is only as good as the evaluation set.** It has not been measured on real people with the new model (section 7). Different lighting, masks, glasses, and twins or close relatives can raise false accepts or rejects.
- The quality gate rejects bad frames but cannot tell an old photo of a person from a new one.
- Synthetic vectors (`npm run seed:faces`, test collection only) test the rules, not the model.
- Embeddings are biometric data. Qdrant is bound to localhost and needs `QDRANT_API_KEY`; the embedder is bound to localhost and needs `EMBEDDER_TOKEN`. No retention or consent policy exists yet beyond what the README states.
