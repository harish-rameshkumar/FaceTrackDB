// Removes ONLY the generated and seeded demo rows (see db/b_demo.sql, demo_reset()), leaving every
// real row alone: real students and parents, their face_profiles and Qdrant points, real scans, real
// roll calls and the sample data from seed.sql.
//   npm run demo:reset -- --yes [--db NAME]
// Never connects to Qdrant: demo students have no face data, so there is nothing to remove there.
import { getPool } from "../lib/db";
import { confirmTarget } from "./lib/demo-target";

const args = process.argv.slice(2);
const TABLES = [
  ["users", "users"], ["students", "students"], ["parents", "parents"], ["face_profiles", "face_profiles (real enrolments)"],
  ["attendance_sessions", "roll calls"], ["attendance", "attendance marks"], ["entry_exit_log", "gate log rows"], ["face_events", "face events"],
  ["leave_requests", "leave requests"], ["violations", "violations"], ["hostels", "hostels"], ["gates", "gates"], ["cameras", "cameras"],
] as const;

async function counts(): Promise<Record<string, number>> {
  const pool = getPool();
  const out: Record<string, number> = {};
  for (const [t] of TABLES) out[t] = Number((await pool.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
  return out;
}

async function main() {
  confirmTarget(args, "demo:reset removes ONLY the generated and seeded demo rows (real rows, face profiles and Qdrant are not touched).");
  const pool = getPool();
  if (!(await pool.query("SELECT to_regclass('b_demo_rows') IS NOT NULL AS ok")).rows[0].ok) {
    console.error("b_demo_rows is missing. Run ./db/load_b.sh first.");
    process.exit(1);
  }
  const tracked = Number((await pool.query("SELECT count(*) AS n FROM b_demo_rows")).rows[0].n);
  const labelled = (await pool.query("SELECT 1 FROM b_meta WHERE key IN ('generated_history', 'demo_seed')")).rowCount ?? 0;
  const before = await counts();
  if (tracked === 0 && labelled === 0) {
    console.log("There is no generated demo data here. Nothing to do.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let removed: { what: string; removed: number }[] = [];
  try {
    await client.query("BEGIN");
    removed = (await client.query<{ what: string; removed: number }>("SELECT * FROM demo_reset()")).rows;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const after = await counts();

  console.log(`\nRemoved ${tracked} tracked rows and what hangs off them:`);
  for (const r of removed) if (r.removed > 0) console.log(`  - ${r.removed} ${r.what}`);
  console.log("\nRow counts, before -> after:");
  for (const [t, label] of TABLES) console.log(`  ${label.padEnd(34)} ${String(before[t]).padStart(6)} -> ${String(after[t]).padStart(6)}`);
  console.log(`\nReal face profiles: ${before.face_profiles} -> ${after.face_profiles} (${before.face_profiles === after.face_profiles ? "unchanged, as it must be" : "CHANGED: this should never happen"}).`);
  await pool.end();
  if (before.face_profiles !== after.face_profiles) process.exit(2);
}

main().catch((e) => {
  console.error("demo:reset failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
