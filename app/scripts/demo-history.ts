// Fills realistic PAST activity for the students that exist, so the reports have something to show.
//   npm run demo:history -- --days 30 --yes
// Everything is GENERATED, simulated data. It is labelled as such in b_meta (key
// 'generated_history'), and /reports shows "Includes generated demo history" while it exists.
//
// How: for each past day it creates a roll call per hostel, then writes face events with
// controlled timestamps and calls the real procedures (mark_attendance, record_entry_exit,
// close_attendance_session), so every trigger and constraint runs. Violations are therefore raised
// by the real rules (curfew 22:30, exit after 20:00 without leave, missed roll call).
// Two things cannot go through a procedure and are written directly, and are honest about it:
//   * past leave requests (decide_leave refuses leave that already ended) are inserted as decided;
//   * violations get raised_at set to the time of the event that caused them (the procedures use now()),
//     and about two thirds of the older ones are marked resolved by a warden.
// Refuses with fewer than 4 students, and when generated history already exists.
// The label stores the range of face_events ids it created; /reports shows the note only while events
// in that range still exist, so it disappears by itself if the records are cleared.
import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { prng } from "./synthetic";

const args = process.argv.slice(2);
const daysArg = args.indexOf("--days");
const DAYS = daysArg >= 0 ? Number(args[daysArg + 1]) : 30;
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 120) {
  console.error("--days must be a whole number from 1 to 120");
  process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (day: string, minutes: number, seconds = 0) => `${day} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds)}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const asMs = (ts: string) => Date.parse(`${ts.replace(" ", "T")}Z`);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday

interface Student { id: number; hostelId: number; name: string; attendProb: number; lateProb: number; lateOutProb: number; outingProb: number; lastMs: number; lastDir: string | null; parentId: number | null }
interface Leave { from: string; to: string }

async function main() {
  const pool = getPool();
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows;

  const [{ n: studentCount }] = await q<{ n: string }>("SELECT count(*) AS n FROM students");
  if (Number(studentCount) < 4) {
    console.error(`Only ${studentCount} student(s) exist. Demo history needs at least 4: register more students (Admin > Students) or load the sample data, then run this again.`);
    process.exit(1);
  }
  const [{ ok: hasMeta }] = await q<{ ok: boolean }>("SELECT to_regclass('b_meta') IS NOT NULL AS ok");
  if (!hasMeta) {
    console.error("The table b_meta is missing. Run ./db/load_b.sh first (it creates it).");
    process.exit(1);
  }
  const existing = await q<{ value: string }>("SELECT value FROM b_meta WHERE key = 'generated_history'");
  if (existing[0]) {
    console.error(`Generated history already exists (${existing[0].value}). Running it twice would collide with itself. Use npm run demo:clear -- --yes to start over.`);
    process.exit(1);
  }

  const today = (await q<{ d: string }>("SELECT to_char(current_date, 'YYYY-MM-DD') AS d"))[0].d;
  const firstDay = addDays(today, -DAYS);
  const lastDay = addDays(today, -1);

  const rand = prng(20261027 + DAYS);
  const r = (a: number, b: number) => a + rand() * (b - a);
  const ri = (a: number, b: number) => Math.floor(r(a, b + 1));
  const chance = (p: number) => rand() < p;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  // cameras per hostel (active ones, with their gate)
  const cams = await q<{ camera_id: number; gate_id: number; hostel_id: number }>(
    `SELECT c.camera_id, c.gate_id, g.hostel_id FROM cameras c JOIN gates g ON g.gate_id = c.gate_id WHERE c.status = 'active' ORDER BY c.camera_id`,
  );
  const camsOf = (h: number) => cams.filter((c) => c.hostel_id === h);
  const wardenId = (await q<{ user_id: number }>("SELECT user_id FROM users WHERE role = 'warden' ORDER BY user_id LIMIT 1"))[0]?.user_id ?? null;

  const rows = await q<{ student_id: number; hostel_id: number; name: string; parent_id: number | null }>(
    `SELECT s.student_id, s.hostel_id, s.name, (SELECT min(parent_id) FROM student_parent sp WHERE sp.student_id = s.student_id) AS parent_id
     FROM students s ORDER BY s.student_id`,
  );
  const students: Student[] = [];
  for (const [i, s] of rows.entries()) {
    if (camsOf(s.hostel_id).length === 0) continue; // nowhere to scan this student
    const last = (await q<{ t: string; direction: string }>("SELECT to_char(event_time, 'YYYY-MM-DD HH24:MI:SS') AS t, direction FROM entry_exit_log WHERE student_id = $1 ORDER BY event_time DESC, log_id DESC LIMIT 1", [s.student_id]))[0];
    students.push({
      id: s.student_id, hostelId: s.hostel_id, name: s.name, parentId: s.parent_id,
      // the first student is made a poor attender and the second a frequent late returner, so the reports have something to show
      attendProb: i === 0 ? 0.55 : r(0.78, 0.98), lateProb: i === 1 ? 0.22 : r(0.01, 0.08), lateOutProb: r(0.0, 0.05), outingProb: r(0.45, 0.8),
      lastMs: last ? asMs(last.t) : -Infinity, lastDir: last?.direction ?? null,
    });
  }
  if (students.length < 4) {
    console.error("Fewer than 4 students have a hostel with an active camera. Nothing was generated.");
    process.exit(1);
  }

  const client: PoolClient = await pool.connect();
  const maxOf = async (t: string, c: string) => Number((await client.query(`SELECT COALESCE(max(${c}), 0) AS n FROM ${t}`)).rows[0].n);
  const stats = { sessions: 0, marks: 0, gateEvents: 0, faceEvents: 0, leaves: 0, closedAbsent: 0, violationsFromClose: 0 };

  // a failed procedure call must not abort the whole run: run each in a savepoint
  async function tryCall(sql: string, params: unknown[]): Promise<boolean> {
    await client.query("SAVEPOINT s");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT s");
      return true;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT s");
      return false;
    }
  }
  async function faceEvent(cameraId: number, studentId: number | null, confidence: number, outcome: string, ts: string, reviewedBy: number | null = null): Promise<number> {
    const { rows: ev } = await client.query<{ event_id: number }>(
      "INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time, reviewed_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING event_id",
      [cameraId, studentId, Math.round(confidence * 1000) / 1000, outcome, ts, reviewedBy],
    );
    stats.faceEvents++;
    return ev[0].event_id;
  }
  const matchedSim = () => Math.min(0.97, Math.max(0.5, 0.74 + 0.11 * (rand() + rand() + rand() - 1.5) * 2));

  try {
    await client.query("BEGIN");
    const before = { violation: await maxOf("violations", "violation_id"), event: await maxOf("face_events", "event_id") };

    // ---- leave requests (decided in the past, so inserted directly; see the header) ----
    const leaves = new Map<number, Leave[]>();
    const occupied = new Map<number, Leave[]>();
    for (const l of await q<{ student_id: number; s: string; e: string }>("SELECT student_id, to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e FROM leave_requests WHERE status = 'approved'")) {
      occupied.set(l.student_id, [...(occupied.get(l.student_id) ?? []), { from: l.s, to: l.e }]);
    }
    const reasons = ["Family wedding at home", "Medical check-up with family doctor", "Festival holidays at home", "Cousin's engagement function", "Sibling's school event", "Attending a relative's housewarming"];
    for (const s of students) {
      if (!s.parentId || !chance(0.6) || DAYS < 8) continue;
      const count = chance(0.35) ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const start = addDays(firstDay, ri(3, Math.max(3, DAYS - 4)));
        const end = addDays(start, ri(0, 2));
        if (end > lastDay) continue;
        const clash = (occupied.get(s.id) ?? []).some((o) => start <= o.to && end >= o.from);
        if (clash) continue;
        const approved = chance(0.75);
        await client.query(
          `INSERT INTO leave_requests (student_id, start_date, end_date, reason, status, decided_by, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [s.id, start, end, pick(reasons), approved ? "approved" : "rejected", s.parentId, stamp(addDays(start, -ri(1, 3)), ri(9 * 60, 18 * 60))],
        );
        stats.leaves++;
        if (approved) {
          leaves.set(s.id, [...(leaves.get(s.id) ?? []), { from: start, to: end }]);
          occupied.set(s.id, [...(occupied.get(s.id) ?? []), { from: start, to: end }]);
        }
      }
    }
    // two pending requests for the coming days (normal workflow: a parent can still decide them)
    for (const s of students.slice(2, 4)) {
      if (!s.parentId) continue;
      const start = addDays(today, ri(2, 4));
      await client.query("INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4)", [s.id, start, addDays(start, 1), pick(reasons)]);
      stats.leaves++;
    }
    const onLeave = (id: number, day: string) => (leaves.get(id) ?? []).some((l) => day >= l.from && day <= l.to);

    // ---- day by day, oldest first (the gate trigger needs events in time order) ----
    const sessionIds: number[] = [];
    for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
      const sessionOf = new Map<number, number>();
      for (const h of new Set(students.map((s) => s.hostelId))) {
        const { rows: sess } = await client.query<{ session_id: number }>(
          `INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES ($1, $2, '20:30', '21:00')
           ON CONFLICT (hostel_id, session_date, start_time) DO UPDATE SET end_time = EXCLUDED.end_time RETURNING session_id`,
          [h, day],
        );
        sessionOf.set(h, sess[0].session_id);
        sessionIds.push(sess[0].session_id);
        stats.sessions++;
      }
      const weekend = dow(day) === 0 || dow(day) === 6;

      for (const s of students) {
        const cam = pick(camsOf(s.hostelId));
        let outDuringRollCall = false;

        const emit = async (minutes: number, direction: "IN" | "OUT"): Promise<boolean> => {
          const ts = stamp(day, minutes, ri(0, 59));
          if (asMs(ts) <= s.lastMs || direction === s.lastDir) return false;
          const evId = await faceEvent(cam.camera_id, s.id, matchedSim(), "matched", ts);
          const ok = await tryCall("CALL record_entry_exit($1, $2, $3, $4, NULL, NULL)", [s.id, cam.gate_id, evId, direction]);
          if (ok) {
            s.lastMs = asMs(ts);
            s.lastDir = direction;
            stats.gateEvents++;
          }
          return ok;
        };

        // a student still marked OUT from earlier comes back in the morning first
        if (s.lastDir === "OUT") await emit(ri(6 * 60, 9 * 60), "IN");

        if (chance(weekend ? s.outingProb + 0.15 : s.outingProb)) {
          if (chance(s.lateOutProb)) {
            // leaves after 20:00 (no_leave unless on approved leave), back before the curfew
            const out = ri(20 * 60 + 5, 21 * 60 + 20);
            if (await emit(out, "OUT")) {
              outDuringRollCall = out < 21 * 60;
              await emit(ri(21 * 60 + 45, 22 * 60 + 25), "IN");
            }
          } else {
            const out = ri(8 * 60 + 30, 16 * 60 + 30);
            if (await emit(out, "OUT")) {
              if (chance(s.lateProb)) await emit(ri(22 * 60 + 35, 23 * 60 + 55), "IN"); // late_return
              else await emit(Math.min(21 * 60 + 30, out + ri(60, 9 * 60)), "IN");
            }
          }
        }
        // sometimes the camera is unsure about a student at the gate: a review-band event, no gate log
        if (chance(0.05)) {
          const reviewed = chance(0.5);
          await faceEvent(cam.camera_id, s.id, r(0.36, 0.49), "low_confidence", stamp(day, ri(7 * 60, 21 * 60), ri(0, 59)), reviewed ? wardenId : null);
        }

        // roll call
        if (!onLeave(s.id, day) && !outDuringRollCall && chance(s.attendProb)) {
          const low = chance(0.07);
          const evId = await faceEvent(cam.camera_id, s.id, low ? r(0.36, 0.49) : matchedSim(), low ? "low_confidence" : "matched", stamp(day, ri(20 * 60 + 31, 20 * 60 + 58), ri(0, 59)));
          if (await tryCall("CALL mark_attendance($1, $2, $3, NULL)", [s.id, sessionOf.get(s.hostelId), evId])) stats.marks++;
        }
      }
      // a stranger or two walks past each gate camera
      for (const h of new Set(students.map((s) => s.hostelId))) {
        for (let k = ri(0, 2); k > 0; k--) await faceEvent(pick(camsOf(h)).camera_id, null, r(0.05, 0.33), "no_match", stamp(day, ri(7 * 60, 22 * 60), ri(0, 59)));
      }
    }

    // ---- close every generated roll call with the real procedure ----
    for (const id of [...new Set(sessionIds)]) {
      await client.query("SAVEPOINT c");
      try {
        const { rows: res } = await client.query<{ p_absent: number; p_violations: number }>("CALL close_attendance_session($1, NULL, NULL)", [id]);
        stats.closedAbsent += Number(res[0].p_absent);
        stats.violationsFromClose += Number(res[0].p_violations);
        await client.query("RELEASE SAVEPOINT c");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT c");
      }
    }

    // ---- violations: date them by the event that caused them, resolve most of the older ones ----
    await client.query(
      `UPDATE violations v SET raised_at = l.event_time FROM entry_exit_log l
       WHERE v.log_id = l.log_id AND v.violation_id > $1`, [before.violation]);
    await client.query(
      `UPDATE violations v SET raised_at = s.session_date + s.end_time FROM attendance_sessions s
       WHERE v.session_id = s.session_id AND v.log_id IS NULL AND v.violation_id > $1`, [before.violation]);
    let resolved = 0;
    if (wardenId !== null) {
      const old = await client.query<{ violation_id: number }>("SELECT violation_id FROM violations WHERE violation_id > $1 AND raised_at < $2::date - 7 ORDER BY violation_id", [before.violation, today]);
      for (const v of old.rows) {
        if (chance(0.65)) {
          // resolved_at is set to a believable time after the violation was raised (1 to 36 hours)
          await client.query("UPDATE violations SET status = 'resolved', resolved_by = $2, resolved_at = raised_at + make_interval(mins => $3::int) WHERE violation_id = $1", [v.violation_id, wardenId, ri(60, 36 * 60)]);
          resolved++;
        }
      }
    }
    const newViolations = Number((await client.query("SELECT count(*) AS n FROM violations WHERE violation_id > $1", [before.violation])).rows[0].n);

    const label = { days: DAYS, from: firstDay, to: lastDay, students: students.length, generated_at: today, first_event_id: before.event + 1, last_event_id: await maxOf("face_events", "event_id"), note: "simulated data" };
    await client.query("INSERT INTO b_meta (key, value) VALUES ('generated_history', $1)", [JSON.stringify(label)]);
    await client.query("COMMIT");

    console.log(`Generated demo history for ${students.length} students, ${firstDay} to ${lastDay} (${DAYS} days). This is SIMULATED data.`);
    console.log(`  roll calls: ${stats.sessions}, present/low-confidence marks via mark_attendance: ${stats.marks}, marked absent when closing: ${stats.closedAbsent}`);
    console.log(`  gate crossings via record_entry_exit: ${stats.gateEvents}, face events: ${stats.faceEvents}, leave requests: ${stats.leaves}`);
    console.log(`  violations raised: ${newViolations} (${stats.violationsFromClose} from closing roll calls), resolved by the warden: ${resolved}`);
    console.log("Open /reports: it shows a note that generated history is included.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
}

if (!args.includes("--yes")) {
  console.log(`demo:history would add about ${DAYS} days of SIMULATED attendance, gate crossings, face scans, leave requests and violations for the existing students.`);
  console.log("It cannot be undone except by clearing the students and their records (npm run demo:clear -- --yes, where available).");
  console.log("Nothing was changed. Run again with --yes to generate it.");
  process.exit(1);
}

main().catch((e) => {
  console.error("demo:history failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
