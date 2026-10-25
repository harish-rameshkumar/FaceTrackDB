import { getPool } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse } from "@/lib/api-helpers";

// GET /api/history
// Students only, and always the logged-in student's OWN records: the student id
// comes from the signed session cookie, never from the request, so a student
// cannot ask for somebody else's history.
export async function GET() {
  try {
    const user = await requireRole(["student"]);
    if (!user.studentId) {
      return Response.json({ error: "Your account is not linked to a student record" }, { status: 403 });
    }

    const pool = getPool();
    const [attendance, gate, summary] = await Promise.all([
      pool.query(
        `SELECT sess.session_date, sess.start_time, sess.end_time, a.status, a.marked_at
         FROM attendance a
         JOIN attendance_sessions sess USING (session_id)
         WHERE a.student_id = $1
         ORDER BY sess.session_date DESC, sess.start_time DESC
         LIMIT 60`,
        [user.studentId]
      ),
      pool.query(
        `SELECT l.log_id AS id, l.direction, l.event_time, g.name AS gate_name
         FROM entry_exit_log l
         JOIN gates g USING (gate_id)
         WHERE l.student_id = $1
         ORDER BY l.event_time DESC, l.log_id DESC
         LIMIT 60`,
        [user.studentId]
      ),
      pool.query(
        `SELECT count(*) FILTER (WHERE status = 'present')        AS present,
                count(*) FILTER (WHERE status = 'low_confidence') AS low_confidence,
                count(*) FILTER (WHERE status = 'absent')         AS absent,
                count(*)                                          AS total
         FROM attendance
         WHERE student_id = $1`,
        [user.studentId]
      ),
    ]);

    // count() comes back from Postgres as text, so convert to numbers
    const s = summary.rows[0];
    const present = Number(s.present);
    const lowConfidence = Number(s.low_confidence);
    const absent = Number(s.absent);
    const total = Number(s.total);

    const lastDirection: string | undefined = gate.rows[0]?.direction;

    return Response.json({
      summary: {
        present,
        lowConfidence,
        absent,
        total,
        attendedPercent: total > 0 ? Math.round((100 * (present + lowConfidence)) / total) : null,
      },
      currentStatus: lastDirection === "IN" ? "inside" : lastDirection === "OUT" ? "outside" : null,
      attendance: attendance.rows.map((r) => ({
        date: r.session_date,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        markedAt: r.marked_at,
      })),
      gate: gate.rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        time: r.event_time,
        gateName: r.gate_name,
      })),
    });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
