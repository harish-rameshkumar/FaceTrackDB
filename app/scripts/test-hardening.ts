// Tests for the hardening work: fixed error messages, database-backed login rate limiting,
// JWT_SECRET validation (fail closed), token revocation, page-level access, leave cancellation
// and violations.resolved_at. Everything goes through the real HTTP API of a running server.
//   DATABASE_URL=.../<scratch_db> BASE_URL=http://localhost:3000 npm run test:hardening
// SAFETY: it creates and deletes throw-away users, changes and restores a violation, and writes
// login attempts, so it only runs against a database whose name contains "test" or "scratch".
// It starts a second copy of the built app on port 3299 (needs `npm run build` first) to prove that a
// placeholder JWT_SECRET makes login fail closed.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SignJWT } from "jose";
import { getPool } from "../lib/db";
import { DB_ERRORS, publicDbError } from "../lib/db-errors";
import { checkJwtSecret } from "../lib/jwt-secret";
import { assertTestEnvironment } from "./synthetic";

assertTestEnvironment("none_test", { requireTestCollection: false });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const pool = getPool();
const rows: string[] = [];
let failures = 0;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const record = (name: string, expected: string, actual: string, pass: boolean) => {
  if (!pass) failures++;
  rows.push(`| ${name} | ${expected} | ${actual.replace(/\|/g, "/").slice(0, 260)} | ${pass ? "PASS" : "FAIL"} |`);
};

const dbDir = resolve(process.cwd(), "..", "db");
const seed = readFileSync(resolve(dbDir, "seed.sql"), "utf8");
const demo = readFileSync(resolve(dbDir, "demo_passwords.sql"), "utf8");
const PW = process.env.TEST_PASSWORD ?? /Password for all accounts:\s+(\S+)/.exec(demo)?.[1] ?? "";
const emailOf = (role: string) => new RegExp(`'([^']+@[^']+)'[^)\\n]*'${role}'\\)`).exec(seed)![1];
const TAG = `h${Date.now().toString(36)}`;
let ipCounter = 10;
const nextIp = () => `203.0.113.${ipCounter++}`; // TEST-NET-3 addresses, one per scenario so limits never overlap

async function login(email: string, password: string, ip = nextIp(), base = BASE) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password }) });
  const ms = performance.now() - t0;
  const sc = res.headers.get("set-cookie");
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, cookie: sc ? sc.split(";")[0] : null, json, text, retryAfter: res.headers.get("retry-after"), ms };
}
async function api(method: string, path: string, cookie: string | null, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeUser(role: string, name: string): Promise<{ id: number; email: string; password: string }> {
  const password = `Temp-${TAG}-Pw1`;
  const email = `${TAG}.${name}@hard.test`;
  const { rows: r } = await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, crypt($2, gen_salt('bf', 10)), $3) RETURNING user_id", [email, password, role]);
  return { id: r[0].user_id, email, password };
}

async function main() {
  const adminEmail = emailOf("admin"), wardenEmail = "warden1@facetrack.test", studentEmail = emailOf("student");
  const created: number[] = [];
  const ipsUsed: string[] = [];
  const emailsUsed = new Set<string>();
  const freshIp = () => { const ip = nextIp(); ipsUsed.push(ip); return ip; };

  try {
    // ================= JWT_SECRET validation =================
    const good = "9f2c4e8a1b7d3f6a0c5e9b2d4f8a1c3e6b9d0f2a4c7e1b3d5f8a0c2e4b6d9f1a";
    const cases: [string, string | undefined, boolean][] = [
      ["64 random hex characters", good, true], ["a long random value that merely contains the word secret early on", `secret-${good}`, true],
      ["missing", undefined, false], ["empty", "", false], ["31 characters", good.slice(0, 31), false],
      ["the old .env.example placeholder", "replace_with_a_long_random_string", false], ["placeholder padded to 40 characters", "replace_with_a_long_random_string_0000000", false],
      ["change_me repeated", "change_me_change_me_change_me_change_me", false], ["contains 'example'", "this_is_just_an_example_value_1234567890", false],
      ["ends in 'secret' + 3 characters", "kjhg7sdf6s8dfg7s6df8g7sd6f8g7secret123", false], ["one repeated character", "a".repeat(40), false],
      ["two characters alternating", "ab".repeat(20), false],
    ];
    const bad = cases.filter(([, v, ok]) => (checkJwtSecret(v) === null) !== ok).map(([n]) => n);
    record("JWT_SECRET validation", `${cases.length} cases: accepts strong values, rejects missing/short/placeholder/guessable`, bad.length ? `wrong for: ${bad.join("; ")}` : `${cases.length}/${cases.length} correct`, bad.length === 0);

    // fail closed: a second copy of the app with a placeholder secret
    const port = 3299;
    const child = spawn("npx", ["next", "start", "-p", String(port)], { env: { ...process.env, JWT_SECRET: "replace_with_a_long_random_string", NODE_ENV: "production" }, stdio: "ignore" });
    try {
      let up = false;
      for (let i = 0; i < 40 && !up; i++) { await sleep(500); up = await fetch(`http://localhost:${port}/api/health`).then((r) => r.status > 0, () => false); }
      const bl = await login(adminEmail, PW, freshIp(), `http://localhost:${port}`);
      const forged = await new SignJWT({ role: "admin", tv: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject("3").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode("replace_with_a_long_random_string"));
      const me = await fetch(`http://localhost:${port}/api/me`, { headers: { cookie: `facetrack_session=${forged}` } });
      const viol = await fetch(`http://localhost:${port}/api/violations`, { headers: { cookie: `facetrack_session=${forged}` } });
      record("A placeholder JWT_SECRET fails closed", "server up; correct login -> 500, no cookie; a token signed with the placeholder is never accepted (no 200)",
        `up=${up} login ${bl.status} cookie=${bl.cookie !== null} body leaks secret=${bl.text.includes("replace_with")}; /api/me ${me.status}; /api/violations ${viol.status}`,
        up && bl.status === 500 && bl.cookie === null && !bl.text.includes("replace_with") && me.status !== 200 && viol.status !== 200);
    } finally {
      child.kill();
    }

    // ================= fixed error messages =================
    const phase3 = readFileSync(resolve(dbDir, "docs", "phase3-logic.md"), "utf8");
    const documented = [...new Set([...phase3.matchAll(/\|\s*(FT\d{3})\s*\|/g)].map((m) => m[1]))];
    const unmapped = documented.filter((c) => !DB_ERRORS[c]);
    record("Every FT code in phase3-logic.md has a fixed message", `${documented.length} documented codes all mapped`, unmapped.length ? `unmapped: ${unmapped.join(", ")}` : `${documented.length} mapped`, documented.length >= 20 && unmapped.length === 0);
    const withDigits = Object.entries(DB_ERRORS).filter(([, v]) => /\d/.test(v.message)).map(([k]) => k);
    record("Fixed messages contain no ids or numbers", "no digit in any message", withDigits.length ? `digits in ${withDigits.join(", ")}` : "none", withDigits.length === 0);
    const raw = publicDbError(Object.assign(new Error('duplicate key value violates unique constraint "users_email_key" Key (email)=(a@b.c)'), { code: "XX000" }));
    const rawKnown = publicDbError(Object.assign(new Error("Parent 3 is not a parent of student 4"), { code: "FT033" }));
    record("Unknown errors are not mapped; known ones never use the raw text", "XX000 -> null; FT033 -> fixed text", `${raw === null}; ${rawKnown?.message}`, raw === null && rawKnown?.message === DB_ERRORS.FT033.message);

    const wardenC = (await login(wardenEmail, PW, freshIp())).cookie!;
    const adminC = (await login(adminEmail, PW, freshIp())).cookie!;
    const studentC = (await login(studentEmail, PW, freshIp())).cookie!;
    const parentC3 = (await login("parent.ramanathan@facetrack.test", PW, freshIp())).cookie!;
    const parentC1 = (await login("parent.senthil@facetrack.test", PW, freshIp())).cookie!;
    const LEAK = /student \d|parent \d|session \d|Leave request \d|violates|constraint|relation "|column|SQLSTATE|syntax error|duplicate key|integer|\bat \w+ \(/i;
    const decide = (cookie: string, id: number) => api("POST", `/api/leave/${id}/decide`, cookie, { decision: "approved" });
    const probes: [string, Awaited<ReturnType<typeof api>>, number, string | undefined][] = [
      // since the database role ft_parent only sees its own children's leave (row-level security), another family's request
      // is "not found" (404, FT031), not "not your child" (403, FT033): the answer no longer confirms that the id exists
      ["a parent decides another parent's ward's leave (hidden by row-level security: FT031)", await decide(parentC3, 3), 404, DB_ERRORS.FT031.message],
      ["a second decision on a decided leave (FT032)", await decide(parentC1, 1), 409, DB_ERRORS.FT032.message],
      ["a leave request that does not exist (FT031)", await decide(parentC1, 99999), 404, DB_ERRORS.FT031.message],
    ];
    for (const [name, r, status, msg] of probes) {
      record(`Error response: ${name}`, `HTTP ${status}, fixed message, no ids or SQL`, `${r.status} ${JSON.stringify(r.json)}`, r.status === status && r.json.error === msg && !LEAK.test(r.text));
    }
    const hugeHostel = await api("POST", "/api/sessions", wardenC, { hostel_id: 99999999999, date: "2099-01-01", start: "20:00", end: "20:30" });
    record("A database error the app did not expect becomes a generic message", "no 'integer', 'out of range' or SQL text in the body", `${hugeHostel.status} ${hugeHostel.text.slice(0, 120)}`, hugeHostel.status >= 400 && !LEAK.test(hugeHostel.text) && !/out of range/i.test(hugeHostel.text));

    // ================= login rate limiting =================
    const known = studentEmail, unknown = `${TAG}.nobody@hard.test`;
    const lockSequence = async (email: string) => {
      const ip = freshIp();
      emailsUsed.add(email);
      const fails: number[] = [];
      for (let i = 0; i < 5; i++) fails.push((await login(email, "wrong-password", ip)).status);
      const sixth = await login(email, email === known ? PW : "whatever", ip);
      return { fails, sixth };
    };
    const k = await lockSequence(known);
    const u = await lockSequence(unknown);
    record("Lockout after 5 failures, even with the right password", "5x401 then 429 with Retry-After (1-900) and a fixed message",
      `${k.fails.join(",")} then ${k.sixth.status}, Retry-After ${k.sixth.retryAfter}, ${JSON.stringify(k.sixth.json)}`,
      k.fails.every((s) => s === 401) && k.sixth.status === 429 && Number(k.sixth.retryAfter) >= 1 && Number(k.sixth.retryAfter) <= 900 && /^Too many failed sign-in attempts\. Try again in \d+ minutes?\.$/.test(k.sixth.json.error) && k.sixth.cookie === null);
    const shape = (j: Json) => Object.keys(j).sort().join(",");
    record("A locked unknown email gets the same response as a locked known one", "same status, same keys, same message text",
      `known: ${k.sixth.status} [${shape(k.sixth.json)}] unknown: ${u.sixth.status} [${shape(u.sixth.json)}]; same message: ${k.sixth.json.error === u.sixth.json.error}`,
      u.fails.every((s) => s === 401) && u.sixth.status === 429 && shape(k.sixth.json) === shape(u.sixth.json) && k.sixth.json.error === u.sixth.json.error);

    // success clears the counter
    {
      const email = `${TAG}.clears@hard.test`;
      const user = await makeUser("security", "clears");
      created.push(user.id);
      emailsUsed.add(user.email);
      const ip = freshIp();
      const a: number[] = [];
      for (let i = 0; i < 4; i++) a.push((await login(user.email, "nope-nope", ip)).status);
      const ok = await login(user.email, user.password, ip);
      const b: number[] = [];
      for (let i = 0; i < 4; i++) b.push((await login(user.email, "nope-nope", ip)).status);
      const fifth = await login(user.email, "nope-nope", ip), sixth = await login(user.email, user.password, ip);
      void email;
      record("A successful login clears the counter", "4 failures, success (200), 4 more failures still 401, then the 5th failure locks the 6th",
        `${a.join(",")} | ${ok.status} | ${b.join(",")} | 5th ${fifth.status} | 6th ${sixth.status}`,
        a.every((s) => s === 401) && ok.status === 200 && b.every((s) => s === 401) && fifth.status === 401 && sixth.status === 429);
      // expiry: the same lock lifts after 15 minutes
      await pool.query("UPDATE login_attempts SET attempted_at = attempted_at - interval '16 minutes' WHERE email = $1", [user.email]);
      const after = await login(user.email, user.password, ip);
      record("The lock expires after 15 minutes", "the same correct login now works (200)", `${after.status}`, after.status === 200);
    }

    // per-address limit
    {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 20; i++) statuses.push((await login(`${TAG}.ip${i}@hard.test`, "wrong-password", ip)).status);
      const blocked = await login(`${TAG}.ipnew@hard.test`, "wrong-password", ip);
      const otherIp = await login(`${TAG}.ipnew@hard.test`, "wrong-password", freshIp());
      record("Per-address limit", "20 failures from one address (different emails) -> the 21st is 429; another address is not affected",
        `${statuses.filter((s) => s === 401).length}x401, then ${blocked.status}; other address ${otherIp.status}`, statuses.every((s) => s === 401) && blocked.status === 429 && otherIp.status === 401);
    }

    // bcrypt still runs for unknown emails (constant-time dummy hash)
    {
      const ip1 = freshIp(), ip2 = freshIp();
      const t = async (email: string, ip: string) => { const xs: number[] = []; for (let i = 0; i < 3; i++) xs.push((await login(email, "wrong-password", ip)).ms); return xs.reduce((a, b) => a + b) / xs.length; };
      const knownMs = await t(`${TAG}.known-timing@hard.test`, ip1); // not an account: warm both paths equally
      const realMs = await t("warden1@facetrack.test", ip2);
      emailsUsed.add("warden1@facetrack.test");
      record("Unknown and known emails take comparable time (dummy hash kept)", "both run bcrypt (> 20 ms) and are within a factor of 3", `unknown ${knownMs.toFixed(0)} ms, known ${realMs.toFixed(0)} ms`, knownMs > 20 && realMs > 20 && Math.max(knownMs, realMs) / Math.min(knownMs, realMs) < 3);
    }

    // ================= token revocation =================
    {
      const w = await makeUser("warden", "revoke1");
      created.push(w.id);
      const l = await login(w.email, w.password, freshIp());
      const before = await api("GET", "/api/violations", l.cookie), meBefore = await api("GET", "/api/me", l.cookie);
      await pool.query("DELETE FROM users WHERE user_id = $1", [w.id]);
      const afterDelete = await api("GET", "/api/violations", l.cookie), meAfter = await api("GET", "/api/me", l.cookie);
      const pageAfter = await (await fetch(`${BASE}/violations`, { headers: { cookie: l.cookie! } })).text();
      record("A deleted user's token stops working", "before: 200/200; after the user is deleted: 401 on the API, /api/me and the page", `${before.status}/${meBefore.status} -> ${afterDelete.status}, ${meAfter.status}, page denied=${pageAfter.includes("Access denied")}`,
        before.status === 200 && meBefore.status === 200 && afterDelete.status === 401 && meAfter.status === 401 && pageAfter.includes("Access denied"));
    }
    {
      const w = await makeUser("warden", "revoke2");
      created.push(w.id);
      const l = await login(w.email, w.password, freshIp());
      const ok = await api("GET", "/api/violations", l.cookie);
      await pool.query("UPDATE users SET token_version = token_version + 1 WHERE user_id = $1", [w.id]);
      const stale = await api("GET", "/api/violations", l.cookie);
      const again = await login(w.email, w.password, freshIp());
      const fresh = await api("GET", "/api/violations", again.cookie);
      record("Bumping token_version invalidates old tokens", "200 -> 401 for the old token; a new login works (200)", `${ok.status} -> ${stale.status}; new login ${again.status}, ${fresh.status}`, ok.status === 200 && stale.status === 401 && again.status === 200 && fresh.status === 200);
      await pool.query("UPDATE users SET role = 'security' WHERE user_id = $1", [w.id]);
      const demoted = await api("GET", "/api/violations", again.cookie);
      record("A role change in the database takes effect at once", "the old warden token no longer works after the role changed (401)", `${demoted.status}`, demoted.status === 401);
    }
    {
      const w = await makeUser("warden", "revoke3");
      created.push(w.id);
      const l = await login(w.email, w.password, freshIp());
      const changed = await api("POST", "/api/account/password", l.cookie, { current: w.password, next: "A-Brand-New-Pw-77" });
      const newCookie = changed.setCookie?.match(/facetrack_session=([^;]+)/)?.[1];
      const oldNow = await api("GET", "/api/violations", l.cookie);
      const newNow = await api("GET", "/api/violations", newCookie ? `facetrack_session=${newCookie}` : null);
      record("A password change signs out other sessions but keeps this one", "change 200; old token 401; the new cookie from the response works (200)", `${changed.status}; old ${oldNow.status}; new ${newNow.status}`, changed.status === 200 && oldNow.status === 401 && newNow.status === 200);
    }
    {
      const target = await makeUser("warden", "revoke4");
      created.push(target.id);
      const l = await login(target.email, target.password, freshIp());
      const asWarden = await api("POST", `/api/admin/users/${target.id}/signout`, wardenC);
      const stillOk = await api("GET", "/api/violations", l.cookie);
      const asAdmin = await api("POST", `/api/admin/users/${target.id}/signout`, adminC);
      const gone = await api("GET", "/api/violations", l.cookie);
      const relogin = await login(target.email, target.password, freshIp());
      const missing = await api("POST", "/api/admin/users/99999/signout", adminC);
      const anon = await api("POST", `/api/admin/users/${target.id}/signout`, null);
      record("Admin 'Sign out everywhere'", "warden 403 (token still works); admin 200 (token 401); signing in again works; unknown user 404; anonymous 401",
        `${asWarden.status} (${stillOk.status}); ${asAdmin.status} (${gone.status}); relogin ${relogin.status}; ${missing.status}; ${anon.status}`,
        asWarden.status === 403 && stillOk.status === 200 && asAdmin.status === 200 && gone.status === 401 && relogin.status === 200 && missing.status === 404 && anon.status === 401);
    }
    {
      const forged = await new SignJWT({ role: "admin", tv: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject("999999").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET ?? ""));
      const r = await api("GET", "/api/violations", `facetrack_session=${forged}`);
      record("A correctly signed token for a user that does not exist", "401 (it was 200 before revocation existed)", `${r.status}`, r.status === 401);
    }

    // ================= page-level access =================
    {
      const parentC = parentC1;
      const staff = (await login("security1@facetrack.test", PW, freshIp())).cookie!;
      const who: [string, string | null][] = [["student", studentC], ["parent", parentC], ["warden", wardenC], ["security", staff], ["admin", adminC], ["anonymous", null]];
      const pages: [string, string[]][] = [["/violations", ["student", "parent", "warden", "admin"]], ["/student/leave", ["student"]], ["/parent/leave", ["parent"]], ["/student/history", ["student"]]];
      const wrong: string[] = [];
      for (const [path, allowed] of pages) {
        for (const [name, c] of who) {
          const html = await (await fetch(`${BASE}${path}`, { headers: c ? { cookie: c } : {} })).text();
          const denied = html.includes("Access denied");
          if (denied === allowed.includes(name)) wrong.push(`${path} as ${name}: ${denied ? "denied" : "open"}`);
        }
      }
      record("Pages show 'Access denied' for the wrong role", "/violations, /student/leave, /parent/leave, /student/history: 24 role/page combinations as designed", wrong.length ? `wrong: ${wrong.join("; ")}` : "24/24 as designed", wrong.length === 0);
    }

    // ================= leave cancellation =================
    {
      const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), in31 = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
      const mk = async () => (await api("POST", "/api/leave", studentC, { startDate: in30, endDate: in31, reason: "Cancellation test request" })).json.request?.id as number;
      const idA = await mk();
      const listBefore = (await api("GET", "/api/leave", studentC)).json.requests.map((r: Json) => r.id);
      const cancel = await api("DELETE", `/api/leave/${idA}`, studentC);
      const listAfter = (await api("GET", "/api/leave", studentC)).json.requests.map((r: Json) => r.id);
      record("A student cancels their own pending request", "200, then it is gone from the list", `${cancel.status}; listed before ${listBefore.includes(idA)}, after ${listAfter.includes(idA)}`, cancel.status === 200 && listBefore.includes(idA) && !listAfter.includes(idA));
      const again = await api("DELETE", `/api/leave/${idA}`, studentC);
      record("Cancelling twice", "404 (it no longer exists)", `${again.status}`, again.status === 404);

      const idB = await mk();
      const otherStudent = (await login("karthik.r@facetrack.test", PW, freshIp())).cookie!;
      const theirs = await api("DELETE", `/api/leave/${idB}`, otherStudent);
      const stillThere = Number((await pool.query("SELECT count(*) AS n FROM leave_requests WHERE leave_id = $1", [idB])).rows[0].n);
      record("Another student cannot cancel it", "404 and the request still exists", `${theirs.status}, rows ${stillThere}`, theirs.status === 404 && stillThere === 1);
      const asParent = await api("DELETE", `/api/leave/${idB}`, parentC1), asWarden = await api("DELETE", `/api/leave/${idB}`, wardenC), asAnon = await api("DELETE", `/api/leave/${idB}`, null);
      record("Parents, wardens and anonymous callers cannot cancel", "403, 403, 401", `${asParent.status}, ${asWarden.status}, ${asAnon.status}`, asParent.status === 403 && asWarden.status === 403 && asAnon.status === 401);

      // decided requests are final: approve idB as the right parent, then try to cancel
      const parentOfArun = parentC1;
      const approve = await api("POST", `/api/leave/${idB}/decide`, parentOfArun, { decision: "approved" });
      const late = await api("DELETE", `/api/leave/${idB}`, studentC);
      record("A decided request cannot be cancelled", "approve 200, then cancel 409 and the row remains approved", `${approve.status}, ${late.status} ${late.json.error ?? ""}`, approve.status === 200 && late.status === 409 &&
        (await pool.query("SELECT status FROM leave_requests WHERE leave_id = $1", [idB])).rows[0]?.status === "approved");
      await pool.query("DELETE FROM leave_requests WHERE leave_id = $1", [idB]); // test cleanup (the app never deletes a decided request)
      const seededApproved = await api("DELETE", "/api/leave/1", studentC);
      const seededRejected = await api("DELETE", "/api/leave/4", (await login("rahul.v@facetrack.test", PW, freshIp())).cookie);
      const kept = Number((await pool.query("SELECT count(*) AS n FROM leave_requests WHERE leave_id IN (1, 4)")).rows[0].n);
      record("Seeded approved and rejected requests survive a cancel attempt", "409 and 409, both rows still there", `${seededApproved.status}, ${seededRejected.status}, rows ${kept}`, seededApproved.status === 409 && seededRejected.status === 409 && kept === 2);
      const nope = await api("DELETE", "/api/leave/99999", studentC), bad = await api("DELETE", "/api/leave/abc", studentC);
      record("Unknown and invalid ids", "404 and 400", `${nope.status}, ${bad.status}`, nope.status === 404 && bad.status === 400);
    }

    // ================= violations.resolved_at =================
    {
      const vid = 1;
      const before = (await pool.query("SELECT status, resolved_at FROM violations WHERE violation_id = $1", [vid])).rows[0];
      const asStudent = await api("POST", `/api/violations/${vid}/resolve`, studentC);
      const res = await api("POST", `/api/violations/${vid}/resolve`, wardenC);
      const row = (await pool.query("SELECT status, resolved_by, resolved_at, extract(epoch FROM (localtimestamp - resolved_at)) AS age FROM violations WHERE violation_id = $1", [vid])).rows[0];
      const listed = (await api("GET", "/api/violations?status=resolved", wardenC)).json.violations.find((v: Json) => v.id === vid);
      const twice = await api("POST", `/api/violations/${vid}/resolve`, wardenC);
      record("Resolving a violation records resolved_at", "student 403; warden 200; resolved_at is now; the list shows resolvedAt; a second resolve is 409",
        `${asStudent.status}; ${res.status}; age ${Number(row?.age).toFixed(0)} s; listed ${listed?.resolvedAt}; again ${twice.status}`,
        before.status === "open" && before.resolved_at === null && asStudent.status === 403 && res.status === 200 && row.status === "resolved" && row.resolved_at !== null && Number(row.age) >= 0 && Number(row.age) < 60 && !!listed?.resolvedAt && twice.status === 409);
      await pool.query("UPDATE violations SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE violation_id = $1", [vid]); // restore the seed row
    }
  } finally {
    for (const id of created) await pool.query("DELETE FROM users WHERE user_id = $1", [id]).catch(() => {});
    await pool.query("DELETE FROM login_attempts WHERE email LIKE $1 OR email = ANY($2::text[]) OR ip LIKE '203.0.113.%'", [`${TAG}.%`, [...emailsUsed]]);
  }

  console.log("| Case | Expected | Actual | Result |\n|---|---|---|---|");
  console.log(rows.join("\n"));
  console.log(`\n${rows.length - failures}/${rows.length} passed`);
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test-hardening crashed:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
