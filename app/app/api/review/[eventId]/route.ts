import { authErrorResponse, requireRole } from "@/lib/auth-stub";
import { getPool } from "@/lib/db";

// Warden decision on a low-confidence face event.
//   { "action": "confirm", "student_id": 3 }  keep/assign the student, outcome becomes 'matched'
//   { "action": "reject" }                    nobody recognised, outcome becomes 'no_match'
// Only unreviewed low_confidence events can be decided, once. The DB trigger
// trg_face_events_reviewer_role checks that the reviewer is a warden or admin.
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const user = await requireRole(["warden", "admin"]);
    const eventId = Number((await params).eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return Response.json({ error: "Invalid event id" }, { status: 400 });
    }

    let body: { action?: unknown; student_id?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const pool = getPool();

    let result;
    if (body.action === "confirm") {
      let studentId: number | null = null;
      if (body.student_id !== undefined) {
        if (typeof body.student_id !== "number" || !Number.isInteger(body.student_id) || body.student_id <= 0) {
          return Response.json({ error: "student_id must be a positive integer" }, { status: 400 });
        }
        studentId = body.student_id;
      }
      // COALESCE keeps the system's candidate when the warden does not pick another student
      result = await pool.query(
        `UPDATE face_events
         SET outcome = 'matched', student_id = COALESCE($2, student_id), reviewed_by = $3
         WHERE event_id = $1 AND outcome = 'low_confidence' AND reviewed_by IS NULL
         RETURNING event_id, outcome, student_id`,
        [eventId, studentId, user.userId],
      );
    } else if (body.action === "reject") {
      result = await pool.query(
        `UPDATE face_events
         SET outcome = 'no_match', student_id = NULL, reviewed_by = $2
         WHERE event_id = $1 AND outcome = 'low_confidence' AND reviewed_by IS NULL
         RETURNING event_id, outcome, student_id`,
        [eventId, user.userId],
      );
    } else {
      return Response.json({ error: "action must be 'confirm' or 'reject'" }, { status: 400 });
    }

    if (result.rowCount === 0) {
      return Response.json({ error: "Event not found or already reviewed" }, { status: 404 });
    }
    return Response.json(result.rows[0]);
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    const code = (e as { code?: string }).code;
    if (code === "FT040") return Response.json({ error: "Reviewer must be a warden or admin" }, { status: 422 });
    if (code === "23503") return Response.json({ error: "That student does not exist or the event is already linked to attendance" }, { status: 409 });
    console.error("review failed", e);
    return Response.json({ error: "Review failed" }, { status: 500 });
  }
}
