import { authErrorResponse, requireRole } from "@/lib/auth";
import { mapAdminError } from "@/lib/admin-errors";
import { parseId } from "@/lib/api-helpers";
import { getPool } from "@/lib/db";

// GET  /api/sessions/[id]/close -> what closing would do now (students to mark absent)
// POST /api/sessions/[id]/close -> calls close_attendance_session (safe to repeat)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["warden", "admin"]);
    const id = parseId((await params).id);
    if (!id) return Response.json({ error: "Invalid roll call id" }, { status: 400 });
    const pool = getPool();
    const s = await pool.query("SELECT (session_date + end_time) <= localtimestamp AS ended FROM attendance_sessions WHERE session_id = $1", [id]);
    if (s.rowCount === 0) return Response.json({ error: "Roll call not found" }, { status: 404 });
    const { rows } = await pool.query("SELECT will_be_absent, will_get_violation FROM session_close_preview($1)", [id]);
    return Response.json({ ended: s.rows[0].ended, willBeAbsent: rows[0].will_be_absent, willGetViolation: rows[0].will_get_violation });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("close preview failed", e);
    return Response.json({ error: "Could not check the roll call" }, { status: 500 });
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["warden", "admin"]);
    const id = parseId((await params).id);
    if (!id) return Response.json({ error: "Invalid roll call id" }, { status: 400 });
    try {
      const { rows } = await getPool().query("CALL close_attendance_session($1, NULL, NULL)", [id]);
      return Response.json({ markedAbsent: rows[0].p_absent, violationsRaised: rows[0].p_violations });
    } catch (e) {
      const mapped = mapAdminError(e);
      if (mapped) return Response.json({ error: mapped.message }, { status: mapped.status });
      throw e;
    }
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("close session failed", e);
    return Response.json({ error: "Could not close the roll call" }, { status: 500 });
  }
}
