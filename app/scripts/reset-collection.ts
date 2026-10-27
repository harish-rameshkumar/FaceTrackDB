// Deletes and recreates the Qdrant collection AND deletes every face_profiles
// row, so PostgreSQL and Qdrant stay consistent. Needed when embeddings
// change space (for example the move from 128-d face-api to 512-d ArcFace): all
// old vectors are useless and every student must be re-enrolled.
// face_profiles has no incoming foreign keys, and face_events (the scan
// history) does not reference it, so the history is kept untouched.
// Run: npm run qdrant:reset            (prints what would be deleted)
//      npm run qdrant:reset -- --yes   (does it)
import { getPool } from "../lib/db";
import { checkCollection, COLLECTION, createCollection, getQdrant } from "../lib/qdrant";

async function main() {
  const pool = getPool();
  const profiles = Number((await pool.query("SELECT count(*) AS n FROM face_profiles")).rows[0].n);
  const status = await checkCollection();
  const points = status.state === "missing" ? 0 : ((await getQdrant().getCollection(COLLECTION)).points_count ?? 0);

  console.log("qdrant:reset will:");
  console.log(`  - delete ${profiles} face_profiles rows in PostgreSQL`);
  console.log(`  - delete the Qdrant collection ${COLLECTION} (${status.state}, ${points} points) and recreate it empty`);
  console.log("  - keep face_events, attendance and every other table unchanged");
  if (!process.argv.includes("--yes")) {
    console.log("Nothing was changed. Run again with --yes to proceed.");
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM face_profiles");
    const q = getQdrant();
    if (status.state !== "missing") await q.deleteCollection(COLLECTION);
    await createCollection();
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const after = await checkCollection();
  console.log("Done:", after);
  console.log("Every student must now be enrolled again (admin > /enrol).");
  await pool.end();
}

main().catch((e) => {
  console.error("qdrant:reset failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
