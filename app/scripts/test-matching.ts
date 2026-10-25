// End-to-end test of POST /api/faces/match against the running dev server,
// using the synthetic descriptors from `npm run seed:faces`.
// Needs: docker compose up, SQL loaded, `npm run qdrant:init`, `npm run seed:faces`,
// and `npm run dev` listening on BASE_URL (default http://localhost:3000).
// It creates a roll-call session for hostel 2 around "now", and deletes every
// row it created when it finishes. Prints a markdown table.
// Distances are Euclidean (L2). Thresholds: MATCH_MAX_DISTANCE / REVIEW_MAX_DISTANCE.
// Signs in through POST /api/login. The accounts come from db/seed.sql (first
// security, admin and student email) and the demo password from the comment in
// db/demo_passwords.sql, so no credential is hard-coded here. Override with
// TEST_PASSWORD if you changed the demo password.
// Gate scan cooldown: SCAN_COOLDOWN_SECONDS must be the SAME value for the dev
// server and for this script (the script reads it from its own environment, with
// the same default of 20 and the same validation). Use a short one so the run is fast:
//   SCAN_COOLDOWN_SECONDS=3 npm run dev                              (terminal 1)
//   SCAN_COOLDOWN_SECONDS=3 BASE_URL=http://localhost:3000 npm run test:match   (terminal 2)
// Run it once with 0 as well: that skips the cooldown cases and instead checks
// that 0 really disables the cooldown.
// Run: BASE_URL=http://localhost:3111 npm run test:match
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../lib/db";
import { getScanCooldownSeconds } from "../lib/matching";
import { baseDescriptor, descriptorAtDistance, randomDescriptor } from "./synthetic";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const pool = getPool();
const rows: string[] = [];
let failures = 0;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Role = "security" | "admin" | "student";

// Reads the seeded account email of a role and the shared demo password from the SQL files.
function demoCredentials(role: Role): { email: string; password: string } {
  const dbDir = resolve(process.cwd(), "..", "db");
  const seed = readFileSync(resolve(dbDir, "seed.sql"), "utf8");
  const match = new RegExp(`'([^']+@[^']+)'[^)\\n]*'${role}'\\)`).exec(seed);
  const demo = readFileSync(resolve(dbDir, "demo_passwords.sql"), "utf8");
  const pw = process.env.TEST_PASSWORD ?? /Password for all accounts:\s+(\S+)/.exec(demo)?.[1];
  if (!match || !pw) throw new Error(`Could not find a ${role} account or the demo password in db/seed.sql / db/demo_passwords.sql`);
  return { email: match[1], password: pw };
}

const cookies: Partial<Record<Role, string>> = {};

// Logs in once per role and returns the session cookie ("name=value").
async function cookieFor(role: Role): Promise<string> {
  if (!cookies[role]) {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(demoCredentials(role)),
    });
    const setCookie = res.headers.get("set-cookie");
    if (!res.ok || !setCookie) throw new Error(`Login as ${role} failed (HTTP ${res.status}); are the demo passwords loaded (db/demo_passwords.sql)?`);
    cookies[role] = setCookie.split(";")[0];
  }
  return cookies[role] as string;
}

async function authHeaders(role: Role | null): Promise<Record<string, string>> {
  return role ? { "content-type": "application/json", cookie: await cookieFor(role) } : { "content-type": "application/json" };
}

async function post(body: unknown, role: Role | null = "security"): Promise<{ status: number; json: Json; retryAfter: string | null }> {
  const res = await fetch(`${BASE}/api/faces/match`, {
    method: "POST",
    headers: await authHeaders(role),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json(), retryAfter: res.headers.get("retry-after") };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function record(name: string, input: string, expected: string, actual: string, pass: boolean) {
  if (!pass) failures++;
  rows.push(`| ${name} | ${input} | ${expected} | ${actual} | ${pass ? "PASS" : "FAIL"} |`);
}

const enrolled = (sid: number, k: number) => descriptorAtDistance(baseDescriptor(sid), 0.15, sid * 100 + k);
const d3 = (x: number | null | undefined) => (typeof x === "number" ? x.toFixed(3) : "-");

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params);
  return Number(Object.values(r.rows[0])[0]);
}

let lookalikeIds: number[] = [];
async function removeLookalikes() {
  for (const id of lookalikeIds) {
    await fetch(`${BASE}/api/faces/${id}`, { method: "DELETE", headers: await authHeaders("admin") });
  }
  lookalikeIds = [];
}

async function main() {
  const maxEvent = await scalar("SELECT COALESCE(max(event_id),0) FROM face_events");
  const maxLog = await scalar("SELECT COALESCE(max(log_id),0) FROM entry_exit_log");
  const maxViolation = await scalar("SELECT COALESCE(max(violation_id),0) FROM violations");
  const hourNow = await scalar("SELECT extract(hour FROM localtime)::int");
  const minuteNow = await scalar("SELECT extract(minute FROM localtime)::int");
  const now = `${String(hourNow).padStart(2, "0")}:${String(minuteNow).padStart(2, "0")} IST`;
  const { rows: sess } = await pool.query(
    `INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time)
     VALUES (2, current_date, localtime(0) - interval '10 minutes', localtime(0) + interval '30 minutes')
     RETURNING session_id`,
  );
  const sessionId: number = sess[0].session_id;

  try {
    const att = (sid: number) => scalar("SELECT count(*) FROM attendance WHERE session_id=$1 AND student_id=$2", [sessionId, sid]);
    const events = () => scalar("SELECT count(*) FROM face_events WHERE event_id > $1", [maxEvent]);

    // --- attendance cases (hostel 2, camera 4) ---
    let r = await post({ descriptor: enrolled(4, 1), camera_id: 4, purpose: "attendance" });
    record("Exact match", "student 4's enrolled vector #1 (distance 0)", "matched, attendance present",
      `${r.status} ${r.json.outcome} dist=${d3(r.json.distance)} conf=${r.json.confidence} -> ${r.json.result?.status}; rows=${await att(4)}`,
      r.status === 200 && r.json.outcome === "matched" && r.json.result?.status === "present" && (await att(4)) === 1);

    r = await post({ descriptor: descriptorAtDistance(baseDescriptor(5), 0.25, 777), camera_id: 4, purpose: "attendance" });
    record("Noisy copy", "student 5 face + offset 0.25 (a new photo)", "still matched, present",
      `${r.status} ${r.json.outcome} dist=${d3(r.json.distance)} margin=${d3(r.json.margin)} -> ${r.json.result?.status}`,
      r.status === 200 && r.json.outcome === "matched" && r.json.student?.student_id === 5 && r.json.result?.status === "present");

    r = await post({ descriptor: randomDescriptor(424242), camera_id: 4, purpose: "attendance" });
    record("Random vector", "unrelated random vector", "no_match, nobody marked",
      `${r.status} ${r.json.outcome} dist=${d3(r.json.distance)} conf=${r.json.confidence} student=${r.json.student}`,
      r.status === 200 && r.json.outcome === "no_match" && r.json.student === null && r.json.result === null);

    r = await post({ descriptor: descriptorAtDistance(baseDescriptor(6), 0.5, 99), camera_id: 4, purpose: "attendance" });
    record("Review band", "student 6 face + offset 0.5 (expect distance ~0.52)", "low_confidence, NOT marked, event kept",
      `${r.status} ${r.json.outcome} dist=${d3(r.json.distance)} conf=${r.json.confidence}; attendance rows=${await att(6)}`,
      r.status === 200 && r.json.outcome === "low_confidence" && r.json.student?.student_id === 6 && (await att(6)) === 0);

    const eventsBefore = await events();
    r = await post({ descriptor: enrolled(4, 1), camera_id: 4, purpose: "attendance" });
    record("Duplicate scan", "student 4 again, same roll call", "409 FT001, event still logged, still 1 attendance row",
      `${r.status} ${r.json.error?.code}; events +${(await events()) - eventsBefore}; rows=${await att(4)}`,
      r.status === 409 && r.json.error?.code === "FT001" && (await events()) === eventsBefore + 1 && (await att(4)) === 1);

    r = await post({ descriptor: enrolled(1, 1), camera_id: 1, purpose: "attendance" });
    record("No roll call open", `student 1 at hostel 1 camera (no session at ${now})`, "409 no_active_session",
      `${r.status} ${r.json.outcome} ${r.json.error?.code}`,
      r.status === 409 && r.json.error?.code === "no_active_session");

    r = await post({ descriptor: enrolled(1, 1), camera_id: 4, purpose: "attendance" });
    record("Wrong hostel", "student 1 (hostel 1) scanned at hostel 2 camera", "403 FT003",
      `${r.status} ${r.json.error?.code}`, r.status === 403 && r.json.error?.code === "FT003");

    // The API only calls the procedure inside an open window, so test the database's
    // own window check directly: a mark for yesterday's session must be refused (FT004).
    const c = await pool.connect();
    let ft004 = "no error";
    try {
      await c.query("BEGIN");
      const ev = await c.query("INSERT INTO face_events (camera_id, student_id, confidence, outcome) VALUES (1, 1, 0.95, 'matched') RETURNING event_id");
      const past = await c.query("SELECT session_id FROM attendance_sessions WHERE hostel_id = 1 AND session_date < current_date ORDER BY session_id DESC LIMIT 1");
      await c.query("CALL mark_attendance(1, $1, $2, NULL)", [past.rows[0].session_id, ev.rows[0].event_id]);
    } catch (e) {
      ft004 = (e as { code?: string }).code ?? "unknown";
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    record("Outside window (DB)", "CALL mark_attendance on a past session", "database rejects with FT004", ft004, ft004 === "FT004");

    // --- gate cases (student 4, hostel 2, camera 4 -> gate 3) ---
    const lateOut = hourNow >= 20 || hourNow < 5;
    const lateIn = hourNow > 22 || (hourNow === 22 && minuteNow >= 30) || hourNow < 5;
    const expectOut = lateOut ? "no_leave" : null;
    const expectIn = lateIn ? "late_return" : null;
    const exact4 = enrolled(4, 1);
    const cooldown = getScanCooldownSeconds(); // same value as the server's SCAN_COOLDOWN_SECONDS
    const waitOutCooldown = () => sleep(cooldown > 0 ? (cooldown + 1) * 1000 : 0);

    r = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit" });
    record("Gate: first scan", `student 4, direction inferred, ${now}`, `OUT, violation ${expectOut}`,
      `${r.status} ${r.json.outcome} ${r.json.result?.direction} violation=${r.json.result?.violation_type}`,
      r.status === 200 && r.json.result?.direction === "OUT" && r.json.result?.violation_type === expectOut);

    await waitOutCooldown(); // the same student may not be scanned again within the cooldown
    r = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit", direction: "IN" });
    record("Gate: return", `student 4, IN, ${now}`, `IN, violation ${expectIn}`,
      `${r.status} ${r.json.result?.direction} violation=${r.json.result?.violation_type}`,
      r.status === 200 && r.json.result?.direction === "IN" && r.json.result?.violation_type === expectIn);

    await waitOutCooldown();
    const evBefore = await events();
    r = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit", direction: "IN" });
    record("Gate: duplicate IN", "student 4 IN twice", "409 FT022, event still logged",
      `${r.status} ${r.json.error?.code}; events +${(await events()) - evBefore}`,
      r.status === 409 && r.json.error?.code === "FT022" && (await events()) === evBefore + 1);

    // --- scan cooldown (gate scans only) ---
    const logsOf = (sid: number) => scalar("SELECT count(*) FROM entry_exit_log WHERE student_id=$1", [sid]);
    const violations = () => scalar("SELECT count(*) FROM violations");
    const lastDirection = async (sid: number) =>
      (await pool.query("SELECT direction FROM entry_exit_log WHERE student_id=$1 ORDER BY event_time DESC, log_id DESC LIMIT 1", [sid])).rows[0]?.direction;

    // config parsing: 0 disables, bad values fall back to the default of 20
    {
      const saved = process.env.SCAN_COOLDOWN_SECONDS;
      const parse = (v: string | undefined) => {
        if (v === undefined) delete process.env.SCAN_COOLDOWN_SECONDS;
        else process.env.SCAN_COOLDOWN_SECONDS = v;
        return getScanCooldownSeconds();
      };
      const got = [parse("0"), parse("3"), parse(undefined), parse(""), parse("abc"), parse("-5"), parse("1.5")];
      if (saved === undefined) delete process.env.SCAN_COOLDOWN_SECONDS;
      else process.env.SCAN_COOLDOWN_SECONDS = saved;
      record("Cooldown config", "SCAN_COOLDOWN_SECONDS = 0, 3, unset, '', abc, -5, 1.5", "0, 3, 20, 20, 20, 20, 20 (0 disables)", got.join(", "),
        got.join(",") === "0,3,20,20,20,20,20");
    }

    if (cooldown > 0) {
      await waitOutCooldown();
      // (a) a second gate scan inside the cooldown is refused and writes nothing
      const first = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit" });
      const dirBefore = await lastDirection(4);
      const evA = await events(), logA = await logsOf(4), vioA = await violations();
      r = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit" });
      record("Cooldown: second scan refused", `student 4 gate scan right after another (cooldown ${cooldown}s)`,
        "429 scan_cooldown, Retry-After set, no new face event / gate log / violation, direction unchanged",
        `${first.status} then ${r.status} ${r.json.code} retry=${r.json.retryAfterSeconds} header=${r.retryAfter}; events +${(await events()) - evA}, logs +${(await logsOf(4)) - logA}, violations +${(await violations()) - vioA}, last=${await lastDirection(4)}`,
        first.status === 200 && r.status === 429 && r.json.code === "scan_cooldown" && r.json.retryAfterSeconds > 0 && r.json.retryAfterSeconds <= cooldown &&
          r.retryAfter === String(r.json.retryAfterSeconds) && typeof r.json.error === "string" && r.json.error.startsWith("Already scanned. Please wait") &&
          (await events()) === evA && (await logsOf(4)) === logA && (await violations()) === vioA && (await lastDirection(4)) === dirBefore);

      // (c) someone else is not held up by student 4's cooldown
      const evC = await events();
      const other = await post({ descriptor: enrolled(5, 1), camera_id: 4, purpose: "entry_exit" });
      const still = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit" });
      record("Cooldown: other student unaffected", "student 5 gate scan while student 4 is cooling down", "200 recorded for 5, student 4 still 429",
        `student 5: ${other.status} ${other.json.result?.direction}; student 4: ${still.status}`,
        other.status === 200 && other.json.result?.kind === "entry_exit" && still.status === 429 && (await events()) === evC + 1);

      // (b) after the cooldown the scan is accepted and the direction flips
      await waitOutCooldown();
      r = await post({ descriptor: exact4, camera_id: 4, purpose: "entry_exit" });
      record("Cooldown: allowed again after waiting", `student 4 after ${cooldown + 1}s`, `200, direction flips from ${dirBefore}`,
        `${r.status} ${r.json.result?.direction}`, r.status === 200 && r.json.result?.direction === (dirBefore === "OUT" ? "IN" : "OUT"));

      // (d) the roll call is not subject to the gate cooldown
      const gate6 = await post({ descriptor: enrolled(6, 1), camera_id: 4, purpose: "entry_exit" });
      const roll6 = await post({ descriptor: enrolled(6, 1), camera_id: 4, purpose: "attendance" });
      record("Cooldown: roll call unaffected", "student 6 gate scan, then a roll-call scan right away", "gate 200, roll call 200 present",
        `${gate6.status} then ${roll6.status} ${roll6.json.result?.status}`,
        gate6.status === 200 && roll6.status === 200 && roll6.json.result?.status === "present");
    } else {
      // (e) 0 disables the cooldown: the same student can be scanned twice in a row
      const a = await post({ descriptor: enrolled(5, 1), camera_id: 4, purpose: "entry_exit" });
      const b = await post({ descriptor: enrolled(5, 1), camera_id: 4, purpose: "entry_exit" });
      record("Cooldown disabled (0)", "student 5 gate scan twice in a row", "both 200, direction flips",
        `${a.status} ${a.json.result?.direction}, then ${b.status} ${b.json.result?.direction}`,
        a.status === 200 && b.status === 200 && a.json.result?.direction === "OUT" && b.json.result?.direction === "IN");
    }

    // --- margin rule: a look-alike enrolled as another student ---
    // Student 5 gets three extra samples 0.04 away from student 4's sample #2.
    // Scanning that exact sample is distance 0 from student 4 but only 0.04
    // short of student 5, below the 0.06 margin, so it must go to the warden.
    const sample = enrolled(4, 2);
    const look = await fetch(`${BASE}/api/faces/enrol`, {
      method: "POST",
      headers: await authHeaders("admin"),
      body: JSON.stringify({ student_id: 5, descriptors: [11, 12, 13].map((k) => descriptorAtDistance(sample, 0.04, k)) }),
    });
    const lookJson = await look.json();
    lookalikeIds = (lookJson.profiles ?? []).map((p: { faceProfileId: number }) => p.faceProfileId);
    const attBefore = await scalar("SELECT count(*) FROM attendance WHERE session_id=$1", [sessionId]);
    r = await post({ descriptor: sample, camera_id: 4, purpose: "attendance" });
    record("Margin rule", "student 4 sample #2 with a look-alike of student 5 0.04 away", "low_confidence (not auto-matched), nothing marked",
      `${r.status} ${r.json.outcome} dist=${d3(r.json.distance)} margin=${d3(r.json.margin)}; new attendance rows=${(await scalar("SELECT count(*) FROM attendance WHERE session_id=$1", [sessionId])) - attBefore}`,
      look.status === 201 && r.status === 200 && r.json.outcome === "low_confidence" && r.json.margin < 0.06 &&
        (await scalar("SELECT count(*) FROM attendance WHERE session_id=$1", [sessionId])) === attBefore);
    await removeLookalikes();

    // --- request validation and access ---
    r = await post({ descriptor: exact4, camera_id: 3, purpose: "attendance" });
    record("Inactive camera", "camera 3 (status inactive)", "409", `${r.status} ${r.json.error}`, r.status === 409);
    r = await post({ descriptor: [1, 2, 3], camera_id: 4, purpose: "attendance" });
    record("Bad descriptor", "3 numbers instead of 128", "400", `${r.status} ${r.json.error}`, r.status === 400);
    r = await post({ descriptor: exact4, camera_id: 4, purpose: "lunch" });
    record("Bad purpose", "purpose='lunch'", "400", `${r.status}`, r.status === 400);
    r = await post({ descriptor: exact4, camera_id: 4, purpose: "attendance" }, "student");
    record("Wrong role", "role student", "403", `${r.status}`, r.status === 403);
    r = await post({ descriptor: exact4, camera_id: 4, purpose: "attendance" }, null);
    record("Not signed in", "no session cookie", "401", `${r.status}`, r.status === 401);
  } finally {
    await removeLookalikes();
    // remove everything this run created
    await pool.query("DELETE FROM violations WHERE violation_id > $1", [maxViolation]);
    await pool.query("DELETE FROM attendance WHERE session_id = $1", [sessionId]);
    await pool.query("DELETE FROM entry_exit_log WHERE log_id > $1", [maxLog]);
    await pool.query("DELETE FROM face_events WHERE event_id > $1", [maxEvent]);
    await pool.query("DELETE FROM attendance_sessions WHERE session_id = $1", [sessionId]);
  }

  console.log("| Case | Input | Expected | Actual | Result |\n|---|---|---|---|---|");
  console.log(rows.join("\n"));
  console.log(`\n${rows.length - failures}/${rows.length} passed`);
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test-matching crashed:", e instanceof Error ? e.message : e);
  process.exit(2);
});
