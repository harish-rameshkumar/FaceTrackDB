// Enrols deterministic synthetic descriptors (3 per seeded student) so
// matching can be demonstrated without a camera. Skips students who already
// have face profiles; pass --reset to delete and recreate them.
// Run: npm run seed:faces [-- --reset]
import { deleteProfile, enrolDescriptors } from "../lib/faces";
import { getPool } from "../lib/db";
import { baseDescriptor, noisyDescriptor } from "./synthetic";

async function main() {
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
    const base = baseDescriptor(s.student_id);
    // three enrolment "photos" of the same face: small deterministic variation
    const descriptors = [1, 2, 3].map((k) => noisyDescriptor(base, 0.15, s.student_id * 100 + k));
    const profiles = await enrolDescriptors(s.student_id, descriptors);
    console.log(`enrolled ${s.name}: profiles ${profiles.map((p) => p.faceProfileId).join(", ")}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("seed-face-vectors failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
