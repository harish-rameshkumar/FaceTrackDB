// Fills realistic PAST activity for the students that exist, so the reports have something to show.
//   npm run demo:history -- --days 30 --yes [--seed N]
// Everything is GENERATED, simulated data; see scripts/lib/demo-history.ts for how, what is written
// directly and how it is labelled (b_meta 'generated_history' and b_demo_rows). `npm run demo:seed`
// does this AND registers demo students first; `npm run demo:reset -- --yes` removes it again.
// Refuses with fewer than 4 students, and when generated history already exists.
import { getPool } from "../lib/db";
import { argValue, confirmTarget } from "./lib/demo-target";
import { generateHistory } from "./lib/demo-history";

const args = process.argv.slice(2);
const DAYS = Number(argValue(args, "--days") ?? 30);
const SEED = Number(argValue(args, "--seed") ?? 20261027 + DAYS);
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 120) {
  console.error("--days must be a whole number from 1 to 120");
  process.exit(1);
}
if (!Number.isInteger(SEED)) {
  console.error("--seed must be a whole number");
  process.exit(1);
}

async function main() {
  confirmTarget(args, `demo:history would add about ${DAYS} days of SIMULATED attendance, gate crossings, face scans, leave requests and violations for the existing students (seed ${SEED}).`);
  const pool = getPool();
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

  const n = Number((await one("SELECT count(*) AS n FROM students"))[0].n);
  if (n < 4) {
    console.error(`Only ${n} student(s) exist. Demo history needs at least 4: use npm run demo:seed (which registers demo students first), register more students, or load the sample data.`);
    process.exit(1);
  }
  if (!(await one("SELECT to_regclass('b_demo_rows') IS NOT NULL AND to_regclass('b_meta') IS NOT NULL AS ok"))[0].ok) {
    console.error("b_meta / b_demo_rows are missing. Run ./db/load_b.sh first (it creates them).");
    process.exit(1);
  }
  if ((await one("SELECT 1 FROM b_demo_rows LIMIT 1")).length > 0 || (await one("SELECT 1 FROM b_meta WHERE key = 'generated_history'")).length > 0) {
    console.error("Generated demo data already exists in this database. Run npm run demo:reset -- --yes first (it removes only the generated rows).");
    process.exit(1);
  }

  const today: string = (await one("SELECT to_char(current_date, 'YYYY-MM-DD') AS d"))[0].d;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { stats, label } = await generateHistory(client, { days: DAYS, seed: SEED, today });
    await client.query("COMMIT");
    console.log(`\nGenerated demo history for ${stats.students} students, ${label.from} to ${label.to} (${DAYS} days, seed ${SEED}). This is SIMULATED data.`);
    console.log(`  roll calls: ${stats.sessions}, marks via mark_attendance: ${stats.marks}, marked absent when closing: ${stats.closedAbsent}`);
    console.log(`  gate crossings via record_entry_exit: ${stats.gateEvents}, face events: ${stats.faceEvents}, leave requests: ${stats.leaves}`);
    console.log(`  violations raised: ${stats.violations} (${stats.violationsFromClose} from closing roll calls), resolved by the warden: ${stats.resolved}`);
    console.log("Open /reports: it shows a note that generated history is included. Remove it with: npm run demo:reset -- --yes");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error("demo:history failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
