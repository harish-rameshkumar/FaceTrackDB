// Tests for the matching rules (512-d cosine) using SYNTHETIC unit vectors.
//
// Scope, honestly: these prove the RULES (thresholds, margin, multi-frame voting,
// duplicate guard, quality gate, cooldown, procedure errors). They do not prove the
// face model separates real people; `npm run faces:eval` measures that.
//
// It calls processScan() and enrolEmbeddings() in-process (no browser, no embedder
// needed). Only the 401/403/400 checks use HTTP, so a dev server must be listening
// on BASE_URL for those (they fail before the embedder is ever called).
//
// SAFETY: it writes to face_profiles and face_events, so it refuses to run unless the
// database name contains "test"/"scratch" AND QDRANT_COLLECTION ends in "_test".
//
// Setup (scratch DB loaded with db/*.sql, demo_passwords and ./db/load_b.sh):
//   export DATABASE_URL=postgresql://user:pass@localhost:5432/facetrack_scratch
//   export QDRANT_COLLECTION=face_embeddings_test
//   npm run qdrant:reset -- --yes && npm run seed:faces     (reset also empties face_profiles of the scratch DB)
//   SCAN_COOLDOWN_SECONDS=3 npm run dev                                           (terminal 1, same env)
//   SCAN_COOLDOWN_SECONDS=3 BASE_URL=http://localhost:3000 npm run test:match      (terminal 2)
// Run it once more with SCAN_COOLDOWN_SECONDS=0 for the test process only: the scan logic runs
// in-process, so the server's value does not matter (the dev server is used for 401/403/400 checks).
// Logs in through POST /api/login with the accounts from db/seed.sql and the demo
// password from db/demo_passwords.sql (override with TEST_PASSWORD).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../lib/db";
import { enrolEmbeddings, deleteProfile, FaceError, findDuplicateFace, listSamples, setSampleActive } from "../lib/faces";
import { classifyFrame, combineFrames, getScanCooldownSeconds, getThresholds, rankStudents, searchFrame } from "../lib/matching";
import { checkQuality, getQualityLimits } from "../lib/quality";
import { COLLECTION } from "../lib/qdrant";
import { processScan, type ScanInput } from "../lib/scan";
import { assertTestEnvironment, baseEmbedding, embeddingAtSimilarity, randomEmbedding } from "./synthetic";

assertTestEnvironment(COLLECTION);

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

// The HTTP route, for access and validation checks that fail before any image is processed.
async function postForm(fields: Record<string, string>, role: Role | null, frames = 0): Promise<{ status: number; json: Json }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (let i = 0; i < frames; i++) form.append("frames", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), `f${i}.jpg`);
  const res = await fetch(`${BASE}/api/faces/match`, { method: "POST", headers: role ? { cookie: await cookieFor(role) } : {}, body: form });
  return { status: res.status, json: await res.json() };
}

async function scan(input: ScanInput): Promise<{ status: number; json: Json; retryAfter: string | null }> {
  const r = await processScan(input);
  return { status: r.status, json: r.body as Json, retryAfter: r.headers?.["Retry-After"] ?? null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function record(name: string, input: string, expected: string, actual: string, pass: boolean) {
  if (!pass) failures++;
  rows.push(`| ${name} | ${input} | ${expected} | ${actual} | ${pass ? "PASS" : "FAIL"} |`);
}

// The three enrolled "photos" of student s (cosine 0.85 to the student's base face).
const enrolled = (sid: number, k: number) => embeddingAtSimilarity(baseEmbedding(sid), 0.85, sid * 100 + k);
// Three scan frames of student s: new photos at cosine `sim` to the base face.
const framesOf = (sid: number, sim: number, seed: number) => [0, 1, 2].map((i) => embeddingAtSimilarity(baseEmbedding(sid), sim, seed + i));
const exactFrames = (sid: number) => [enrolled(sid, 1), enrolled(sid, 1), enrolled(sid, 1)];
const randomFrames = (seed: number) => [0, 1, 2].map((i) => randomEmbedding(seed + i));
const f3 = (x: number | null | undefined) => (typeof x === "number" ? x.toFixed(3) : "-");
async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params);
  return Number(Object.values(r.rows[0])[0]);
}

let lookalikeIds: number[] = [];
async function removeLookalikes() {
  for (const id of lookalikeIds) await deleteProfile(id);
  lookalikeIds = [];
}


function unitTests() {
  const t = getThresholds();
  const hit = (studentId: number, similarity: number) => ({ studentId, similarity });

  // student score = mean of best two sample similarities (best one if only one sample)
  const ranked = rankStudents([hit(1, 0.9), hit(1, 0.7), hit(1, 0.1), hit(2, 0.8)]);
  record("Score: mean of best two", "student 1 samples 0.9, 0.7, 0.1; student 2 sample 0.8", "student 1 = 0.800, student 2 = 0.800 (single sample)",
    ranked.map((r) => `${r.studentId}=${f3(r.score)}`).join(", "),
    ranked.length === 2 && Math.abs(ranked.find((r) => r.studentId === 1)!.score - 0.8) < 1e-9 && Math.abs(ranked.find((r) => r.studentId === 2)!.score - 0.8) < 1e-9);

  const v = (s: number, other?: number) => classifyFrame(rankStudents([hit(1, s), ...(other === undefined ? [] : [hit(2, other)])]), t);
  const got = [v(0.6).outcome, v(0.5).outcome, v(0.45).outcome, v(0.35).outcome, v(0.34).outcome, v(0.7, 0.65).outcome, v(0.7, 0.55).outcome];
  record("Thresholds and margin", "score 0.6, 0.5, 0.45, 0.35, 0.34; 0.7 vs other 0.65; 0.7 vs other 0.55 (defaults 0.50/0.35/0.08)",
    "matched, matched, low_confidence, low_confidence, no_match, low_confidence (margin 0.05), matched (margin 0.15)", got.join(", "),
    got.join(",") === "matched,matched,low_confidence,low_confidence,no_match,low_confidence,matched");

  // multi-frame voting (verdicts built directly)
  const fv = (sid: number | null, score: number, outcome: "matched" | "low_confidence" | "no_match") =>
    ({ outcome, top: sid === null ? null : { studentId: sid, score }, margin: 0.3 });
  const d1 = combineFrames([fv(1, 0.8, "matched"), fv(1, 0.7, "matched"), fv(1, 0.75, "matched")]);
  const d2 = combineFrames([fv(1, 0.8, "matched"), fv(1, 0.7, "matched"), fv(null, 0, "no_match")]);
  const d3 = combineFrames([fv(1, 0.8, "matched"), fv(2, 0.7, "matched"), fv(3, 0.75, "matched")]);
  const d4 = combineFrames([fv(1, 0.8, "matched"), fv(null, 0.1, "no_match"), fv(null, 0.1, "no_match")]);
  const d5 = combineFrames([fv(null, 0.1, "no_match"), fv(null, 0.2, "no_match"), fv(null, 0.1, "no_match")]);
  const d6 = combineFrames([fv(1, 0.8, "matched"), fv(1, 0.4, "low_confidence"), fv(2, 0.38, "low_confidence")]);
  record("Frames: 3 of 3 agree", "student 1 wins all three frames", "matched, 3 agreeing", `${d1.outcome} ${d1.agreeingFrames}/${d1.usableFrames}`, d1.outcome === "matched" && d1.agreeingFrames === 3);
  record("Frames: 2 of 3 agree", "student 1 wins two frames, third is no_match", "matched, 2 agreeing", `${d2.outcome} ${d2.agreeingFrames}/${d2.usableFrames}`, d2.outcome === "matched" && d2.agreeingFrames === 2);
  record("Frames: all disagree", "three different winners", "low_confidence (never matched)", `${d3.outcome}`, d3.outcome === "low_confidence");
  record("Frames: only 1 of 3", "one confident frame, two no_match", "low_confidence", `${d4.outcome}`, d4.outcome === "low_confidence" && d4.studentId === 1);
  record("Frames: nobody", "three no_match frames", "no_match, no student", `${d5.outcome} student=${d5.studentId}`, d5.outcome === "no_match" && d5.studentId === null);
  record("Frames: one confident + weak agreement", "student 1: matched + low_confidence; student 2: low_confidence", "low_confidence (needs 2 CONFIDENT frames)", `${d6.outcome} student=${d6.studentId}`, d6.outcome === "low_confidence" && d6.studentId === 1);

  // quality gate
  const q = getQualityLimits();
  const face = (over: Partial<{ detScore: number; width: number; blurScore: number }> = {}) =>
    ({ count: 1, face: { embedding: [], detScore: 0.9, width: 150, height: 150, blurScore: 100, ...over } });
  const quality = [
    checkQuality({ count: 0, face: null }, q), checkQuality({ ...face(), count: 2 }, q), checkQuality(face({ detScore: q.minDetScore - 0.01 }), q),
    checkQuality(face({ width: q.minFaceWidth - 1 }), q), checkQuality(face({ blurScore: q.minBlur - 1 }), q), checkQuality(face(), q),
  ].map((x) => x ?? "ok");
  record("Quality gate", `limits: score>=${q.minDetScore}, width>=${q.minFaceWidth}px, blur>=${q.minBlur}`,
    "no_face, multiple_faces, low_score, too_small, too_blurry, ok", quality.join(", "),
    quality.join(",") === "no_face,multiple_faces,low_score,too_small,too_blurry,ok");
}

// A deactivated sample (Qdrant payload active=false) is ignored by the gate search and by the duplicate-face guard;
// reactivating it restores it. Student 1 and student 2 are two of the synthetic students made by seed:faces.
async function deactivatedSamples() {
  const base = baseEmbedding(1);
  const samples = await listSamples(1);
  const top = async () => (await searchFrame(base)).map((r) => r.studentId);
  const dup = async () => (await findDuplicateFace(2, [base]))?.studentId ?? null;
  try {
    const before = { top: await top(), dup: await dup() };
    for (const sm of samples) await setSampleActive(sm.faceProfileId, false);
    const off = { top: await top(), dup: await dup(), listed: (await listSamples(1)).map((x) => x.active).join(",") };
    for (const sm of samples) await setSampleActive(sm.faceProfileId, true);
    const on = { top: await top(), dup: await dup() };
    record("Deactivated samples are ignored", "student 1's samples deactivated: gate search and duplicate guard no longer see student 1; reactivated: they do again",
      "before: found, dup=1; off: not found, dup=null, all false; on: found, dup=1",
      `before ${before.top.includes(1)} dup=${before.dup}; off ${off.top.includes(1)} dup=${off.dup} [${off.listed}]; on ${on.top.includes(1)} dup=${on.dup}`,
      samples.length > 0 && before.top[0] === 1 && before.dup === 1 && !off.top.includes(1) && off.dup === null && off.listed === samples.map(() => "false").join(",") && on.top[0] === 1 && on.dup === 1);
  } finally {
    for (const sm of samples) await setSampleActive(sm.faceProfileId, true);
  }
}

async function main() {
  unitTests();
  await deactivatedSamples();

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
    const roll = (embeddings: number[][], cameraId = 4) => scan({ embeddings, cameraId, purpose: "attendance" });
    const gate = (embeddings: number[][], direction?: "IN" | "OUT") => scan({ embeddings, cameraId: 4, purpose: "entry_exit", direction });

    // --- attendance cases (hostel 2, camera 4) ---
    let r = await roll(exactFrames(4));
    record("Exact match", "student 4's enrolled sample #1, three frames", "matched, attendance present",
      `${r.status} ${r.json.outcome} sim=${f3(r.json.similarity)} conf=${r.json.confidence} -> ${r.json.result?.status}; rows=${await att(4)}`,
      r.status === 200 && r.json.outcome === "matched" && r.json.result?.status === "present" && (await att(4)) === 1);

    r = await roll(framesOf(5, 0.8, 700));
    record("Noisy copy", "student 5, three new photos at cosine 0.80 to the face", "still matched, present",
      `${r.status} ${r.json.outcome} sim=${f3(r.json.similarity)} margin=${f3(r.json.margin)} -> ${r.json.result?.status}`,
      r.status === 200 && r.json.outcome === "matched" && r.json.student?.student_id === 5 && r.json.result?.status === "present");

    r = await roll(randomFrames(424242));
    record("Random vector", "three unrelated random vectors", "no_match, nobody marked",
      `${r.status} ${r.json.outcome} sim=${f3(r.json.similarity)} conf=${r.json.confidence} student=${r.json.student}`,
      r.status === 200 && r.json.outcome === "no_match" && r.json.student === null && r.json.result === null);

    r = await roll(framesOf(6, 0.5, 900));
    record("Review band", "student 6, three photos at cosine 0.50 to the face (score ~0.42)", "low_confidence, NOT marked, event kept",
      `${r.status} ${r.json.outcome} sim=${f3(r.json.similarity)} conf=${r.json.confidence}; attendance rows=${await att(6)}`,
      r.status === 200 && r.json.outcome === "low_confidence" && r.json.student?.student_id === 6 && (await att(6)) === 0);

    const eventsBefore = await events();
    r = await roll(exactFrames(4));
    record("Duplicate scan", "student 4 again, same roll call", "409 FT001, event still logged, still 1 attendance row",
      `${r.status} ${r.json.error?.code}; events +${(await events()) - eventsBefore}; rows=${await att(4)}`,
      r.status === 409 && r.json.error?.code === "FT001" && (await events()) === eventsBefore + 1 && (await att(4)) === 1);

    r = await roll(exactFrames(1), 1);
    record("No roll call open", `student 1 at hostel 1 camera (no session at ${now})`, "409 no_active_session",
      `${r.status} ${r.json.outcome} ${r.json.error?.code}`, r.status === 409 && r.json.error?.code === "no_active_session");

    r = await roll(exactFrames(1));
    record("Wrong hostel", "student 1 (hostel 1) scanned at hostel 2 camera", "403 FT003", `${r.status} ${r.json.error?.code}`, r.status === 403 && r.json.error?.code === "FT003");

    // multi-frame behaviour through the full scan path (student 6 is not yet marked)
    const e6 = enrolled(6, 1);
    const evM = await events();
    r = await roll([e6, randomEmbedding(31), randomEmbedding(32)]);
    record("Multi-frame: only 1 of 3 frames", "student 6 on one frame, random on the others", "low_confidence, NOT marked",
      `${r.status} ${r.json.outcome} agreeing=${r.json.frames?.agreeing}/${r.json.frames?.usable}; rows=${await att(6)}`,
      r.status === 200 && r.json.outcome === "low_confidence" && r.json.frames?.agreeing === 1 && (await att(6)) === 0 && (await events()) === evM + 1);

    r = await roll([enrolled(4, 1), enrolled(5, 1), enrolled(6, 1)]);
    record("Multi-frame: frames disagree", "three different students, one frame each", "low_confidence, NOT marked",
      `${r.status} ${r.json.outcome} student=${r.json.student?.student_id}; rows(6)=${await att(6)}`,
      r.status === 200 && r.json.outcome === "low_confidence" && (await att(6)) === 0);

    r = await roll([e6, e6, randomEmbedding(33)]);
    record("Multi-frame: 2 of 3 frames agree", "student 6 on two frames, random on the third", "matched, present",
      `${r.status} ${r.json.outcome} agreeing=${r.json.frames?.agreeing}/${r.json.frames?.usable}; rows=${await att(6)}`,
      r.status === 200 && r.json.outcome === "matched" && r.json.frames?.agreeing === 2 && (await att(6)) === 1);

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
    const exact4 = exactFrames(4);
    const cooldown = getScanCooldownSeconds(); // same value as the server's SCAN_COOLDOWN_SECONDS
    const waitOutCooldown = () => sleep(cooldown > 0 ? (cooldown + 1) * 1000 : 0);

    r = await gate(exact4);
    record("Gate: first scan", `student 4, direction inferred, ${now}`, `OUT, violation ${expectOut}`,
      `${r.status} ${r.json.outcome} ${r.json.result?.direction} violation=${r.json.result?.violation_type}`,
      r.status === 200 && r.json.result?.direction === "OUT" && r.json.result?.violation_type === expectOut);

    await waitOutCooldown(); // the same student may not be scanned again within the cooldown
    r = await gate(exact4, "IN");
    record("Gate: return", `student 4, IN, ${now}`, `IN, violation ${expectIn}`,
      `${r.status} ${r.json.result?.direction} violation=${r.json.result?.violation_type}`,
      r.status === 200 && r.json.result?.direction === "IN" && r.json.result?.violation_type === expectIn);

    await waitOutCooldown();
    const evBefore = await events();
    r = await gate(exact4, "IN");
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
      const first = await gate(exact4);
      const dirBefore = await lastDirection(4);
      const evA = await events(), logA = await logsOf(4), vioA = await violations();
      r = await gate(exact4);
      record("Cooldown: second scan refused", `student 4 gate scan right after another (cooldown ${cooldown}s)`,
        "429 scan_cooldown, Retry-After set, no new face event / gate log / violation, direction unchanged",
        `${first.status} then ${r.status} ${r.json.code} retry=${r.json.retryAfterSeconds} header=${r.retryAfter}; events +${(await events()) - evA}, logs +${(await logsOf(4)) - logA}, violations +${(await violations()) - vioA}, last=${await lastDirection(4)}`,
        first.status === 200 && r.status === 429 && r.json.code === "scan_cooldown" && r.json.retryAfterSeconds > 0 && r.json.retryAfterSeconds <= cooldown &&
          r.retryAfter === String(r.json.retryAfterSeconds) && typeof r.json.error === "string" && r.json.error.startsWith("Already scanned. Please wait") &&
          (await events()) === evA && (await logsOf(4)) === logA && (await violations()) === vioA && (await lastDirection(4)) === dirBefore);

      const evC = await events();
      const other = await gate(exactFrames(5));
      const still = await gate(exact4);
      record("Cooldown: other student unaffected", "student 5 gate scan while student 4 is cooling down", "200 recorded for 5, student 4 still 429",
        `student 5: ${other.status} ${other.json.result?.direction}; student 4: ${still.status}`,
        other.status === 200 && other.json.result?.kind === "entry_exit" && still.status === 429 && (await events()) === evC + 1);

      await waitOutCooldown();
      r = await gate(exact4);
      record("Cooldown: allowed again after waiting", `student 4 after ${cooldown + 1}s`, `200, direction flips from ${dirBefore}`,
        `${r.status} ${r.json.result?.direction}`, r.status === 200 && r.json.result?.direction === (dirBefore === "OUT" ? "IN" : "OUT"));

      const gate6 = await gate(exactFrames(6));
      const roll6 = await roll(exactFrames(6));
      record("Cooldown: roll call unaffected", "student 6 gate scan, then a roll-call scan right away", "gate 200, roll call 409 FT001 (already present) rather than 429",
        `${gate6.status} then ${roll6.status} ${roll6.json.error?.code}`,
        gate6.status === 200 && roll6.status === 409 && roll6.json.error?.code === "FT001");
    } else {
      const a = await gate(exactFrames(5));
      const b = await gate(exactFrames(5));
      record("Cooldown disabled (0)", "student 5 gate scan twice in a row", "both 200, direction flips",
        `${a.status} ${a.json.result?.direction}, then ${b.status} ${b.json.result?.direction}`,
        a.status === 200 && b.status === 200 && a.json.result?.direction === "OUT" && b.json.result?.direction === "IN");
    }

    // --- margin rule: a look-alike enrolled as another student ---
    // Student 5 gets three extra samples at cosine 0.82 to student 4's sample #2, so a scan
    // of that sample scores ~0.86 for student 4 and ~0.82 for student 5: margin well under
    // the 0.08 minimum, so it must go to the warden instead of being auto-matched.
    // (The duplicate guard would refuse this enrolment, so it is lowered for this setup only.)
    const sample = enrolled(4, 2);
    const savedReview = process.env.REVIEW_MIN_SIMILARITY, savedMatch = process.env.MATCH_MIN_SIMILARITY;
    process.env.MATCH_MIN_SIMILARITY = "0.99"; process.env.REVIEW_MIN_SIMILARITY = "0.98";
    const lookProfiles = await enrolEmbeddings(5, [11, 12, 13].map((k) => embeddingAtSimilarity(sample, 0.82, k)));
    if (savedReview === undefined) delete process.env.REVIEW_MIN_SIMILARITY; else process.env.REVIEW_MIN_SIMILARITY = savedReview;
    if (savedMatch === undefined) delete process.env.MATCH_MIN_SIMILARITY; else process.env.MATCH_MIN_SIMILARITY = savedMatch;
    lookalikeIds = lookProfiles.map((p) => p.faceProfileId);
    const attBefore = await scalar("SELECT count(*) FROM attendance WHERE session_id=$1", [sessionId]);
    r = await roll([sample, sample, sample]);
    record("Margin rule", "student 4 sample #2 with a look-alike of student 5 at cosine 0.82", "low_confidence (not auto-matched), margin < 0.08, nothing marked",
      `${r.status} ${r.json.outcome} sim=${f3(r.json.similarity)} margin=${f3(r.json.margin)}; new attendance rows=${(await scalar("SELECT count(*) FROM attendance WHERE session_id=$1", [sessionId])) - attBefore}`,
      lookProfiles.length === 3 && r.status === 200 && r.json.outcome === "low_confidence" && r.json.margin < 0.08 &&
        (await scalar("SELECT count(*) FROM attendance WHERE session_id=$1", [sessionId])) === attBefore);
    await removeLookalikes();

    // --- duplicate-face guard at enrolment ---
    let dupMsg = "no error", dupCode = "";
    const profilesBefore = await scalar("SELECT count(*) FROM face_profiles");
    try {
      await enrolEmbeddings(6, [embeddingAtSimilarity(baseEmbedding(4), 0.9, 5), embeddingAtSimilarity(baseEmbedding(4), 0.9, 6), embeddingAtSimilarity(baseEmbedding(4), 0.9, 7)]);
    } catch (e) {
      if (e instanceof FaceError) { dupMsg = e.message; dupCode = e.code ?? ""; } else throw e;
    }
    const nameOf4 = (await pool.query("SELECT name, roll_no FROM students WHERE student_id = 4")).rows[0];
    record("Duplicate-face guard", "enrol student 6 with faces that look like student 4 (cosine 0.9)", `refused: "This face already matches ${nameOf4.name} (${nameOf4.roll_no})", nothing stored`,
      `${dupCode}: ${dupMsg}; profiles +${(await scalar("SELECT count(*) FROM face_profiles")) - profilesBefore}`,
      dupCode === "duplicate_face" && dupMsg === `This face already matches ${nameOf4.name} (${nameOf4.roll_no})` && (await scalar("SELECT count(*) FROM face_profiles")) === profilesBefore);

    const fresh = await enrolEmbeddings(6, [randomEmbedding(91501), randomEmbedding(91502)]);
    const own = await enrolEmbeddings(6, [embeddingAtSimilarity(baseEmbedding(6), 0.9, 8)]); // the student's OWN look-alike samples are not a duplicate
    record("Duplicate guard: new face and re-enrol", "a brand-new face, then more samples of student 6's own face", "both accepted", `${fresh.length} + ${own.length} profiles`, fresh.length === 2 && own.length === 1);
    for (const p of [...fresh, ...own]) await deleteProfile(p.faceProfileId);

    // --- request validation and access (HTTP; none of these reach the embedder) ---
    let h = await postForm({ camera_id: "4", purpose: "attendance" }, "student", 3);
    record("Wrong role", "role student", "403", `${h.status}`, h.status === 403);
    h = await postForm({ camera_id: "4", purpose: "attendance" }, null, 3);
    record("Not signed in", "no session cookie", "401", `${h.status}`, h.status === 401);
    h = await postForm({ camera_id: "4", purpose: "lunch" }, "security", 3);
    record("Bad purpose", "purpose='lunch'", "400", `${h.status}`, h.status === 400);
    h = await postForm({ camera_id: "four", purpose: "attendance" }, "security", 3);
    record("Bad camera id", "camera_id='four'", "400", `${h.status}`, h.status === 400);
    h = await postForm({ camera_id: "4", purpose: "attendance" }, "security", 1);
    record("Wrong number of frames", "1 image instead of 3", "400", `${h.status} ${h.json.error}`, h.status === 400);
    r = await roll(exactFrames(4), 3);
    record("Inactive camera", "camera 3 (status inactive)", "409", `${r.status} ${r.json.error}`, r.status === 409);
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
  console.error("test-matching crashed:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
