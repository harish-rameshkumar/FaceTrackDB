// The generator behind `npm run demo:seed` and `npm run demo:history`: fills realistic PAST activity
// for the students that exist, so the reports, slides and dashboard have something to show.
//
// Everything it writes is SIMULATED and labelled so:
//   * every row it creates directly (roll calls, face events, gate log rows, leave requests) has its id
//     recorded in b_demo_rows, and rows the procedures derive from them (attendance marks, violations)
//     are found again through those; demo_reset() removes exactly that set;
//   * b_meta key 'generated_history' makes /reports show "Includes generated demo history".
// It calls the real procedures (mark_attendance, record_entry_exit, close_attendance_session) with
// controlled timestamps, so every trigger and constraint runs. Two things cannot go through a
// procedure and are written directly: past leave requests (decide_leave refuses leave that already
// ended) and violation dates (the procedures use now()).
// A student who CANCELS a pending leave request leaves no row behind (the app deletes it), so a
// "cancelled" request cannot exist in the data; cancel one live in /student/leave instead.
// It is deterministic: the same --seed and the same students on the same day give the same data
// (all randomness comes from one seeded generator; dates are relative to today).
import type { PoolClient } from "pg";
import { prng } from "../synthetic";

export interface HistoryOptions { days: number; seed: number; today: string }
export interface HistoryResult {
  stats: { sessions: number; marks: number; gateEvents: number; faceEvents: number; leaves: number; closedAbsent: number; violationsFromClose: number; violations: number; resolved: number; students: number };
  label: Record<string, unknown>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (day: string, minutes: number, seconds = 0) => `${day} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds)}`;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const asMs = (ts: string) => Date.parse(`${ts.replace(" ", "T")}Z`);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday ... 6 = Saturday

const LEAVE_REASONS = [
  "Family wedding at home", "Medical check-up with the family doctor", "Festival holidays at home", "Cousin's engagement function",
  "Sibling's school annual day", "Attending a relative's housewarming", "Grandparent's health, visiting hospital", "Sister's college admission counselling",
  "Pongal celebrations with family", "Passport appointment in the city", "Temple festival in our village", "Dental treatment, appointment booked",
  "Uncle's retirement function", "Attending a cousin's convocation", "Fever, going home to recover", "Family pilgrimage trip",
];

interface Student {
  id: number; hostelId: number; name: string; parentId: number | null; lastMs: number; lastDir: string | null;
  attendProb: number; lateProb: number; lateOutProb: number; outingProb: number;
}
interface Leave { from: string; to: string }

export async function generateHistory(client: PoolClient, opts: HistoryOptions): Promise<HistoryResult> {
  const { days: DAYS, today } = opts;
  const firstDay = addDays(today, -DAYS);
  const lastDay = addDays(today, -1);
  const rand = prng(opts.seed);
  const r = (a: number, b: number) => a + rand() * (b - a);
  const ri = (a: number, b: number) => Math.floor(r(a, b + 1));
  const chance = (p: number) => rand() < p;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await client.query<T>(sql, p)).rows;
  const track = (kind: string, id: number) => client.query("INSERT INTO b_demo_rows (kind, row_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [kind, id]);

  const cams = await q<{ camera_id: number; gate_id: number; hostel_id: number }>(
    `SELECT c.camera_id, c.gate_id, g.hostel_id FROM cameras c JOIN gates g ON g.gate_id = c.gate_id WHERE c.status = 'active' ORDER BY c.camera_id`,
  );
  const camsOf = (h: number) => cams.filter((c) => c.hostel_id === h);
  const wardenId = (await q<{ user_id: number }>("SELECT user_id FROM users WHERE role = 'warden' ORDER BY user_id LIMIT 1"))[0]?.user_id ?? null;

  const rows = await q<{ student_id: number; hostel_id: number; name: string; parent_id: number | null }>(
    `SELECT s.student_id, s.hostel_id, s.name, (SELECT min(parent_id) FROM student_parent sp WHERE sp.student_id = s.student_id) AS parent_id
     FROM students s ORDER BY s.student_id`,
  );
  const eligible = rows.filter((s) => camsOf(s.hostel_id).length > 0); // nowhere to scan the others

  // ---- who is who: a spread of attendance and lateness, decided once from the seed ----
  const order = eligible.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rank = new Map(order.map((idx, pos) => [idx, pos])); // student index -> position in a seeded shuffle
  const nPoor = Math.max(1, Math.round(eligible.length * 0.1)), nMid = Math.max(1, Math.round(eligible.length * 0.1));
  const nOwls = Math.max(1, Math.round(eligible.length * 0.15)), nSneak = Math.max(1, Math.round(eligible.length * 0.12));
  const students: Student[] = [];
  for (const [i, s] of eligible.entries()) {
    const pos = rank.get(i)!;
    const last = (await q<{ t: string; direction: string }>("SELECT to_char(event_time, 'YYYY-MM-DD HH24:MI:SS') AS t, direction FROM entry_exit_log WHERE student_id = $1 ORDER BY event_time DESC, log_id DESC LIMIT 1", [s.student_id]))[0];
    students.push({
      id: s.student_id, hostelId: s.hostel_id, name: s.name, parentId: s.parent_id, lastMs: last ? asMs(last.t) : -Infinity, lastDir: last?.direction ?? null,
      attendProb: pos < nPoor ? r(0.6, 0.74) : pos < nPoor + nMid ? r(0.86, 0.92) : r(0.95, 0.995),
      // "night owls" often come back after curfew; a few leave in the evening without leave
      lateProb: pos % eligible.length < nOwls ? r(0.14, 0.26) : r(0.01, 0.05),
      lateOutProb: (pos + 3) % eligible.length < nSneak ? r(0.06, 0.12) : r(0, 0.02),
      outingProb: r(0.35, 0.65),
    });
  }

  // two "festival nights" when many students come back late, and one week with poor lighting at the gate
  const clusterDays = new Set<string>();
  for (let k = 0; k < 2 && DAYS >= 10; k++) clusterDays.add(addDays(firstDay, ri(4, DAYS - 3)));
  const badWeek = Math.floor(DAYS / 7 / 2);
  const weekOf = (day: string) => Math.floor((asMs(`${day} 00:00:00`) - asMs(`${firstDay} 00:00:00`)) / (7 * 86_400_000));

  const stats = { sessions: 0, marks: 0, gateEvents: 0, faceEvents: 0, leaves: 0, closedAbsent: 0, violationsFromClose: 0, violations: 0, resolved: 0, students: students.length };

  async function tryCall<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T | null> {
    await client.query("SAVEPOINT s");
    try {
      const res = await client.query<T>(sql, params);
      await client.query("RELEASE SAVEPOINT s");
      return res.rows[0] ?? ({} as T);
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT s");
      return null;
    }
  }
  async function faceEvent(cameraId: number, studentId: number | null, confidence: number, outcome: string, ts: string, reviewedBy: number | null = null): Promise<number> {
    const { rows: ev } = await client.query<{ event_id: number }>(
      "INSERT INTO face_events (camera_id, student_id, confidence, outcome, event_time, reviewed_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING event_id",
      [cameraId, studentId, Math.round(confidence * 1000) / 1000, outcome, ts, reviewedBy],
    );
    await track("face_event", ev[0].event_id);
    stats.faceEvents++;
    return ev[0].event_id;
  }
  const simAt = (day: string) => Math.min(0.97, Math.max(0.5, (weekOf(day) === badWeek ? 0.64 : 0.76) + 0.11 * (rand() + rand() + rand() - 1.5) * 2));

  // ---- leave requests: approved and rejected in the past (inserted decided), pending for the coming days ----
  const leaves = new Map<number, Leave[]>();
  const occupied = new Map<number, Leave[]>();
  for (const l of await q<{ student_id: number; s: string; e: string }>("SELECT student_id, to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e FROM leave_requests WHERE status = 'approved'")) {
    occupied.set(l.student_id, [...(occupied.get(l.student_id) ?? []), { from: l.s, to: l.e }]);
  }
  let leaveNo = 0;
  for (const s of students) {
    if (!s.parentId || !chance(0.7) || DAYS < 8) continue;
    for (let k = 0, count = chance(0.4) ? 2 : 1; k < count; k++) {
      const start = addDays(firstDay, ri(3, Math.max(3, DAYS - 4)));
      const end = addDays(start, ri(0, 3));
      if (end > lastDay) continue;
      if ((occupied.get(s.id) ?? []).some((o) => start <= o.to && end >= o.from)) continue;
      const approved = leaveNo++ % 4 !== 3; // every fourth request is rejected, the rest approved
      const { rows: l } = await client.query<{ leave_id: number }>(
        `INSERT INTO leave_requests (student_id, start_date, end_date, reason, status, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING leave_id`,
        [s.id, start, end, pick(LEAVE_REASONS), approved ? "approved" : "rejected", s.parentId, stamp(addDays(start, -ri(1, 4)), ri(9 * 60, 19 * 60))],
      );
      await track("leave", l[0].leave_id);
      stats.leaves++;
      if (approved) {
        leaves.set(s.id, [...(leaves.get(s.id) ?? []), { from: start, to: end }]);
        occupied.set(s.id, [...(occupied.get(s.id) ?? []), { from: start, to: end }]);
      }
    }
  }
  // pending requests for the next days: a parent can still decide them (the warden sees them waiting)
  let pendingMade = 0;
  for (const s of students) {
    if (!s.parentId || pendingMade >= Math.max(2, Math.round(students.length * 0.25))) continue;
    const start = addDays(today, ri(0, 3)); // starting today or in the next days, so a report that ends today still counts them
    const { rows: l } = await client.query<{ leave_id: number }>("INSERT INTO leave_requests (student_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4) RETURNING leave_id", [s.id, start, addDays(start, ri(0, 2)), pick(LEAVE_REASONS)]);
    await track("leave", l[0].leave_id);
    stats.leaves++;
    pendingMade++;
  }
  const onLeave = (id: number, day: string) => (leaves.get(id) ?? []).some((l) => day >= l.from && day <= l.to);

  // ---- day by day, oldest first (the gate trigger needs events in time order) ----
  const sessionIds: number[] = [];
  const trackedLogs: number[] = [];
  const outTime = (weekend: boolean) => {
    // two daily peaks (morning and afternoon); weekends spread more
    const peak = chance(weekend ? 0.4 : 0.55) ? 9.5 * 60 : 15.5 * 60;
    return Math.min(17 * 60 + 30, Math.max(8 * 60, Math.round(peak + (rand() + rand() + rand() - 1.5) * (weekend ? 150 : 110))));
  };
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const sessionOf = new Map<number, number>();
    for (const h of new Set(students.map((s) => s.hostelId))) {
      const { rows: sess } = await client.query<{ session_id: number }>(
        `INSERT INTO attendance_sessions (hostel_id, session_date, start_time, end_time) VALUES ($1, $2, '20:30', '21:00') ON CONFLICT DO NOTHING RETURNING session_id`,
        [h, day],
      );
      if (sess[0]) { // a roll call that already existed is somebody else's: leave it alone
        sessionOf.set(h, sess[0].session_id);
        sessionIds.push(sess[0].session_id);
        await track("session", sess[0].session_id);
        stats.sessions++;
      }
    }
    const d = dow(day);
    const weekend = d === 0 || d === 6;
    const friSat = d === 5 || d === 6;
    const cluster = clusterDays.has(day);
    const quality = weekOf(day) === badWeek;

    for (const s of students) {
      const cam = pick(camsOf(s.hostelId));
      let outDuringRollCall = false;

      const emit = async (minutes: number, direction: "IN" | "OUT"): Promise<boolean> => {
        const ts = stamp(day, minutes, ri(0, 59));
        if (asMs(ts) <= s.lastMs || direction === s.lastDir) return false;
        const evId = await faceEvent(cam.camera_id, s.id, simAt(day), "matched", ts);
        const res = await tryCall<{ p_log_id: number }>("CALL record_entry_exit($1, $2, $3, $4, NULL, NULL)", [s.id, cam.gate_id, evId, direction]);
        if (!res) return false;
        trackedLogs.push(res.p_log_id);
        await track("gate_log", res.p_log_id);
        s.lastMs = asMs(ts);
        s.lastDir = direction;
        stats.gateEvents++;
        return true;
      };

      if (s.lastDir === "OUT") await emit(ri(6 * 60, 9 * 60), "IN"); // still marked OUT from earlier: back in the morning first

      if (chance(Math.min(0.95, s.outingProb + (weekend ? 0.25 : 0)))) {
        if (chance(s.lateOutProb * (friSat ? 2 : 1))) {
          // leaves after 20:00 (no_leave unless on approved leave), back before the curfew
          const out = ri(20 * 60 + 5, 21 * 60 + 20);
          if (await emit(out, "OUT")) {
            outDuringRollCall = out < 21 * 60;
            await emit(ri(21 * 60 + 45, 22 * 60 + 25), "IN");
          }
        } else {
          const out = outTime(weekend);
          if (await emit(out, "OUT")) {
            if (chance(s.lateProb * (friSat ? 2.2 : 1)) || (cluster && chance(0.5))) await emit(ri(22 * 60 + 35, 23 * 60 + 55), "IN"); // late_return
            else await emit(Math.min(21 * 60 + 30, out + (weekend ? ri(180, 480) : ri(60, 270))), "IN");
          }
        }
      }
      // the camera is unsure now and then: a review-band event, no gate log. A warden has decided most of them
      // (confirm -> matched, reject -> no match); the last few days are still waiting in the review queue.
      if (chance(quality ? 0.3 : 0.05)) {
        const recent = day >= addDays(today, -3);
        const decided = !recent && wardenId !== null && chance(0.85);
        const confirm = chance(quality ? 0.5 : 0.75);
        await faceEvent(cam.camera_id, decided && !confirm ? null : s.id, r(0.36, 0.49), decided ? (confirm ? "matched" : "no_match") : "low_confidence",
          stamp(day, ri(7 * 60, 21 * 60), ri(0, 59)), decided ? wardenId : null);
      }

      // roll call
      if (sessionOf.has(s.hostelId) && !onLeave(s.id, day) && !outDuringRollCall && chance(s.attendProb * (weekend ? 0.97 : 1))) {
        // A low-confidence roll-call scan is only generated for older days, and a warden has long since confirmed it
        // (the face event becomes 'matched'; the attendance mark keeps the status it got, as in the app). Recent days
        // never get one, so the review queue only holds gate scans, which can be confirmed AND rejected.
        const low = day < addDays(today, -3) && wardenId !== null && chance(quality ? 0.08 : 0.025);
        const evId = await faceEvent(cam.camera_id, s.id, low ? r(0.36, 0.49) : simAt(day), low ? "low_confidence" : "matched", stamp(day, ri(20 * 60 + 31, 20 * 60 + 58), ri(0, 59)));
        if (await tryCall("CALL mark_attendance($1, $2, $3, NULL)", [s.id, sessionOf.get(s.hostelId), evId])) stats.marks++;
        if (low) await client.query("UPDATE face_events SET outcome = 'matched', reviewed_by = $2 WHERE event_id = $1", [evId, wardenId]);
      }
    }
    // a stranger or two walks past each gate camera (more at weekends)
    for (const h of new Set(students.map((s) => s.hostelId))) {
      for (let k = ri(0, weekend ? 3 : 2); k > 0; k--) await faceEvent(pick(camsOf(h)).camera_id, null, r(0.05, 0.33), "no_match", stamp(day, ri(7 * 60, 22 * 60), ri(0, 59)));
    }
  }

  // ---- a few students are out RIGHT NOW (their morning OUT scan, no return yet), so the dashboard has an "outside" column ----
  // Only when seeding after 11:30, so the OUT times (08:30-11:00) are already in the past; the choice of students and times
  // depends on the seed, not on the minute the command runs.
  const nowMinutes = Number((await q<{ m: number }>("SELECT (extract(hour FROM localtime) * 60 + extract(minute FROM localtime))::int AS m"))[0].m);
  const outToday: number[] = [];
  if (nowMinutes >= 11 * 60 + 30) {
    const candidates = students.filter((s) => s.lastDir === "IN" && !onLeave(s.id, today));
    for (const s of candidates.filter((_, i) => i % Math.max(1, Math.round(candidates.length / 3)) === 0).slice(0, 3)) {
      const cam = pick(camsOf(s.hostelId));
      const ts = stamp(today, ri(8 * 60 + 30, 11 * 60), ri(0, 59));
      if (asMs(ts) <= s.lastMs) continue;
      const evId = await faceEvent(cam.camera_id, s.id, simAt(today), "matched", ts);
      const res = await tryCall<{ p_log_id: number }>("CALL record_entry_exit($1, $2, $3, 'OUT', NULL, NULL)", [s.id, cam.gate_id, evId]);
      if (res) { trackedLogs.push(res.p_log_id); await track("gate_log", res.p_log_id); s.lastDir = "OUT"; s.lastMs = asMs(ts); stats.gateEvents++; outToday.push(s.id); }
    }
  }

  // ---- close every generated roll call with the real procedure ----
  for (const id of sessionIds) {
    const res = await tryCall<{ p_absent: number; p_violations: number }>("CALL close_attendance_session($1, NULL, NULL)", [id]);
    if (res) { stats.closedAbsent += Number(res.p_absent); stats.violationsFromClose += Number(res.p_violations); }
  }

  // ---- violations: date them by the event that caused them, resolve most of the older ones ----
  const ids = (await q<{ violation_id: number }>("SELECT violation_id FROM violations WHERE log_id = ANY($1::int[]) OR session_id = ANY($2::int[]) ORDER BY violation_id", [trackedLogs, sessionIds])).map((v) => v.violation_id);
  await client.query("UPDATE violations v SET raised_at = l.event_time FROM entry_exit_log l WHERE v.log_id = l.log_id AND v.violation_id = ANY($1::int[])", [ids]);
  await client.query("UPDATE violations v SET raised_at = s.session_date + s.end_time FROM attendance_sessions s WHERE v.session_id = s.session_id AND v.log_id IS NULL AND v.violation_id = ANY($1::int[])", [ids]);
  stats.violations = ids.length;
  if (wardenId !== null) {
    const old = await q<{ violation_id: number }>("SELECT violation_id FROM violations WHERE violation_id = ANY($1::int[]) AND raised_at < $2::date - 5 ORDER BY violation_id", [ids, today]);
    for (const v of old) {
      if (chance(0.6)) {
        await client.query("UPDATE violations SET status = 'resolved', resolved_by = $2, resolved_at = raised_at + make_interval(mins => $3::int) WHERE violation_id = $1", [v.violation_id, wardenId, ri(60, 48 * 60)]);
        stats.resolved++;
      }
    }
  }

  const ev = (await q<{ lo: number | null; hi: number | null }>("SELECT min(row_id) AS lo, max(row_id) AS hi FROM b_demo_rows WHERE kind = 'face_event'"))[0];
  const label = { days: DAYS, from: firstDay, to: lastDay, students: students.length, generated_at: today, seed: opts.seed, first_event_id: ev.lo, last_event_id: ev.hi, note: "simulated data" };
  await client.query("DELETE FROM b_meta WHERE key = 'generated_history'");
  await client.query("INSERT INTO b_meta (key, value) VALUES ('generated_history', $1)", [JSON.stringify(label)]);
  return { stats, label };
}
