# Vector design: face recognition with Qdrant

## 1. What is embedded
One **face descriptor** per enrolment photo: a 128-number vector that summarises the identity-relevant shape of one face. Photos of the same person land close together; photos of different people land far apart. Only the vector is stored, never the photo.

## 2. The model
[`@vladmandic/face-api`](https://github.com/vladmandic/face-api) (a maintained fork of face-api.js, v1.7.15). In the browser it runs three small networks, whose weights are copied from the npm package into `app/public/models/` (no external download):

| Network | Files | Job |
|---|---|---|
| Tiny face detector | `tiny_face_detector_model*` | find the face in the camera frame |
| 68-point landmarks | `face_landmark_68_model*` | align the face |
| Face recognition (ResNet-34 style) | `face_recognition_model*` | output the 128-d descriptor |

Descriptors are computed **in the browser** and sent to the server, so video never leaves the client. The server only checks that a descriptor is 128 finite numbers (`app/lib/vectors.ts`); it stores and searches the vector **exactly as the model produced it, without normalising**, because the model's distances are only meaningful on the raw values.

## 3. How vectors are stored
- **Collection** `face_embeddings`: 128 dimensions, **Euclid** (L2) distance (created idempotently by `npm run qdrant:init`, checked by `/api/health` field `collection`).
- **Point id**: a UUID, also stored in PostgreSQL as `face_profiles.qdrant_point_id` (UNIQUE).
- **Payload**: `{ "student_id": <students.student_id>, "face_profile_id": <face_profiles.profile_id> }`, with a payload index on `student_id`.
- **Link to PostgreSQL**: one `face_profiles` row per vector (3 to 5 per student, to cover pose and lighting). Enrolment inserts the rows in a transaction, writes the points, then commits; any failure rolls back the rows and deletes the points (`app/lib/faces.ts`). Deleting a profile removes both sides.

## 4. Similarity metric: Euclidean (L2) distance
The distance between two descriptors is the straight-line length of the difference between them: `sqrt(sum((a_i - b_i)^2))`. **Smaller is closer**; 0 is identical. In a Euclid collection Qdrant returns this distance as the score and sorts nearest first.

**Why Euclidean and not cosine.** The face-api recognition network was trained to place photos of one person within a small Euclidean distance of each other (the library's own rule is: same person below about 0.6). The most likely reason cosine failed is that descriptors from different people share most of their direction, so the *angle* between them stays small even when their Euclidean distance is large (this explanation was not measured separately). The first version of this project used cosine similarity and a different person scored about 0.90 against an enrolled face, i.e. cosine could not separate people. Switching to Euclid, the metric the model was trained for, gives the intended separation.

All stored vectors from the cosine/normalised version were in the wrong space, so `npm run qdrant:reset -- --yes` deletes the collection and the `face_profiles` rows and everyone is re-enrolled.

## 5. Retrieval and thresholds
`POST /api/faces/match` (`app/lib/matching.ts`):
1. Validate the descriptor (128 finite numbers). No normalisation.
2. Ask Qdrant for the 10 nearest points. The nearest one is the candidate. The **runner-up** is the nearest point that belongs to a *different* student (a student has several samples, so the second-nearest point is often the same student).
3. Classify by the candidate's distance `d`:

| Distance | Outcome | Effect |
|---|---|---|
| `d <= MATCH_MAX_DISTANCE` (default 0.45) | `matched` | `face_events` row, then `mark_attendance` or `record_entry_exit` in the same transaction |
| above 0.45, up to `REVIEW_MAX_DISTANCE` (0.60) | `low_confidence` | `face_events` row only; appears in the warden review queue |
| above `REVIEW_MAX_DISTANCE` | `no_match` | `face_events` row with no student |

4. **Margin rule.** If the runner-up (another student) is less than **0.06** further away than the candidate, the scan is ambiguous: it is classified `low_confidence` even when `d <= MATCH_MAX_DISTANCE`. The reported `margin` is `runner-up distance - candidate distance` (null when there is no other student).

**The defaults are a starting point, not a measured result.** 0.45 and 0.60 come from the model's usual same-person range; the right values depend on the camera, lighting and the people enrolled. Tune them with real faces: enrol several people, log same-person and different-person distances from the real gate camera, and pick cut-offs with no false accepts. They live in `MATCH_MAX_DISTANCE` and `REVIEW_MAX_DISTANCE` (`.env`); the margin (0.06) is the constant `MARGIN_MIN` in `matching.ts`.

**Confidence mapping.** `face_events.confidence` is `NUMERIC(4,3)` with `CHECK (confidence BETWEEN 0 AND 1)` (`db/schema.sql`), and a distance can exceed 1. It is stored as **`confidence = max(0, 1 - distance)`**, rounded to 3 places: distance 0 is confidence 1.000, distance 0.45 is 0.550, distance 1 or more is 0. The API returns both `distance` and `confidence`; the warden page shows distance as `1 - confidence`, which is exact for every scan that can reach the review queue (distance 0.45 to 0.60). Rows written before the switch hold cosine scores and are not comparable.

## 6. Why Qdrant for vectors and PostgreSQL for records
- **Qdrant** is built for nearest-neighbour search over vectors (HNSW index, Euclidean/cosine/dot distances, payload filters). Finding "which of N stored faces is closest to this one" is a similarity query, which a B-tree cannot answer, and it scales as enrolments grow.
- **PostgreSQL** holds everything relational and rule-bound: students, hostels, sessions, attendance, gate logs, violations, with keys, constraints, triggers and transactions. Qdrant has none of that.
- The two meet in two places: the payload `student_id` in Qdrant, and `face_profiles.qdrant_point_id` in PostgreSQL. Qdrant is the source of truth for vectors, PostgreSQL for who they belong to.

## 7. Limits
- No liveness detection: a printed photo can be presented to the camera.
- Synthetic vectors (`npm run seed:faces`) test the pipeline, not the model's accuracy.
- Vectors are biometric data; the Qdrant port is bound to localhost and needs `QDRANT_API_KEY`, but no retention or consent policy exists yet.
