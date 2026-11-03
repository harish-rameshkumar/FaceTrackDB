// Tests for admin registration, deletion, roll-call sessions and password change,
// through the real HTTP API. Needs a running server (BASE_URL, default
// http://localhost:3000) and a SCRATCH database (it creates and removes students
// and roll calls; it refuses to run against a database whose name has no "test" or "scratch").
//   DATABASE_URL=.../facetrack_scratch BASE_URL=http://localhost:3000 npm run test:register
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../lib/db";
import { enrolEmbeddings, listSamples } from "../lib/faces";
import { COLLECTION, getQdrant } from "../lib/qdrant";
import { assertTestEnvironment, randomEmbedding } from "./synthetic";

assertTestEnvironment(COLLECTION, { requireTestCollection: false });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const pool = getPool();
const rows: string[] = [];
let failures = 0;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function record(name: string, expected: string, actual: string, pass: boolean) {
  if (!pass) failures++;
  rows.push(`| ${name} | ${expected} | ${actual.replace(/\|/g, "/")} | ${pass ? "PASS" : "FAIL"} |`);
}

const dbDir = resolve(process.cwd(), "..", "db");
const seed = readFileSync(resolve(dbDir, "seed.sql"), "utf8");
const demo = readFileSync(resolve(dbDir, "demo_passwords.sql"), "utf8");
const DEMO_PW = process.env.TEST_PASSWORD ?? /Password for all accounts:\s+(\S+)/.exec(demo)?.[1] ?? "";
const seededEmail = (role: string) => new RegExp(`'([^']+@[^']+)'[^)\\n]*'${role}'\\)`).exec(seed)![1];

async function login(email: string, password: string): Promise<{ status: number; cookie: string | null; json: Json }> {
  const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const sc = res.headers.get("set-cookie");
  return { status: res.status, cookie: sc ? sc.split(";")[0] : null, json: await res.json().catch(() => ({})) };
}
async function api(method: string, path: string, cookie: string | null, body?: unknown): Promise<{ status: number; json: Json; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const TAG = `t${Date.now().toString(36)}`;
const mail = (n: string) => `${TAG}.${n}@reg.test`;
const parent = (n: string, rel: string, pw = `ParentPw-${n}-1`) => ({ name: `Parent ${n}`, phone: "+919800000000", email: mail(n), relation: rel, password: pw });
const student = (n: string, roll: string, parents: Json[], over: Json = {}) => ({
  name: `Test ${n}`, roll_no: roll, hostel_id: 1, room_no: "T-1", email: mail(n), password: `StudentPw-${n}-1`, parents, consent: true, ...over,
});

async function main() {
  const admin = (await login(seededEmail("admin"), DEMO_PW)).cookie!;
  const warden = (await login("warden1@facetrack.test", DEMO_PW)).cookie!;
  const seededStudent = (await login(seededEmail("student"), DEMO_PW)).cookie!;
  const createdStudents: number[] = [];
  const createdSessions: number[] = [];
  const usersBefore = Number((await pool.query("SELECT count(*) AS n FROM users")).rows[0].n);

  try {
    // ---- access ----
    for (const [who, c, want] of [["warden", warden, 403], ["student", seededStudent, 403], ["anonymous", null, 401]] as const) {
      const r = await api("POST", "/api/admin/students", c, student("x", "TX1", [parent("x", "father")]));
      const d = await api("DELETE", "/api/admin/students/1", c);
      record(`Non-admin denied (${who})`, `register ${want}, delete ${want}`, `register ${r.status}, delete ${d.status}`, r.status === want && d.status === want);
    }
    const pages = await Promise.all(["/admin/students", "/admin/students/new", "/admin/students/1/enrol"].map(async (p) => (await fetch(`${BASE}${p}`, { headers: { cookie: warden } })).text()));
    record("Admin pages deny a warden", "Access denied on all 3 pages", pages.map((t) => (t.includes("Access denied") ? "denied" : "OPEN")).join(", "), pages.every((t) => t.includes("Access denied")));

    // ---- register with two parents ----
    const body1 = student("s1", "T-S1", [parent("pa", "father"), parent("pb", "mother")]);
    const r1 = await api("POST", "/api/admin/students", admin, body1);
    const sid1: number = r1.json.student_id;
    if (sid1) createdStudents.push(sid1);
    const leaked = [body1.password, body1.parents[0].password, body1.parents[1].password].some((pw) => r1.text.includes(pw));
    record("Register student + 2 parents", "201, 3 new logins, no password in the response", `${r1.status} parents=${JSON.stringify(r1.json.parents?.map((p: Json) => p.created))} leaked=${leaked}`,
      r1.status === 201 && r1.json.parents?.length === 2 && !leaked);
    const hashes = (await pool.query("SELECT email, password_hash FROM users WHERE email LIKE $1", [`${TAG}.%`])).rows;
    record("Passwords stored as bcrypt hashes", "3 rows, all $2a$10$/$2b$10$", hashes.map((h) => h.password_hash.slice(0, 7)).join(","),
      hashes.length === 3 && hashes.every((h) => /^\$2[aby]\$10\$/.test(h.password_hash)));

    // ---- login as each, roles ----
    const ls = await login(body1.email, body1.password);
    const la = await login(body1.parents[0].email, body1.parents[0].password);
    const lb = await login(body1.parents[1].email, body1.parents[1].password);
    record("New student and both parents can log in", "role student / parent / parent, ids set",
      `${ls.json.user?.role}(${ls.json.user?.studentId}) ${la.json.user?.role}(${la.json.user?.parentId}) ${lb.json.user?.role}(${lb.json.user?.parentId})`,
      ls.json.user?.role === "student" && ls.json.user?.studentId === sid1 && la.json.user?.role === "parent" && !!la.json.user?.parentId && lb.json.user?.role === "parent" && la.json.user?.parentId !== lb.json.user?.parentId);

    // ---- a parent only sees their ward ----
    const d1 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const lv = await api("POST", "/api/leave", ls.cookie, { startDate: d1, endDate: d1, reason: "Registration test leave" });
    const seenA = await api("GET", "/api/leave", la.cookie), seenB = await api("GET", "/api/leave", lb.cookie);
    const seenSeeded = await api("GET", "/api/leave", (await login("parent.senthil@facetrack.test", DEMO_PW)).cookie);
    const ids = (j: Json) => (j.requests ?? j.leave ?? []).map((x: Json) => x.id ?? x.leave_id);
    const leaveId = lv.json.request?.id;
    record("A parent sees only their own ward's leave", "A and B see the new request; an unrelated parent does not",
      `created=${lv.status} A=${ids(seenA.json).includes(leaveId)} B=${ids(seenB.json).includes(leaveId)} other=${ids(seenSeeded.json).includes(leaveId)}`,
      lv.status === 201 && ids(seenA.json).includes(leaveId) && ids(seenB.json).includes(leaveId) && !ids(seenSeeded.json).includes(leaveId));
    const staffView = await api("GET", "/api/violations", ls.cookie);
    record("Student cannot use staff routes", "403 on /api/sessions", `${(await api("GET", "/api/sessions", ls.cookie)).status}`, (await api("GET", "/api/sessions", ls.cookie)).status === 403 && staffView.status === 200);

    // ---- duplicates and validation ----
    const dupEmail = await api("POST", "/api/admin/students", admin, student("s1", "T-S9", [parent("pz", "father")]));
    record("Duplicate email rejected", "409, error on the email field", `${dupEmail.status} ${JSON.stringify(dupEmail.json.fieldErrors)}`, dupEmail.status === 409 && !!dupEmail.json.fieldErrors?.email);
    const dupSrn = await api("POST", "/api/admin/students", admin, student("s9", "t-s1", [parent("py", "father")]));
    record("Duplicate SRN rejected (case-insensitive)", "409, error on roll_no", `${dupSrn.status} ${JSON.stringify(dupSrn.json.fieldErrors)}`, dupSrn.status === 409 && !!dupSrn.json.fieldErrors?.roll_no);
    const shortPw = await api("POST", "/api/admin/students", admin, student("s8", "T-S8", [parent("px", "father")], { password: "short" }));
    record("Short password rejected", "400 with a field error", `${shortPw.status} ${JSON.stringify(shortPw.json.fieldErrors)}`, shortPw.status === 400 && !!shortPw.json.fieldErrors?.password);
    const noConsent = await api("POST", "/api/admin/students", admin, student("s7", "T-S7", [parent("pw", "father")], { consent: false }));
    record("Consent required", "400, consent field error", `${noConsent.status} ${JSON.stringify(noConsent.json.fieldErrors)}`, noConsent.status === 400 && !!noConsent.json.fieldErrors?.consent);
    const badRel = await api("POST", "/api/admin/students", admin, student("s6", "T-S6", [parent("pv", "uncle")]));
    record("Bad relation rejected", "400", `${badRel.status}`, badRel.status === 400);

    // ---- shared parent reused ----
    const body2 = student("s2", "T-S2", [{ ...parent("pa", "guardian"), password: "IgnoredNewPw-1" }]);
    const r2 = await api("POST", "/api/admin/students", admin, body2);
    if (r2.json.student_id) createdStudents.push(r2.json.student_id);
    const parentCount = Number((await pool.query("SELECT count(*) AS n FROM users WHERE email = $1", [mail("pa")])).rows[0].n);
    const wards = Number((await pool.query("SELECT count(*) AS n FROM student_parent sp JOIN parents p USING (parent_id) JOIN users u USING (user_id) WHERE u.email = $1", [mail("pa")])).rows[0].n);
    const oldPw = await login(mail("pa"), body1.parents[0].password), newPw = await login(mail("pa"), "IgnoredNewPw-1");
    record("Shared parent is reused, not duplicated", "1 user, 2 wards, created=false, old password still works",
      `${r2.status} users=${parentCount} wards=${wards} created=${r2.json.parents?.[0]?.created} old=${oldPw.status} new=${newPw.status}`,
      r2.status === 201 && parentCount === 1 && wards === 2 && r2.json.parents?.[0]?.created === false && oldPw.status === 200 && newPw.status === 401);

    // ---- failure halfway rolls everything back ----
    const before = Number((await pool.query("SELECT count(*) AS n FROM users")).rows[0].n);
    const studentsBefore = Number((await pool.query("SELECT count(*) AS n FROM students")).rows[0].n);
    const half = await api("POST", "/api/admin/students", admin, student("s5", "T-S5", [parent("p5", "father"), { ...parent("p5b", "mother"), email: "warden1@facetrack.test" }]));
    const after = Number((await pool.query("SELECT count(*) AS n FROM users")).rows[0].n);
    const studentsAfter = Number((await pool.query("SELECT count(*) AS n FROM students")).rows[0].n);
    record("Failure halfway rolls everything back", "409; no new users or students (no orphans)", `${half.status} users ${before}->${after}, students ${studentsBefore}->${studentsAfter}; body=${half.text.slice(0, 90)}`,
      half.status === 409 && before === after && studentsBefore === studentsAfter && !/warden1|SQL|FT0/.test(half.text));

    // ---- delete rules ----
    const delSeed = await api("DELETE", "/api/admin/students/1", admin);
    record("Delete refused when history exists (seeded student)", "409 has_history, student still there", `${delSeed.status} ${delSeed.json.code}`, delSeed.status === 409 && delSeed.json.code === "has_history" &&
      Number((await pool.query("SELECT count(*) AS n FROM students WHERE student_id = 1")).rows[0].n) === 1);
    const delLeave = await api("DELETE", `/api/admin/students/${sid1}`, admin);
    record("Delete refused when only a leave request exists", "409", `${delLeave.status} ${delLeave.json.error?.slice(0, 80)}`, delLeave.status === 409);

    const body4 = student("s4", "T-S4", [parent("pc", "father")]);
    const r4 = await api("POST", "/api/admin/students", admin, body4);
    const sid4: number = r4.json.student_id;
    if (sid4) createdStudents.push(sid4);
    const prof = await enrolEmbeddings(sid4, [randomEmbedding(777001), randomEmbedding(777002)]);
    const pts = async () => (await getQdrant().retrieve(COLLECTION, { ids: prof.map((p) => p.qdrantPointId) })).length;
    const ptsBefore = await pts();
    const del4 = await api("DELETE", `/api/admin/students/${sid4}`, admin);
    const gone = Number((await pool.query("SELECT count(*) AS n FROM users WHERE email IN ($1, $2)", [mail("s4"), mail("pc")])).rows[0].n);
    record("Delete allowed without history; removes faces, logins", "200; student, own login, parent login and Qdrant points gone",
      `${del4.status} points ${ptsBefore}->${await pts()} users left=${gone} profiles=${Number((await pool.query("SELECT count(*) AS n FROM face_profiles WHERE student_id = $1", [sid4])).rows[0].n)}`,
      del4.status === 200 && ptsBefore === 2 && (await pts()) === 0 && gone === 0);
    const del2 = await api("DELETE", `/api/admin/students/${r2.json.student_id}`, admin);
    const paStill = Number((await pool.query("SELECT count(*) AS n FROM users WHERE email = $1", [mail("pa")])).rows[0].n);
    record("Shared parent kept while another ward remains", "200, parent login still exists", `${del2.status} parent users=${paStill}`, del2.status === 200 && paStill === 1);
    const del404 = await api("DELETE", "/api/admin/students/99999", admin);
    record("Delete unknown student", "404", `${del404.status}`, del404.status === 404);

    // ---- vector store: read, update, delete one face sample (admin only) ----
    const r7 = await api("POST", "/api/admin/students", admin, student("s7f", "T-S7F", [parent("pf", "father")]));
    const sid7: number = r7.json.student_id;
    if (sid7) createdStudents.push(sid7);
    const prof7 = await enrolEmbeddings(sid7, [randomEmbedding(780001), randomEmbedding(780002), randomEmbedding(780003)]);
    const [p1, p2, p3] = prof7.map((p) => p.faceProfileId);
    const rd = await api("GET", `/api/faces/${p1}`, admin);
    const payloadKeys = Object.keys(rd.json.sample?.payload ?? {}).sort().join(",");
    record("READ a face sample by id (admin)", "200; row + Qdrant payload {active, face_profile_id, student_id}, active=true, no vector in the response",
      `${rd.status} payload=${payloadKeys} active=${rd.json.sample?.active} vectorInBody=${/"vector"/.test(rd.text)}`,
      rd.status === 200 && payloadKeys === "active,face_profile_id,student_id" && rd.json.sample.active === true && rd.json.sample.studentId === sid7 && !/"vector"/.test(rd.text));
    const denied = [] as string[];
    for (const [who, c, want] of [["warden", warden, 403], ["student", seededStudent, 403], ["anonymous", null, 401]] as const) {
      const a = await api("GET", `/api/faces/${p1}`, c), b = await api("PATCH", `/api/faces/${p1}`, c, { active: false });
      const d = await api("DELETE", `/api/faces/${p3}`, c), l = await api("GET", `/api/admin/students/${sid7}/faces`, c);
      denied.push(`${who}:${a.status}/${b.status}/${d.status}/${l.status}`);
      if (![a.status, b.status, d.status, l.status].every((x) => x === want)) denied.push("WRONG");
    }
    record("Face sample routes are admin only", "GET, PATCH, DELETE and the list: warden 403, student 403, anonymous 401", denied.join(" "), !denied.includes("WRONG"));
    const stillThere = Number((await pool.query("SELECT count(*) AS n FROM face_profiles WHERE student_id = $1", [sid7])).rows[0].n);
    const off = await api("PATCH", `/api/faces/${p1}`, admin, { active: false });
    const qOff = (await getQdrant().retrieve(COLLECTION, { ids: [prof7[0].qdrantPointId], with_payload: true })).at(0)?.payload;
    record("UPDATE: deactivate a sample (payload)", "200; Qdrant payload active=false, student_id and face_profile_id kept; the row is still there",
      `${off.status} active=${off.json.sample?.active} payload=${JSON.stringify(qOff)} rows=${stillThere}`,
      off.status === 200 && off.json.sample.active === false && qOff?.active === false && qOff?.student_id === sid7 && qOff?.face_profile_id === p1 && stillThere === 3);
    const listed = await api("GET", `/api/admin/students/${sid7}/faces`, admin);
    record("List a student's samples shows the flag", "3 samples; only #1 inactive", `${listed.status} ${(listed.json.samples ?? []).map((x: Json) => `${x.faceProfileId}:${x.active}`).join(" ")}`,
      listed.status === 200 && listed.json.samples?.length === 3 && listed.json.samples.filter((x: Json) => !x.active).length === 1 && listed.json.samples.find((x: Json) => !x.active)?.faceProfileId === p1);
    const on = await api("PATCH", `/api/faces/${p1}`, admin, { active: true });
    record("UPDATE: reactivate the sample", "200; active=true again", `${on.status} active=${on.json.sample?.active}`, on.status === 200 && on.json.sample.active === true);
    const badBodies = await Promise.all([api("PATCH", `/api/faces/${p1}`, admin, { active: "no" }), api("PATCH", `/api/faces/${p1}`, admin, {}), api("PATCH", "/api/faces/abc", admin, { active: true }), api("PATCH", "/api/faces/99999999", admin, { active: true }), api("GET", "/api/faces/99999999", admin)]);
    record("Face sample routes validate input", "400 non-boolean, 400 missing, 400 bad id, 404 unknown (PATCH), 404 unknown (GET)", badBodies.map((x) => x.status).join(" "), badBodies.map((x) => x.status).join(" ") === "400 400 400 404 404");
    const del = await api("DELETE", `/api/faces/${p2}`, admin);
    const pointGone = (await getQdrant().retrieve(COLLECTION, { ids: [prof7[1].qdrantPointId] })).length;
    const rowGone = Number((await pool.query("SELECT count(*) AS n FROM face_profiles WHERE profile_id = $1", [p2])).rows[0].n);
    const delAgain = await api("DELETE", `/api/faces/${p2}`, admin);
    record("DELETE one sample (row and Qdrant point)", "200; row and point gone; the other two remain; a second delete is 404",
      `${del.status} row=${rowGone} point=${pointGone} left=${(await listSamples(sid7)).length} again=${delAgain.status}`,
      del.status === 200 && rowGone === 0 && pointGone === 0 && (await listSamples(sid7)).length === 2 && delAgain.status === 404);

    // ---- password change ----
    const bad = await api("POST", "/api/account/password", ls.cookie, { current: "wrong-password", next: "BrandNewPw-123" });
    const ok = await api("POST", "/api/account/password", ls.cookie, { current: body1.password, next: "BrandNewPw-123" });
    const loginOld = await login(body1.email, body1.password), loginNew = await login(body1.email, "BrandNewPw-123");
    const tooShort = await api("POST", "/api/account/password", loginNew.cookie, { current: "BrandNewPw-123", next: "abc" });
    record("Change own password", "wrong current 403; ok 200; old login 401; new login 200; short 400", `${bad.status} ${ok.status} ${loginOld.status} ${loginNew.status} ${tooShort.status}`,
      bad.status === 403 && ok.status === 200 && loginOld.status === 401 && loginNew.status === 200 && tooShort.status === 400);

    // ---- roll-call sessions ----
    const future = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    const mk = (over: Json = {}) => api("POST", "/api/sessions", warden, { hostel_id: 1, date: future, start: "20:00", end: "20:30", ...over });
    const s1 = await mk(); if (s1.json.session_id) createdSessions.push(s1.json.session_id);
    const overlap = await mk({ start: "20:15", end: "20:45" });
    const adjacent = await mk({ start: "20:30", end: "21:00" }); if (adjacent.json.session_id) createdSessions.push(adjacent.json.session_id);
    const otherHostel = await mk({ hostel_id: 2 }); if (otherHostel.json.session_id) createdSessions.push(otherHostel.json.session_id);
    const past = await mk({ date: "2020-01-01" });
    const backwards = await mk({ start: "21:00", end: "20:00" });
    const badDate = await mk({ date: "2026-02-30" });
    const noHostel = await mk({ hostel_id: 99 });
    const asStudent = await api("POST", "/api/sessions", seededStudent, { hostel_id: 1, date: future, start: "10:00", end: "10:30" });
    record("Create roll call (warden)", "201", `${s1.status}`, s1.status === 201);
    record("Overlap rejected, adjacent and other hostel allowed", "409, 201, 201", `${overlap.status} ${adjacent.status} ${otherHostel.status}`, overlap.status === 409 && adjacent.status === 201 && otherHostel.status === 201);
    record("Past / backwards / fake date / unknown hostel rejected", "422, 400, 400, 400", `${past.status} ${backwards.status} ${badDate.status} ${noHostel.status}`, past.status === 422 && backwards.status === 400 && badDate.status === 400 && noHostel.status === 400);
    record("Student cannot create a roll call", "403", `${asStudent.status}`, asStudent.status === 403);
    const closeFuture = await api("POST", `/api/sessions/${s1.json.session_id}/close`, warden);
    record("Closing a roll call that has not ended", "409 with a fixed message", `${closeFuture.status} ${closeFuture.json.error}`, closeFuture.status === 409 && closeFuture.json.error === "This roll call has not ended yet");

    // an ended roll call with missing students: preview number equals the real result
    const ended = (await pool.query("INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES (2, current_date - 5, '20:00', '20:30') RETURNING session_id")).rows[0].session_id as number;
    createdSessions.push(ended);
    const prev = await api("GET", `/api/sessions/${ended}/close`, warden);
    const real = await api("POST", `/api/sessions/${ended}/close`, warden);
    const again = await api("POST", `/api/sessions/${ended}/close`, warden);
    const hostel2 = Number((await pool.query("SELECT count(*) AS n FROM students WHERE hostel_id = 2")).rows[0].n);
    record("Close shows the count, then does exactly that", "preview = result = hostel size; second close marks 0",
      `preview ${prev.json.willBeAbsent}/${prev.json.willGetViolation}, real ${real.json.markedAbsent}/${real.json.violationsRaised}, again ${again.json.markedAbsent}, hostel size ${hostel2}`,
      prev.status === 200 && prev.json.willBeAbsent === hostel2 && real.json.markedAbsent === prev.json.willBeAbsent && real.json.violationsRaised === prev.json.willGetViolation && again.json.markedAbsent === 0);
    const list = await api("GET", "/api/sessions", warden);
    const row = (list.json.sessions ?? []).find((s: Json) => s.session_id === ended);
    record("Session list shows the closed roll call", "status ended, pending 0", `${row?.status} pending=${row?.pending} absent=${row?.absent}`, row?.status === "ended" && row?.pending === 0 && row?.absent === hostel2);
    const html = await (await fetch(`${BASE}/warden/sessions`, { headers: { cookie: warden } })).text();
    record("/warden/sessions renders without raw errors", "page lists hostels, no SQL/FT codes", `${html.includes("Create roll call")} ${/FT0\d\d|SQLSTATE|syntax error/.test(html)}`, html.includes("Create roll call") && !/FT0\d\d|SQLSTATE|syntax error/.test(html));
  } finally {
    // remove everything this run created
    await pool.query("DELETE FROM violations WHERE session_id = ANY($1::int[])", [createdSessions]);
    await pool.query("DELETE FROM attendance WHERE session_id = ANY($1::int[])", [createdSessions]);
    await pool.query("DELETE FROM attendance_sessions WHERE session_id = ANY($1::int[])", [createdSessions]);
    for (const id of createdStudents) {
      await pool.query("DELETE FROM leave_requests WHERE student_id = $1", [id]);
      await api("DELETE", `/api/admin/students/${id}`, admin);
    }
    const left = Number((await pool.query("SELECT count(*) AS n FROM users")).rows[0].n);
    record("Cleanup leaves no test users behind", `${usersBefore} users`, `${left} users`, left === usersBefore);
  }

  console.log("| Case | Expected | Actual | Result |\n|---|---|---|---|");
  console.log(rows.join("\n"));
  console.log(`\n${rows.length - failures}/${rows.length} passed`);
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test-registration crashed:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
