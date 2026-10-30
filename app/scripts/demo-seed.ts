// One command that fills the app with believable data for a presentation.
//   npm run demo:seed -- --yes [--seed N] [--days N] [--reset] [--db NAME]
// It (1) registers 14 fictional students and their parent logins through the SAME stored function the admin
// page uses (register_student), so every constraint and trigger runs, (2) adds a third hostel with a gate
// and camera if the database has fewer than three, and (3) generates 45 days (default) of roll calls, gate
// crossings, late returns, violations and leave requests with the real procedures.
// NO face data is created: the demo students have no face_profiles and no Qdrant points, so nobody can be
// "recognised" as them. Every row it creates is recorded in b_demo_rows and labelled in b_meta, so
// `npm run demo:reset -- --yes` can remove exactly this and nothing else.
// Refuses on a database that already has demo data unless --reset is given.
import bcrypt from "bcryptjs";
import { getPool } from "../lib/db";
import { argValue, confirmTarget } from "./lib/demo-target";
import { generateHistory } from "./lib/demo-history";
import { DEMO_PASSWORD, DEMO_STUDENTS, liveIdentity, parentEmail, parentPhone, srn, studentEmail } from "./lib/demo-data";

const args = process.argv.slice(2);
const SEED = Number(argValue(args, "--seed") ?? 20261027);
const DAYS = Number(argValue(args, "--days") ?? 45);
if (!Number.isInteger(SEED) || !Number.isInteger(DAYS) || DAYS < 10 || DAYS > 120) {
  console.error("--seed must be a whole number and --days a whole number from 10 to 120");
  process.exit(1);
}

async function main() {
  confirmTarget(args, `demo:seed will register ${DEMO_STUDENTS.length} fictional students with parent logins and generate ${DAYS} days of SIMULATED history (seed ${SEED}).`);
  const pool = getPool();
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

  if (!(await one("SELECT to_regclass('b_demo_rows') IS NOT NULL AND to_regclass('b_meta') IS NOT NULL AND to_regclass('b_consents') IS NOT NULL AS ok"))[0].ok) {
    console.error("The demo tables are missing. Run ./db/load_b.sh first (it creates them).");
    process.exit(1);
  }
  const hasDemo = (await one("SELECT 1 FROM b_demo_rows LIMIT 1")).length > 0 || (await one("SELECT 1 FROM b_meta WHERE key IN ('demo_seed','generated_history')")).length > 0;
  if (hasDemo) {
    if (!args.includes("--reset")) {
      console.error("REFUSING: this database already has demo data. Run with --reset to replace it (only the generated rows are removed), or run npm run demo:reset -- --yes.");
      process.exit(1);
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const out = (await c.query<{ what: string; removed: number }>("SELECT * FROM demo_reset()")).rows.filter((r) => r.removed > 0);
      await c.query("COMMIT");
      console.log(`--reset: removed the earlier demo data (${out.map((r) => `${r.removed} ${r.what}`).join(", ")}).`);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // nothing real may be in the way of OUR students: refuse (before changing anything) if one of their emails or SRNs is taken
  const emails = [...DEMO_STUDENTS.map(studentEmail), ...DEMO_STUDENTS.map(parentEmail)];
  const srns = DEMO_STUDENTS.map(srn);
  const takenEmail = await one("SELECT email FROM users WHERE lower(email) = ANY($1::text[])", [emails]);
  const takenSrn = await one("SELECT roll_no FROM students WHERE upper(roll_no) = ANY($1::text[])", [srns.map((s) => s.toUpperCase())]);
  if (takenEmail.length || takenSrn.length) {
    console.error(`REFUSING: these already exist and are not demo rows: ${[...takenEmail.map((r) => r.email), ...takenSrn.map((r) => r.roll_no)].join(", ")}. Nothing was changed.`);
    process.exit(1);
  }
  // the live-demo student: the suggested SRN and emails if they are free, else the next free ones (e.g. after a live demo already used them)
  let liveSuffix = 0;
  for (; liveSuffix < 99; liveSuffix++) {
    const trial = liveIdentity(liveSuffix);
    const used = (await one("SELECT 1 FROM students WHERE upper(roll_no) = upper($1) UNION ALL SELECT 1 FROM users WHERE lower(email) = ANY($2::text[])", [trial.srn, [trial.email, trial.parentEmail]])).length > 0;
    if (!used) break;
  }
  const liveId = liveIdentity(liveSuffix);
  const adminId = (await one("SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id LIMIT 1"))[0]?.user_id;
  if (!adminId) {
    console.error("There is no admin account to register the students with.");
    process.exit(1);
  }
  const today: string = (await one("SELECT to_char(current_date, 'YYYY-MM-DD') AS d"))[0].d;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const track = (kind: string, id: number) => client.query("INSERT INTO b_demo_rows (kind, row_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [kind, id]);

    // ---- hostels: use the existing ones, add a third if needed (with a gate and an active camera) ----
    let hostels = (await client.query<{ hostel_id: number; name: string }>("SELECT hostel_id, name FROM hostels ORDER BY hostel_id")).rows;
    const withCamera = new Set((await client.query<{ hostel_id: number }>("SELECT DISTINCT g.hostel_id FROM gates g JOIN cameras c ON c.gate_id = g.gate_id WHERE c.status = 'active'")).rows.map((r) => r.hostel_id));
    const added: string[] = [];
    for (const name of ["Visvesvaraya Boys Hostel", "Tagore Girls Hostel"]) {
      if (hostels.filter((h) => withCamera.has(h.hostel_id)).length + added.length >= 3) break;
      if (hostels.some((h) => h.name === name)) continue;
      const h = (await client.query<{ hostel_id: number }>("INSERT INTO hostels (name) VALUES ($1) RETURNING hostel_id", [name])).rows[0].hostel_id;
      const g = (await client.query<{ gate_id: number }>("INSERT INTO gates (hostel_id, name) VALUES ($1, 'Main Gate') RETURNING gate_id", [h])).rows[0].gate_id;
      const c = (await client.query<{ camera_id: number }>("INSERT INTO cameras (gate_id, location, status) VALUES ($1, 'Main gate (demo hostel)', 'active') RETURNING camera_id", [g])).rows[0].camera_id;
      await track("hostel", h); await track("gate", g); await track("camera", c);
      withCamera.add(h);
      added.push(name);
    }
    hostels = (await client.query<{ hostel_id: number; name: string }>("SELECT hostel_id, name FROM hostels ORDER BY hostel_id")).rows.filter((h) => withCamera.has(h.hostel_id));

    // ---- students and parents, through register_student (the admin page's function) ----
    const counters = new Map<number, number>();
    const turn = { M: 0, F: 0 };
    const created: { name: string; srn: string; hostel: string; room: string; email: string }[] = [];
    for (const [i, s] of DEMO_STUDENTS.entries()) {
      const fits = hostels.filter((h) => (s.gender === "M" ? !/girls/i.test(h.name) : !/boys/i.test(h.name)));
      const pool_ = fits.length ? fits : hostels;
      const host = pool_[turn[s.gender]++ % pool_.length];
      const k = (counters.get(host.hostel_id) ?? 0) + 1;
      counters.set(host.hostel_id, k);
      const room = `${host.name[0].toUpperCase()}-${2 + Math.floor((k - 1) / 4)}${String(((k - 1) % 4) * 3 + 1 + (i % 2)).padStart(2, "0")}`; // x-201, x-204 ... never a first-floor (x-1nn) room
      const student = { email: studentEmail(s), hash: await bcrypt.hash(DEMO_PASSWORD, 10), roll_no: srn(s), name: `${s.first} ${s.last}`, hostel_id: host.hostel_id, room_no: room };
      const parent = { email: parentEmail(s), hash: await bcrypt.hash(DEMO_PASSWORD, 10), name: `${s.parent.first} ${s.parent.last}`, phone: parentPhone(i), relation: s.parent.relation };
      const res = (await client.query<{ r: { student_id: number } }>("SELECT register_student($1::jsonb, $2::jsonb, TRUE, $3) AS r", [JSON.stringify(student), JSON.stringify([parent]), adminId])).rows[0].r;
      await track("student", res.student_id);
      created.push({ name: student.name, srn: student.roll_no, hostel: host.name, room, email: student.email });
    }

    // ---- the history ----
    const { stats, label } = await generateHistory(client, { days: DAYS, seed: SEED, today });
    const live = { ...liveId, hostel: hostels[0].name, room: `${hostels[0].name[0].toUpperCase()}-${liveId.roomNumber}` };
    await client.query("INSERT INTO b_meta (key, value) VALUES ('demo_seed', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [JSON.stringify({ seed: SEED, days: DAYS, students: created.length, hostels_added: added, seeded_at: today, live_student: live })]);
    await client.query("COMMIT");

    const per = (await pool.query("SELECT kind, count(*)::int AS n FROM b_demo_rows GROUP BY kind ORDER BY kind")).rows;
    const parents = Number((await pool.query("SELECT count(DISTINCT parent_id) AS n FROM student_parent WHERE student_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'student')")).rows[0].n);
    console.log(`\nSeeded ${created.length} demo students and ${parents} parent logins in ${new Set(created.map((c) => c.hostel)).size} hostels${added.length ? ` (added: ${added.join(", ")})` : ""}.`);
    for (const c of created) console.log(`  ${c.srn.padEnd(8)} ${c.name.padEnd(22)} ${c.hostel.padEnd(26)} ${c.room.padEnd(6)} ${c.email}`);
    console.log(`\nHistory ${label.from} to ${label.to} (${DAYS} days, seed ${SEED}), SIMULATED and labelled so:`);
    console.log(`  roll calls: ${stats.sessions}, marks: ${stats.marks}, marked absent when closing: ${stats.closedAbsent}`);
    console.log(`  gate crossings: ${stats.gateEvents}, face events (all database-only): ${stats.faceEvents}, leave requests: ${stats.leaves}`);
    console.log(`  violations: ${stats.violations} (${stats.resolved} resolved, ${stats.violations - stats.resolved} open)`);
    console.log(`Tracked rows in b_demo_rows: ${per.map((p) => `${p.kind} ${p.n}`).join(", ")}`);
    console.log(`Every account (student and parent) has the password ${DEMO_PASSWORD}. No face data was created.`);
    console.log("\nFor the LIVE demo, register this student at /admin/students/new, then enrol the face at /enrol:");
    console.log(`  name ${live.name} | SRN ${live.srn} | hostel ${live.hostel} | room ${live.room}`);
    console.log(`  student email ${live.email} | parent ${live.parentName} (${live.relation}) ${live.parentEmail} ${live.parentPhone}`);
    console.log("Remove everything this command created with: npm run demo:reset -- --yes");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error("demo:seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
