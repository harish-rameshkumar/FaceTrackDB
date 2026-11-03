// Tests for the demo data path: demo:seed, demo:reset, determinism, and what happens when REAL activity is
// mixed with the generated history. It runs the real commands as child processes against a SCRATCH database.
//   export DATABASE_URL=.../<scratch_db> QDRANT_URL=... QDRANT_COLLECTION=face_embeddings_test
//   npm run build && npx next start -p 3200         (same environment; used for the page checks)
//   BASE_URL=http://localhost:3200 npm run test:demo
// SAFETY: refuses unless the database name contains "test"/"scratch" and the collection ends in "_test".
// It cleans up after itself: the database ends with exactly the rows it started with.
import bcrypt from "bcryptjs";
import { spawnSync } from "node:child_process";
import { getPool } from "../lib/db";
import { deleteProfile, enrolEmbeddings } from "../lib/faces";
import { checkCollection, COLLECTION, createCollection, getQdrant } from "../lib/qdrant";
import { processScan } from "../lib/scan";
import { DEMO_PASSWORD, LIVE_STUDENT } from "./lib/demo-data";
import { assertTestEnvironment, randomEmbedding } from "./synthetic";

assertTestEnvironment(COLLECTION);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const pool = getPool();
const rows: string[] = [];
let failures = 0;
const record = (name: string, expected: string, actual: string, pass: boolean) => {
  if (!pass) failures++;
  rows.push(`| ${name} | ${expected} | ${actual.replace(/\|/g, "/").slice(0, 300)} | ${pass ? "PASS" : "FAIL"} |`);
};
const n = async (sql: string, p: unknown[] = []) => Number((await pool.query(sql, p)).rows[0].n);

function run(script: string, args: string[]): { code: number; out: string } {
  const r = spawnSync("npx", ["tsx", "--env-file=.env.local", `scripts/${script}.ts`, ...args], { encoding: "utf8", env: process.env, cwd: process.cwd() });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const TABLES: [string, string][] = [
  ["users", "users"], ["students", "students"], ["parents", "parents"], ["student_parent", "student_parent"], ["face_profiles", "face_profiles"],
  ["attendance_sessions", "roll calls"], ["attendance", "attendance"], ["entry_exit_log", "gate log"], ["face_events", "face events"],
  ["leave_requests", "leave"], ["violations", "violations"], ["hostels", "hostels"], ["gates", "gates"], ["cameras", "cameras"],
];
async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [t] of TABLES) out[t] = await n(`SELECT count(*) AS n FROM ${t}`);
  out.qdrant = (await getQdrant().getCollection(COLLECTION)).points_count ?? 0;
  return out;
}
const diff = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]}->${b[k]}`).join(", ") || "none";

// everything about a seeded dataset that depends on the seed, as one hash (ids and clock times excluded)
async function fingerprint(): Promise<string> {
  const { rows: r } = await pool.query(
    `SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
       SELECT s.roll_no || ':' ||
         (SELECT count(*) FROM attendance a WHERE a.student_id = s.student_id AND a.status = 'present') || '/' ||
         (SELECT count(*) FROM attendance a WHERE a.student_id = s.student_id AND a.status = 'absent') || '/' ||
         (SELECT count(*) FROM violations v WHERE v.student_id = s.student_id) || '/' ||
         (SELECT count(*) FROM leave_requests l WHERE l.student_id = s.student_id) || '/' ||
         COALESCE((SELECT string_agg(to_char(l.event_time, 'YYYY-MM-DD HH24:MI:SS') || l.direction, ',' ORDER BY l.event_time) FROM entry_exit_log l WHERE l.student_id = s.student_id), '') AS x
       FROM students s) t`,
  );
  return r[0].h;
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` }, body: JSON.stringify({ email, password }) });
  const c = res.headers.get("set-cookie");
  if (!res.ok || !c) throw new Error(`login failed for ${email}: ${res.status}`);
  return c.split(";")[0];
}
const get = async (path: string, cookie: string) => { const r = await fetch(`${BASE}${path}`, { headers: { cookie } }); return { status: r.status, text: await r.text() }; };
const post = async (path: string, cookie: string, body: unknown) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const RAW = /FT0\d\d|SQLSTATE|syntax error|stack trace|at \w+ \(|This page couldn.t load/;

async function main() {
  if ((await checkCollection()).state === "missing") await createCollection();

  // ---------- a REAL enrolment that must survive everything below ----------
  const realProfiles = await enrolEmbeddings(1, [randomEmbedding(880001)]);
  const S0 = await snapshot();
  const realSample = (await pool.query("SELECT md5(string_agg(student_id::text || roll_no || name, ',' ORDER BY student_id)) AS h FROM students")).rows[0].h;

  try {
    // ---------- refusals before seeding ----------
    const dry = run("demo-seed", []);
    record("demo:seed without --yes only prints the target", "exit 1, names the database, changes nothing", `exit ${dry.code}; mentions database: ${/target database: \w+/.test(dry.out)}; changes: ${diff(S0, await snapshot())}`, dry.code === 1 && /target database: \w+/.test(dry.out) && diff(S0, await snapshot()) === "none");
    const wrongDb = run("demo-seed", ["--yes", "--db", "not_this_one"]);
    record("--db with another name is refused", "exit 1 with REFUSING", `exit ${wrongDb.code} ${/REFUSING/.test(wrongDb.out)}`, wrongDb.code === 1 && /REFUSING/.test(wrongDb.out));

    // ---------- seed ----------
    const seed1 = run("demo-seed", ["--yes", "--seed", "7", "--days", "30"]);
    record("demo:seed --yes --seed 7 --days 30 succeeds", "exit 0 and a summary", `exit ${seed1.code}; ${(/Seeded \d+ demo students[^\n]*/.exec(seed1.out) ?? ["no summary"])[0]}`, seed1.code === 0 && /Seeded 14 demo students and 13 parent logins in 3 hostels/.test(seed1.out));
    const demoStudents = (await pool.query("SELECT row_id FROM b_demo_rows WHERE kind = 'student'")).rows.map((r) => r.row_id as number);
    record("14 demo students in at least 3 hostels, each with a linked parent login", "14 students, >= 3 hostels, every student has a parent whose user role is 'parent'",
      `${demoStudents.length} students, ${await n("SELECT count(DISTINCT hostel_id) AS n FROM students WHERE student_id = ANY($1::int[])", [demoStudents])} hostels, with parent: ${await n("SELECT count(*) AS n FROM students s WHERE s.student_id = ANY($1::int[]) AND EXISTS (SELECT 1 FROM student_parent sp JOIN parents p USING (parent_id) JOIN users u ON u.user_id = p.user_id WHERE sp.student_id = s.student_id AND u.role = 'parent')", [demoStudents])}`,
      demoStudents.length === 14 && (await n("SELECT count(DISTINCT hostel_id) AS n FROM students WHERE student_id = ANY($1::int[])", [demoStudents])) >= 3 &&
        (await n("SELECT count(*) AS n FROM students s WHERE s.student_id = ANY($1::int[]) AND EXISTS (SELECT 1 FROM student_parent sp JOIN parents p USING (parent_id) JOIN users u ON u.user_id = p.user_id WHERE sp.student_id = s.student_id AND u.role = 'parent')", [demoStudents])) === 14);
    const logins = (await pool.query("SELECT u.email, u.password_hash FROM users u WHERE u.user_id IN (SELECT user_id FROM students WHERE student_id = ANY($1::int[]) UNION SELECT p.user_id FROM parents p JOIN student_parent sp USING (parent_id) WHERE sp.student_id = ANY($1::int[]))", [demoStudents])).rows;
    const pwOk = await Promise.all(logins.map((l) => bcrypt.compare(DEMO_PASSWORD, l.password_hash)));
    record("Every demo login ends in @facetrack.test and has the shared demo password", "27 logins (14 + 13), all @facetrack.test, bcrypt hash of FaceTrack@123",
      `${logins.length} logins, domain ok ${logins.every((l) => l.email.endsWith("@facetrack.test"))}, password ok ${pwOk.every(Boolean)}`, logins.length === 27 && logins.every((l) => l.email.endsWith("@facetrack.test")) && pwOk.every(Boolean));
    record("No duplicate logins", "emails unique ignoring case", `${await n("SELECT count(*) - count(DISTINCT lower(email)) AS n FROM users")} duplicates`, (await n("SELECT count(*) - count(DISTINCT lower(email)) AS n FROM users")) === 0);

    // no face data for the demo students, in PostgreSQL or Qdrant
    const profilesForDemo = await n("SELECT count(*) AS n FROM face_profiles WHERE student_id = ANY($1::int[])", [demoStudents]);
    const pointsForDemo = (await getQdrant().count(COLLECTION, { exact: true, filter: { should: demoStudents.map((id) => ({ key: "student_id", match: { value: id } })) } })).count;
    record("Demo students have NO face data", "0 face_profiles rows and 0 Qdrant points for them", `${profilesForDemo} rows, ${pointsForDemo} points`, profilesForDemo === 0 && pointsForDemo === 0);
    const S1 = await snapshot();
    record("Qdrant and the real face_profiles are untouched by seeding", "qdrant and face_profiles counts equal the starting counts", `qdrant ${S0.qdrant}->${S1.qdrant}, face_profiles ${S0.face_profiles}->${S1.face_profiles}`, S0.qdrant === S1.qdrant && S0.face_profiles === S1.face_profiles);

    // the generated history
    const ids = demoStudents;
    const kinds = {
      leaveStates: (await pool.query("SELECT DISTINCT status FROM leave_requests WHERE leave_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'leave') ORDER BY 1")).rows.map((r) => r.status).join(","),
      resolved: await n("SELECT count(*) AS n FROM violations WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND student_id = ANY($1::int[])", [ids]),
      open: await n("SELECT count(*) AS n FROM violations WHERE status = 'open' AND student_id = ANY($1::int[])", [ids]),
      types: (await pool.query("SELECT DISTINCT type FROM violations WHERE student_id = ANY($1::int[]) ORDER BY 1", [ids])).rows.map((r) => r.type).join(","),
      unreviewed: await n("SELECT count(*) AS n FROM face_events WHERE outcome = 'low_confidence' AND reviewed_by IS NULL AND event_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'face_event')"),
      withHistory: await n("SELECT count(*) AS n FROM students s WHERE s.student_id = ANY($1::int[]) AND EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.student_id) AND EXISTS (SELECT 1 FROM entry_exit_log l WHERE l.student_id = s.student_id)", [ids]),
      untracked: await n("SELECT count(*) AS n FROM face_events WHERE event_id > 13 AND event_id NOT IN (SELECT row_id FROM b_demo_rows WHERE kind = 'face_event')"),
    };
    record("Generated history has leave in the states the app can hold", "pending, approved and rejected (a cancelled request leaves no row: the app deletes it)", kinds.leaveStates, kinds.leaveStates === "approved,pending,rejected");
    record("Violations: all three types, some open, some resolved with resolved_at and resolved_by", "3 types, > 0 open, > 0 resolved", `types ${kinds.types}; open ${kinds.open}; resolved ${kinds.resolved}`, kinds.types === "late_return,missed_attendance,no_leave" && kinds.open > 0 && kinds.resolved > 0);
    record("Every demo student has roll-call and gate history", "14 of 14", `${kinds.withHistory} of 14`, kinds.withHistory === 14);
    record("Some low-confidence scans wait in the warden's review queue (generated, database-only)", "> 0", String(kinds.unreviewed), kinds.unreviewed > 0);
    record("Every generated face event is recorded as generated", "0 face events outside b_demo_rows (apart from the 13 sample scans and the real ones)", String(kinds.untracked), kinds.untracked === 0);
    const label = (await pool.query("SELECT value FROM b_meta WHERE key = 'generated_history'")).rows[0]?.value;
    record("The history is labelled in b_meta", "key generated_history with seed 7 and 30 days", label ?? "missing", !!label && JSON.parse(label).seed === 7 && JSON.parse(label).days === 30);

    // ---------- reports: non-empty and varied ----------
    const from = JSON.parse(label).from as string;
    const R = (fn: string) => pool.query(`SELECT * FROM ${fn}($1::date, current_date, NULL)`, [from]).then((r) => r.rows);
    const distinct = (rs: Record<string, unknown>[], k: string) => new Set(rs.map((x) => String(x[k]))).size;
    const checks: [string, () => Promise<[boolean, string]>][] = [
      ["attendance_by_hostel_month", async () => { const r = await R("report_attendance_by_hostel_month"); return [r.length >= 4 && distinct(r, "attendance_pct") >= 3 && distinct(r, "hostel") >= 3, `${r.length} rows, ${distinct(r, "hostel")} hostels, ${distinct(r, "attendance_pct")} distinct %`]; }],
      ["violations_by_type_hostel", async () => { const r = await R("report_violations_by_type_hostel"); return [r.length >= 6 && distinct(r, "violations") >= 3 && distinct(r, "type") === 3, `${r.length} rows, ${distinct(r, "type")} types`]; }],
      ["cumulative_violations", async () => { const r = await R("report_cumulative_violations"); return [r.length >= 15 && distinct(r, "cumulative") >= 8, `${r.length} points, ${distinct(r, "cumulative")} distinct totals`]; }],
      ["late_return_rank", async () => { const r = await R("report_late_return_rank"); return [r.length >= 3 && distinct(r, "late_returns") >= 2, `${r.length} students, ${distinct(r, "late_returns")} distinct counts`]; }],
      ["gate_traffic_by_hour", async () => { const r = (await R("report_gate_traffic_by_hour")).filter((x) => Number(x.crossings) > 0); return [r.length >= 12 && distinct(r, "hour") >= 6, `${r.length} non-empty hour/direction bars over ${distinct(r, "hour")} hours`]; }],
      ["time_outside", async () => { const r = await R("report_time_outside"); return [r.length >= 8 && distinct(r, "avg_hours") >= 5 && distinct(r, "weekday") >= 5, `${r.length} bars, ${distinct(r, "avg_hours")} distinct averages`]; }],
      ["leave_summary", async () => { const r = await R("report_leave_summary"); return [r.length >= 3 && distinct(r, "status") >= 3, `${r.length} rows, statuses ${[...new Set(r.map((x) => x.status))].join("/")}`]; }],
      ["recognition_outcomes", async () => { const r = await R("report_recognition_outcomes"); return [r.length >= 3 && distinct(r, "avg_similarity") >= 3 && r.some((x) => Number(x.low_confidence) > 0) && r.some((x) => Number(x.no_match) > 0), `${r.length} weeks, ${distinct(r, "avg_similarity")} distinct averages`]; }],
      ["similarity_distribution", async () => { const r = (await R("report_similarity_distribution")).filter((x) => Number(x.scans) > 0); return [distinct(r, "band_no") >= 4 && distinct(r, "outcome") >= 2, `${r.length} non-empty bars in ${distinct(r, "band_no")} bands`]; }],
      ["low_attendance_students", async () => { const r = await R("report_low_attendance_students"); return [r.length >= 1 && distinct(r, "attendance_pct") >= 1, `${r.length} students below 75%`]; }],
      ["top_words", async () => { const r = await R("report_top_words"); return [r.length >= 8 && distinct(r, "occurrences") >= 3 && distinct(r, "source") === 2, `${r.length} words, ${distinct(r, "occurrences")} distinct counts`]; }],
    ];
    for (const [name, fn] of checks) { const [ok, detail] = await fn(); record(`Report ${name} is non-empty and varied`, "more than one row and more than one distinct value", detail, ok); }

    // ---------- the live demo: REAL activity next to the generated history ----------
    const admin = await login("admin1@facetrack.test", DEMO_PASSWORD);
    const warden = await login("warden1@facetrack.test", DEMO_PASSWORD);
    const reg = await post("/api/admin/students", admin, {
      name: "Live Test Student", roll_no: LIVE_STUDENT.srn, hostel_id: 1, room_no: "A-120", email: LIVE_STUDENT.email, password: "Live-Temp-Pw-1",
      parents: [{ name: LIVE_STUDENT.parentName, phone: LIVE_STUDENT.parentPhone, email: LIVE_STUDENT.parentEmail, relation: "father", password: "Live-Parent-Pw-1" }], consent: true,
    });
    const liveId: number = reg.json.student_id;
    record("The suggested live-demo student registers without a collision", "201 (SRN, emails and room are free after seeding)", `${reg.status} ${JSON.stringify(reg.json).slice(0, 80)}`, reg.status === 201 && !!liveId);
    await enrolEmbeddings(liveId, [randomEmbedding(990001)]); // stands in for enrolling a face at /enrol
    const emb = randomEmbedding(990001);
    const cam = (await pool.query("SELECT c.camera_id FROM cameras c JOIN gates g USING (gate_id) WHERE g.hostel_id = 1 AND c.status = 'active' ORDER BY 1 LIMIT 1")).rows[0].camera_id as number;
    const t = new Date(Date.now() + 5.5 * 3600_000); // IST wall clock, to build a roll-call window around "now"
    const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const startAt = new Date(t.getTime() - 20 * 60_000), endAt = new Date(t.getTime() + 25 * 60_000);
    const sameDay = startAt.getUTCDate() === endAt.getUTCDate() && startAt.getUTCDate() === t.getUTCDate();
    const session = sameDay ? await post("/api/sessions", warden, { hostel_id: 1, date: t.toISOString().slice(0, 10), start: hhmm(startAt), end: hhmm(endAt) }) : { status: 0, json: {} };
    if (sameDay) {
      const before = await snapshot();
      const att = await processScan({ embeddings: [emb, emb, emb], cameraId: cam, purpose: "attendance" });
      const gate = await processScan({ embeddings: [emb, emb, emb], cameraId: cam, purpose: "entry_exit" });
      const stranger = await processScan({ embeddings: [randomEmbedding(1), randomEmbedding(2), randomEmbedding(3)], cameraId: cam, purpose: "entry_exit" });
      record("A gate scan of the live student creates a REAL attendance record and gate log", "roll call created (201); scan matched, marked present; gate OUT recorded",
        `session ${session.status}; roll call ${att.status} ${att.body.outcome} ${(att.body.result as { status?: string })?.status}; gate ${gate.status} ${gate.body.outcome} ${(gate.body.result as { direction?: string })?.direction}`,
        session.status === 201 && att.body.outcome === "matched" && (att.body.result as { status?: string })?.status === "present" && gate.body.outcome === "matched" && (gate.body.result as { direction?: string })?.direction === "OUT");
      record("A stranger (nobody enrolled looks like them) gets no match, and no demo student is ever matched", "outcome no_match, no student", `${stranger.body.outcome}, student ${JSON.stringify(stranger.body.student)}`, stranger.body.outcome === "no_match" && stranger.body.student === null);
      const after = await snapshot();
      const realRowsNotGenerated = await n("SELECT count(*) AS n FROM attendance a WHERE a.student_id = $1 AND a.session_id NOT IN (SELECT row_id FROM b_demo_rows WHERE kind = 'session')", [liveId]);
      record("The live rows are real, not generated", "live attendance is in a roll call that is not tracked; new scans are not tracked", `${realRowsNotGenerated} real attendance row; tracked face events for the live student: ${await n("SELECT count(*) AS n FROM b_demo_rows WHERE kind = 'face_event' AND row_id IN (SELECT event_id FROM face_events WHERE student_id = $1)", [liveId])}`,
        realRowsNotGenerated === 1 && (await n("SELECT count(*) AS n FROM b_demo_rows WHERE kind = 'face_event' AND row_id IN (SELECT event_id FROM face_events WHERE student_id = $1)", [liveId])) === 0);
      void before; void after;
    } else {
      record("Live roll call", "needs a window that does not cross midnight", "skipped: run the test away from midnight", false);
    }

    // a real leave request from the live student, then every page that should show the new student
    const live = await login(LIVE_STUDENT.email, "Live-Temp-Pw-1");
    const lv = await post("/api/leave", live, { startDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), endDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), reason: "Cousin's wedding demo" });
    const dash = await get("/warden", warden);
    const search = await get("/warden/search?q=wedding", warden);
    const sessions = await get("/warden/sessions", warden);
    const reports = await get("/reports", warden);
    const present = await get("/reports/present", warden);
    const review = await get("/warden/review", warden);
    const admStudents = await get("/admin/students?q=Live", admin);
    record("The live student appears on the dashboard, in search, on the roll-call page and in the student list", "name on /warden; leave reason found by /warden/search (generated hits too); today's roll call listed; student in /admin/students",
      `dashboard ${dash.text.includes("Live Test Student")}; search ${search.text.includes("Live Test Student")} (+${(search.text.match(/Leave request/g) ?? []).length} leave hits); roll calls ${sessions.text.includes("Aryabhatta")}; students ${admStudents.text.includes("24CS901")}; leave ${lv.status}`,
      dash.text.includes("Live Test Student") && search.text.includes("Live Test Student") && (search.text.match(/Leave request/g) ?? []).length >= 2 && admStudents.text.includes("24CS901") && lv.status === 201);
    record("Pages with real and generated data mixed show no raw errors and carry the generated-history note", "HTTP 200, no SQL/FT text, note present on /reports and /reports/present",
      `${[dash, search, sessions, reports, present, review, admStudents].map((p) => p.status).join(",")}; raw errors ${[dash, search, sessions, reports, present, review].some((p) => RAW.test(p.text))}; note ${reports.text.includes("Includes generated demo history")}/${present.text.includes("Includes generated demo history")}`,
      [dash, search, sessions, reports, present, review, admStudents].every((p) => p.status === 200) && ![dash, search, sessions, reports, present, review].some((p) => RAW.test(p.text)) && reports.text.includes("Includes generated demo history") && present.text.includes("Includes generated demo history"));
    // the review queue holds generated, database-only scans: confirming one must work and must not touch face data
    const queue = (await pool.query("SELECT event_id FROM face_events WHERE outcome = 'low_confidence' AND reviewed_by IS NULL AND event_id IN (SELECT row_id FROM b_demo_rows WHERE kind = 'face_event') ORDER BY event_id LIMIT 2")).rows.map((r) => r.event_id as number);
    const rejected = await post(`/api/review/${queue[0]}`, warden, { action: "reject" });
    const confirmed = await post(`/api/review/${queue[1]}`, warden, { action: "confirm" });
    record("Reviewing generated low-confidence scans works (confirm and reject)", "reject -> 200 no_match; confirm -> 200 matched", `${rejected.status} ${rejected.json.outcome}; ${confirmed.status} ${confirmed.json.outcome}`,
      rejected.status === 200 && rejected.json.outcome === "no_match" && confirmed.status === 200 && confirmed.json.outcome === "matched");
    const mixed = await pool.query("SELECT count(*)::int AS marks FROM attendance a JOIN attendance_sessions s USING (session_id) WHERE s.session_date = current_date AND a.student_id = $1", [liveId]);
    record("The real mark shows up in the reports next to the generated ones (this month's marks include today's)", "the monthly attendance report counts today's real mark", `real marks today: ${mixed.rows[0].marks}`, mixed.rows[0].marks === 1 && (await pool.query("SELECT sum(marks)::int AS m FROM report_attendance_by_hostel_month(date_trunc('month', current_date)::date, current_date, 1)")).rows[0].m > mixed.rows[0].marks);

    // ---------- seeding again is refused; --reset replaces; determinism ----------
    const SNAP = await snapshot();
    const again = run("demo-seed", ["--yes", "--seed", "7", "--days", "30"]);
    record("Seeding twice without --reset is refused and changes nothing", "exit 1, REFUSING, counts unchanged", `exit ${again.code}; ${/REFUSING/.test(again.out)}; changes ${diff(SNAP, await snapshot())}`, again.code === 1 && /REFUSING/.test(again.out) && diff(SNAP, await snapshot()) === "none");

    // reset now: demo rows go, the REAL student and everything real stay
    const liveRows = {
      users: 2, students: 1, parents: 1, student_parent: 1, face_profiles: 1, attendance_sessions: sameDay ? 1 : 0, attendance: sameDay ? 1 : 0, entry_exit_log: sameDay ? 1 : 0,
      face_events: sameDay ? 3 : 0, leave_requests: 1,
      violations: await n("SELECT count(*) AS n FROM violations WHERE student_id = $1", [liveId]),
    };
    const reset = run("demo-reset", ["--yes"]);
    const S2 = await snapshot();
    const expected = { ...S0 } as Record<string, number>;
    for (const [k, v] of Object.entries(liveRows)) expected[k] = (expected[k] ?? 0) + v;
    expected.qdrant = S0.qdrant + 1;
    expected.hostels = S0.hostels; expected.gates = S0.gates; expected.cameras = S0.cameras;
    record("demo:reset removes only demo rows: counts = starting counts + the real live rows", "every table equals start + real additions; the added hostel, gate and camera are gone", `exit ${reset.code}; differences from the expectation: ${diff(expected, S2)}`, reset.code === 0 && diff(expected, S2) === "none");
    record("Real face profiles and Qdrant points are unchanged by the reset", "face_profiles and points equal what they were just before", `face_profiles ${SNAP.face_profiles}->${S2.face_profiles}, points ${SNAP.qdrant}->${S2.qdrant}; output says unchanged: ${/unchanged, as it must be/.test(reset.out)}`, SNAP.face_profiles === S2.face_profiles && SNAP.qdrant === S2.qdrant && /unchanged, as it must be/.test(reset.out));
    record("The real student and their login survive the reset", "student, user and leave still there; sample data intact", `student ${await n("SELECT count(*) AS n FROM students WHERE student_id = $1", [liveId])}; sample students hash same: ${realSample === (await pool.query("SELECT md5(string_agg(student_id::text || roll_no || name, ',' ORDER BY student_id)) AS h FROM students WHERE student_id <= 6")).rows[0].h}`,
      (await n("SELECT count(*) AS n FROM students WHERE student_id = $1", [liveId])) === 1 && realSample === (await pool.query("SELECT md5(string_agg(student_id::text || roll_no || name, ',' ORDER BY student_id)) AS h FROM students WHERE student_id <= 6")).rows[0].h);
    const reset2 = run("demo-reset", ["--yes"]);
    record("A second reset is harmless", "exit 0, says there is nothing to do", `exit ${reset2.code} ${/Nothing to do/.test(reset2.out)}`, reset2.code === 0 && /Nothing to do/.test(reset2.out));

    // determinism: same seed -> same data; another seed -> different data; --reset replaces cleanly with no duplicate logins
    const s2 = run("demo-seed", ["--yes", "--seed", "7", "--days", "30"]);
    const fA = await fingerprint();
    const usersAfterSeed = await n("SELECT count(*) AS n FROM users");
    const s3 = run("demo-seed", ["--yes", "--seed", "7", "--days", "30", "--reset"]);
    const fB = await fingerprint();
    const usersAfterReseed = await n("SELECT count(*) AS n FROM users");
    const s4 = run("demo-seed", ["--yes", "--seed", "8", "--days", "30", "--reset"]);
    const fC = await fingerprint();
    record("The same --seed gives the same data (also after --reset); another seed gives different data", "fingerprint(seed 7) = fingerprint(seed 7 again) <> fingerprint(seed 8)", `${fA.slice(0, 8)} / ${fB.slice(0, 8)} / ${fC.slice(0, 8)}; exits ${s2.code},${s3.code},${s4.code}`, s2.code === 0 && s3.code === 0 && s4.code === 0 && fA === fB && fA !== fC);
    record("After the live demo the seeder suggests the next free SRN instead of refusing", "seed exits 0 and names SRN 24CS902 (24CS901 is the real live student now)", `${(/SRN (\w+)/.exec(s2.out.split("LIVE demo")[1] ?? "") ?? ["", "none"])[1]}`, /SRN 24CS902/.test(s2.out));
    record("--reset leaves no duplicate logins", "user count after seed --reset equals the count after a plain seed; no duplicate emails", `${usersAfterSeed} -> ${usersAfterReseed}; duplicates ${await n("SELECT count(*) - count(DISTINCT lower(email)) AS n FROM users")}`, usersAfterSeed === usersAfterReseed && (await n("SELECT count(*) - count(DISTINCT lower(email)) AS n FROM users")) === 0);
  } finally {
    // clean up: whatever is left of demo data and of the live test student, back to the starting counts
    run("demo-reset", ["--yes"]);
    const live = (await pool.query("SELECT student_id FROM students WHERE roll_no = $1", [LIVE_STUDENT.srn])).rows[0]?.student_id;
    if (live) {
      for (const p of (await pool.query("SELECT profile_id FROM face_profiles WHERE student_id = $1", [live])).rows) await deleteProfile(p.profile_id);
      await pool.query("DELETE FROM violations WHERE student_id = $1", [live]);
      await pool.query("DELETE FROM attendance WHERE student_id = $1", [live]);
      await pool.query("DELETE FROM entry_exit_log WHERE student_id = $1", [live]);
      await pool.query("DELETE FROM face_events WHERE student_id = $1", [live]);
      await pool.query("DELETE FROM leave_requests WHERE student_id = $1", [live]);
      await pool.query("DELETE FROM attendance_sessions WHERE session_date = current_date AND session_id > 4 AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = attendance_sessions.session_id)");
      await pool.query("SELECT delete_student($1)", [live]);
    }
    await pool.query("DELETE FROM face_events WHERE student_id IS NULL AND event_id > 13");
    for (const p of realProfiles) await deleteProfile(p.faceProfileId);
  }
  const S3 = await snapshot();
  record("The database ends with exactly the rows it started with", "every table equals the starting counts", diff({ ...S0, face_profiles: S0.face_profiles - realProfiles.length, qdrant: S0.qdrant - realProfiles.length }, S3), diff({ ...S0, face_profiles: S0.face_profiles - realProfiles.length, qdrant: S0.qdrant - realProfiles.length }, S3) === "none");

  console.log("| Case | Expected | Actual | Result |\n|---|---|---|---|");
  console.log(rows.join("\n"));
  console.log(`\n${rows.length - failures}/${rows.length} passed`);
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test-demo crashed:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
