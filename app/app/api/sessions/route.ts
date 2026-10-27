import { authErrorResponse, requireRole } from "@/lib/auth";
import { mapAdminError } from "@/lib/admin-errors";
import { getPool } from "@/lib/db";
import { sessionsSql } from "@/lib/sessions";

// Roll-call sessions. Warden and admin only.
//   GET  /api/sessions   -> latest 100 with present/absent/pending counts and a status
//   POST /api/sessions   -> { hostel_id, date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" }
export async function GET() {
  try {
    await requireRole(["warden", "admin"]);
    const { rows } = await getPool().query(sessionsSql);
    return Response.json({ sessions: rows });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("list sessions failed", e);
    return Response.json({ error: "Could not load roll calls" }, { status: 500 });
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(request: Request) {
  try {
    await requireRole(["warden", "admin"]);
    let b: Record<string, unknown>;
    try {
      b = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const hostel = Number(b.hostel_id);
    const date = typeof b.date === "string" ? b.date : "";
    const start = typeof b.start === "string" ? b.start : "";
    const end = typeof b.end === "string" ? b.end : "";
    const realDate = DATE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
    if (!Number.isInteger(hostel) || hostel <= 0) return Response.json({ error: "Choose a hostel" }, { status: 400 });
    if (!realDate) return Response.json({ error: "Enter a real date" }, { status: 400 });
    if (!TIME.test(start) || !TIME.test(end)) return Response.json({ error: "Enter start and end times as HH:MM" }, { status: 400 });
    if (end <= start) return Response.json({ error: "The end time must be after the start time" }, { status: 400 });

    try {
      const { rows } = await getPool().query<{ id: number }>("SELECT create_attendance_session($1, $2, $3, $4) AS id", [hostel, date, start, end]);
      return Response.json({ session_id: rows[0].id }, { status: 201 });
    } catch (e) {
      const mapped = mapAdminError(e);
      if (mapped) return Response.json({ error: mapped.message }, { status: mapped.status });
      throw e;
    }
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("create session failed", e);
    return Response.json({ error: "Could not create the roll call" }, { status: 500 });
  }
}
