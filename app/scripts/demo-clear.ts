// DESTRUCTIVE. Removes every student and parent and everything that belongs to them,
// so you can start clean and register people through the UI (/admin/students/new).
//   npm run demo:clear            prints what it WOULD delete and changes nothing
//   npm run demo:clear -- --yes   deletes it
// Deleted: students, parents (and their user logins), leave requests, attendance, gate log,
// face events, violations, face profiles, consent records, and the Qdrant face points.
// Kept: hostels, gates, cameras, roll-call sessions and the staff accounts (warden, security, admin).
import { getPool } from "../lib/db";
import { checkCollection, COLLECTION, createCollection, getQdrant } from "../lib/qdrant";

const TABLES = [
  ["violations", "violations"], ["attendance", "attendance rows"], ["entry_exit_log", "gate log rows"],
  ["face_events", "face events"], ["leave_requests", "leave requests"], ["face_profiles", "face profiles"],
  ["b_consents", "consent records"], ["student_parent", "student-parent links"], ["students", "students"], ["parents", "parents"],
] as const;

async function main() {
  const pool = getPool();
  const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);
  const exists = async (t: string) => (await pool.query("SELECT to_regclass($1) IS NOT NULL AS ok", [t])).rows[0].ok as boolean;

  console.log("demo:clear is DESTRUCTIVE. It will delete:");
  const plan: [string, number][] = [];
  for (const [table, label] of TABLES) if (await exists(table)) plan.push([label, await count(`SELECT count(*) AS n FROM ${table}`)]);
  plan.push(["student and parent logins (users)", await count("SELECT count(*) AS n FROM users WHERE role IN ('student','parent')")]);
  for (const [label, n] of plan) console.log(`  - ${n} ${label}`);
  const status = await checkCollection();
  const points = status.state === "missing" ? 0 : ((await getQdrant().getCollection(COLLECTION)).points_count ?? 0);
  console.log(`  - the Qdrant collection ${COLLECTION} (${status.state}, ${points} points), recreated empty`);
  const kept = await count("SELECT count(*) AS n FROM users WHERE role NOT IN ('student','parent')");
  console.log(`Kept: hostels, gates, cameras, roll-call sessions and ${kept} staff account(s).`);

  if (!process.argv.includes("--yes")) {
    console.log("\nNothing was changed. Run again with --yes to delete.");
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [table] of TABLES) if (await exists(table)) await client.query(`DELETE FROM ${table}`);
    await client.query("DELETE FROM users WHERE role IN ('student','parent')");
    if (status.state !== "missing") await getQdrant().deleteCollection(COLLECTION);
    await createCollection();
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  console.log("\nDone. Register students at /admin/students/new.");
  await pool.end();
}

main().catch((e) => {
  console.error("demo:clear failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
