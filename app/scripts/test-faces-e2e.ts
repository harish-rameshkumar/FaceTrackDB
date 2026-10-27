// End-to-end test through the real HTTP API with real face photos: enrol (5 images),
// duplicate guard, scan (3 images), quality gate, multiple faces. Needs the embedder
// and a dev/production server.
//   npm run test:faces -- <folder>      (same folder layout as faces:eval; at least 4 people
//                                        with 8+ photos each; the first 5 photos of a person
//                                        are used to enrol, the next 3 to scan)
// People are mapped to the seeded students 1..4 in alphabetical order.
// SAFETY: it enrols real embeddings into face_profiles and Qdrant, so it only runs
// against a scratch/test database. It removes what it created.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { getPool } from "../lib/db";
import { assertTestEnvironment } from "./synthetic";
import { COLLECTION } from "../lib/qdrant";

assertTestEnvironment(COLLECTION, { requireTestCollection: false });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results: string[] = [];
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  results.push(`| ${name} | ${detail} | ${ok ? "PASS" : "FAIL"} |`);
};

// a valid 1x1 white PNG: decodes fine, contains no face
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function mime(file: string): string {
  return extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const c = res.headers.get("set-cookie");
  if (!res.ok || !c) throw new Error(`login failed for ${email}`);
  return c.split(";")[0];
}

function form(fields: Record<string, string>, images: { data: Buffer; type: string }[]): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  images.forEach((im, i) => f.append("frames", new Blob([new Uint8Array(im.data)], { type: im.type }), `f${i}`));
  return f;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error("Usage: npm run test:faces -- <folder>");
  const root = resolve(folder);
  const people = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort();
  if (people.length < 4) throw new Error("Need at least 4 person folders");
  const photos = people.slice(0, 5).map((p) =>
    readdirSync(join(root, p)).filter((f) => [".jpg", ".jpeg", ".png"].includes(extname(f).toLowerCase())).sort()
      .map((f) => ({ data: readFileSync(join(root, p, f)), type: mime(f) })),
  );
  if (photos.slice(0, 4).some((x) => x.length < 8)) throw new Error("Each of the first 4 people needs 8+ photos");

  const dbDir = resolve(process.cwd(), "..", "db");
  const seed = readFileSync(join(dbDir, "seed.sql"), "utf8");
  const demo = readFileSync(join(dbDir, "demo_passwords.sql"), "utf8");
  const pw = process.env.TEST_PASSWORD ?? /Password for all accounts:\s+(\S+)/.exec(demo)?.[1];
  const email = (role: string) => new RegExp(`'([^']+@[^']+)'[^)\\n]*'${role}'\\)`).exec(seed)![1];
  if (!pw) throw new Error("demo password not found");
  const admin = await login(email("admin"), pw);
  const security = await login(email("security"), pw);

  const pool = getPool();
  const maxEvent = Number((await pool.query("SELECT COALESCE(max(event_id),0) AS n FROM face_events")).rows[0].n);
  const maxLog = Number((await pool.query("SELECT COALESCE(max(log_id),0) AS n FROM entry_exit_log")).rows[0].n);
  const maxViolation = Number((await pool.query("SELECT COALESCE(max(violation_id),0) AS n FROM violations")).rows[0].n);
  const enrolled: number[] = [];

  try {
    // enrol persons 1..4 as students 1..4 (a student with no samples yet)
    // start clean through the API, so PostgreSQL and Qdrant stay in step
    for (const r of (await pool.query("SELECT profile_id FROM face_profiles WHERE student_id BETWEEN 1 AND 4")).rows) {
      await fetch(`${BASE}/api/faces/${r.profile_id}`, { method: "DELETE", headers: { cookie: admin } });
    }
    for (let k = 0; k < 4; k++) {
      const res = await fetch(`${BASE}/api/faces/enrol`, { method: "POST", headers: { cookie: admin }, body: form({ student_id: String(k + 1) }, photos[k].slice(0, 5)) });
      const j = await res.json();
      check(`Enrol ${people[k]} as student ${k + 1}`, res.status === 201 && j.profiles?.length === 5, `HTTP ${res.status} ${res.status === 201 ? `${j.profiles.length} samples` : JSON.stringify(j).slice(0, 160)}`);
      for (const p of j.profiles ?? []) enrolled.push(p.faceProfileId);
    }

    // duplicate guard: person 1's photos offered for student 5
    const dup = await fetch(`${BASE}/api/faces/enrol`, { method: "POST", headers: { cookie: admin }, body: form({ student_id: "5" }, photos[0].slice(0, 5)) });
    const dj = await dup.json();
    check("Duplicate-face guard", dup.status === 409 && /^This face already matches .+ \(.+\)$/.test(dj.error ?? ""), `HTTP ${dup.status} ${dj.error}`);

    // quality gate on enrol: a blank image in the batch -> 422 naming the frame, nothing saved
    const bad = await fetch(`${BASE}/api/faces/enrol`, { method: "POST", headers: { cookie: admin }, body: form({ student_id: "6" }, [...photos[4].slice(0, 4), { data: BLANK_PNG, type: "image/png" }]) });
    const bj = await bad.json();
    const failed = (bj.frames ?? []).filter((f: { ok: boolean }) => !f.ok);
    check("Enrol rejects an unusable frame", bad.status === 422 && failed.length === 1 && failed[0].index === 4 && failed[0].code === "no_face", `HTTP ${bad.status} ${JSON.stringify(failed)}`);

    // scans: photos 5..7 of each enrolled person at a camera of the student's own hostel, gate in/out
    const cameraOf = async (studentId: number) =>
      String((await pool.query("SELECT min(c.camera_id) AS id FROM cameras c JOIN gates g ON g.gate_id = c.gate_id JOIN students s ON s.hostel_id = g.hostel_id WHERE s.student_id = $1 AND c.status = 'active'", [studentId])).rows[0].id);
    for (let k = 0; k < 4; k++) {
      const res = await fetch(`${BASE}/api/faces/match`, { method: "POST", headers: { cookie: security }, body: form({ camera_id: await cameraOf(k + 1), purpose: "entry_exit" }, photos[k].slice(5, 8)) });
      const j = await res.json();
      check(`Scan ${people[k]}`, res.status === 200 && j.outcome === "matched" && j.student?.student_id === k + 1,
        `HTTP ${res.status} ${j.outcome} student=${j.student?.student_id} similarity=${j.similarity?.toFixed?.(3)} margin=${j.margin?.toFixed?.(3)} frames=${j.frames?.agreeing}/${j.frames?.usable}`);
    }
    // a person who is not enrolled must not be matched
    if (photos[4]) {
      const res = await fetch(`${BASE}/api/faces/match`, { method: "POST", headers: { cookie: security }, body: form({ camera_id: "4", purpose: "entry_exit" }, photos[4].slice(5, 8)) });
      const j = await res.json();
      check("Scan an unenrolled person", res.status === 200 && j.outcome !== "matched", `HTTP ${res.status} ${j.outcome} similarity=${j.similarity?.toFixed?.(3)}`);
    }
    // quality gate on scan
    const blank = await fetch(`${BASE}/api/faces/match`, { method: "POST", headers: { cookie: security }, body: form({ camera_id: "4", purpose: "entry_exit" }, [BLANK_PNG, BLANK_PNG, BLANK_PNG].map((data) => ({ data, type: "image/png" }))) });
    const blj = await blank.json();
    check("Scan with no face", blank.status === 422 && blj.quality === "no_face" && blj.error === "No face found. Face the camera in good light.", `HTTP ${blank.status} ${JSON.stringify(blj)}`);
    const events = Number((await pool.query("SELECT count(*) AS n FROM face_events WHERE event_id > $1", [maxEvent])).rows[0].n);
    check("Unusable scans log nothing", events === 4 + (photos[4] ? 1 : 0), `${events} face events since the start (expected ${4 + (photos[4] ? 1 : 0)})`);
  } finally {
    for (const id of enrolled) await fetch(`${BASE}/api/faces/${id}`, { method: "DELETE", headers: { cookie: admin } });
    await pool.query("DELETE FROM violations WHERE violation_id > $1", [maxViolation]);
    await pool.query("DELETE FROM entry_exit_log WHERE log_id > $1", [maxLog]);
    await pool.query("DELETE FROM face_events WHERE event_id > $1", [maxEvent]);
  }
  console.log("| Case | Result detail | |\n|---|---|---|\n" + results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test-faces-e2e failed:", e instanceof Error ? e.message : e);
  process.exit(2);
});
