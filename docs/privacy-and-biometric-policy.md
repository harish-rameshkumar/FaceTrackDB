# Privacy and biometric data policy

FaceTrackDB is a university DBMS project. This page says what personal data it holds and how it is handled. It is a project policy, not legal advice; a real deployment would need review by the institution (and, in India, against the Digital Personal Data Protection Act, 2023).

## What is stored
| Data | Where | Notes |
|---|---|---|
| Name, SRN / roll number, hostel, room, login email | PostgreSQL (`students`, `users`) | |
| Password | PostgreSQL (`users.password_hash`) | bcrypt hash only; temporary passwords shown at registration are not stored in readable form and not logged |
| Parent name, phone, login email, relation | PostgreSQL (`parents`, `student_parent`) | |
| **Face embedding** (512 numbers per enrolled frame, 5 per student) | Qdrant (`face_embeddings`), linked from `face_profiles` | derived from the face; cannot be turned back into a photo directly, but is still **biometric data** |
| Scan results: time, camera, matched student, similarity | PostgreSQL (`face_events`, `attendance`, `entry_exit_log`) | the similarity is a number, no image |
| Consent record | PostgreSQL (`b_consents`) | who registered the student and when, after the consent checkbox was ticked |

**No raw photos or video are stored.** Camera frames are sent to the server, held in memory while the embedding is computed, and discarded. (Operators who run `npm run faces:eval` keep the evaluation photos on their own disk; they should delete them afterwards.)

## Why
To mark hostel roll-call attendance and record gate entry and exit without manual registers. Face data is used for nothing else.

## Who can see it
- Admin: registers and deletes students and their face samples. Admins cannot read the embeddings through the app, but they can reach the databases on the server.
- Security staff and wardens: see the name and roll number of a scanned student and the scan result; wardens review uncertain scans. They do not see embeddings.
- Students and parents: see their own / their ward's records only.
- The databases and the embedder service listen on 127.0.0.1 only; Qdrant needs an API key and the embedder a shared secret.

## Consent
A student cannot be registered unless the admin ticks "The student and guardian consent to storing face data for hostel attendance". The server refuses registration without it and records the consent. The checkbox is a record that consent was obtained; the form does not collect a signature.

## Retention and deletion
- Face embeddings and the student's records are kept **while the student is registered** and are removed when the student is deleted (Admin > Students > Delete): the face profiles and their Qdrant points, the student, their login and any parent login with no other ward.
- A student who has attendance, gate, violation, leave or scan history **cannot be deleted** (the history is evidence other records depend on). To remove their face data in that case, use Re-enrol to replace it, or remove the individual face samples through the face API. Whether and when old history is erased is a decision for the institution; this project has no automatic expiry.
- `npm run qdrant:reset -- --yes` and `npm run demo:clear -- --yes` delete all face data (the latter all students too). They exist for development and demos.

## Known limits
- No liveness detection: a printed photo or a phone screen can pass as a face.
- Matching is statistical. A wrong accept or reject is possible, especially with look-alikes, poor light, glasses or masks; uncertain scans go to a warden, and the thresholds have only been tested on a small sample (see `docs/vector-design.md`).
- InsightFace's pretrained models are licensed for non-commercial research use only.
- No audit log of who viewed what; sessions are not revocable before they expire (planned in the hardening work).
- Backups of the Docker volumes would contain embeddings; protect and delete them like the live data.
