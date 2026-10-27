// Enrols deterministic SYNTHETIC embeddings (3 per seeded student) so the matching
// tests can run without a camera or the embedder. Random vectors are not faces:
// this script therefore refuses to touch the real face_embeddings collection and
// only works on a throw-away collection whose name ends in "_test" AND a scratch/test database
// (it writes fake rows into face_profiles).
// Run: DATABASE_URL=.../facetrack_test QDRANT_COLLECTION=face_embeddings_test npm run seed:faces [-- --reset]
import { deleteProfile, enrolEmbeddings } from "../lib/faces";
import { getPool } from "../lib/db";
import { checkCollection, COLLECTION, createCollection } from "../lib/qdrant";
import { assertTestEnvironment, baseEmbedding, embeddingAtSimilarity } from "./synthetic";

async function main() {
  assertTestEnvironment(COLLECTION);
  if ((await checkCollection()).state === "missing") await createCollection();
  const reset = process.argv.includes("--reset");
  const pool = getPool();
  const { rows: students } = await pool.query<{ student_id: number; name: string }>(
    "SELECT student_id, name FROM students ORDER BY student_id",
  );
  for (const s of students) {
    const { rows: existing } = await pool.query<{ profile_id: number }>(
      "SELECT profile_id FROM face_profiles WHERE student_id = $1",
      [s.student_id],
    );
    if (existing.length > 0 && !reset) {
      console.log(`skip ${s.name}: already has ${existing.length} profiles`);
      continue;
    }
    for (const p of existing) await deleteProfile(p.profile_id);
    const base = baseEmbedding(s.student_id);
    // three enrolment "photos" of the same face: cosine 0.85 to the base
    const embeddings = [1, 2, 3].map((k) => embeddingAtSimilarity(base, 0.85, s.student_id * 100 + k));
    const profiles = await enrolEmbeddings(s.student_id, embeddings);
    console.log(`enrolled ${s.name}: profiles ${profiles.map((p) => p.faceProfileId).join(", ")}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("seed-face-vectors failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
