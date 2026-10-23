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

Descriptors are computed **in the browser** and sent to the server, so video never leaves the client. The server L2-normalises every vector (`app/lib/vectors.ts`) before storing or searching, so every stored vector has length 1.

## 3. How vectors are stored
- **Collection** `face_embeddings`: 128 dimensions, **Cosine** distance (created idempotently by `npm run qdrant:init`, checked by `/api/health` field `collection`).
- **Point id**: a UUID, also stored in PostgreSQL as `face_profiles.qdrant_point_id` (UNIQUE).
- **Payload**: `{ "student_id": <students.student_id>, "face_profile_id": <face_profiles.profile_id> }`, with a payload index on `student_id`.
- **Link to PostgreSQL**: one `face_profiles` row per vector (3 to 5 per student, to cover pose and lighting). Enrolment inserts the rows in a transaction, writes the points, then commits; any failure rolls back the rows and deletes the points (`app/lib/faces.ts`). Deleting a profile removes both sides.

## 4. Similarity metric
**Cosine similarity**: the cosine of the angle between two vectors. Because stored and query vectors are unit length it equals their dot product. Range -1 to 1; higher means more alike. Qdrant returns this value as the score.

## 5. Retrieval and thresholds
`POST /api/faces/match` (`app/lib/matching.ts`):
1. Normalise the query descriptor.
2. Ask Qdrant for the **top 2** nearest points. The top-1 score decides the outcome; `margin = score1 - score2` is reported (a tiny margin between two different students would deserve a human look; it is currently informational only).
3. Classify the top-1 score:

| Score | Outcome | Effect |
|---|---|---|
| `>= MATCH_MIN_SCORE` (default 0.85) | `matched` | `face_events` row, then `mark_attendance` or `record_entry_exit` in the same transaction |
| `REVIEW_MIN_SCORE` (0.70) to below 0.85 | `low_confidence` | `face_events` row only; appears in the warden review queue |
| below `REVIEW_MIN_SCORE` | `no_match` | `face_events` row with no student |

**The defaults are a starting point, not a measured result.** Cosine scores of face descriptors are not calibrated: the right cut-offs depend on the model, camera and lighting. A rough rule of thumb for this model family (Euclidean distance about 0.6 between same-person descriptors, so cosine about 0.82 for unit vectors) shows why they are loose guesses. They must be tuned with real faces: enrol several people, log same-person and different-person scores from the real gate camera, and pick cut-offs that give no false accepts. They live in `MATCH_MIN_SCORE` and `REVIEW_MIN_SCORE` (`.env`), with no code change needed.

Confidence is stored in `face_events.confidence NUMERIC(4,3)` (clamped to 0..1).

## 6. Why Qdrant for vectors and PostgreSQL for records
- **Qdrant** is built for nearest-neighbour search over vectors (HNSW index, cosine distance, payload filters). Finding "which of N stored faces is closest to this one" is a similarity query, which a B-tree cannot answer, and it scales as enrolments grow.
- **PostgreSQL** holds everything relational and rule-bound: students, hostels, sessions, attendance, gate logs, violations, with keys, constraints, triggers and transactions. Qdrant has none of that.
- The two meet in two places: the payload `student_id` in Qdrant, and `face_profiles.qdrant_point_id` in PostgreSQL. Qdrant is the source of truth for vectors, PostgreSQL for who they belong to.

## 7. Limits
- No liveness detection: a printed photo can be presented to the camera.
- Synthetic vectors (`npm run seed:faces`) test the pipeline, not the model's accuracy.
- Vectors are biometric data; the Qdrant port is bound to localhost and needs `QDRANT_API_KEY`, but no retention or consent policy exists yet.
