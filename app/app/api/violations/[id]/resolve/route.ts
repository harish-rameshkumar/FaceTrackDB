import { getPool } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse, parseId } from "@/lib/api-helpers";

// POST /api/violations/7/resolve
// Warden or admin only. The database also checks that resolved_by is a
// warden or admin account, so this cannot be bypassed by a bug here.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(["warden", "admin"]);

    const violationId = parseId((await params).id);
    if (violationId === null) {
      return Response.json({ error: "Invalid violation id" }, { status: 400 });
    }

    const pool = getPool();
    const updated = await pool.query(
      `UPDATE violations
       SET status = 'resolved', resolved_by = $2, resolved_at = localtimestamp
       WHERE violation_id = $1 AND status = 'open'`,
      [violationId, user.userId]
    );
    if (updated.rowCount) {
      return Response.json({ ok: true, id: violationId, status: "resolved" });
    }

    // nothing changed: either it does not exist, or somebody resolved it already
    const exists = await pool.query("SELECT 1 FROM violations WHERE violation_id = $1", [violationId]);
    return exists.rowCount
      ? Response.json({ error: "This violation is already resolved" }, { status: 409 })
      : Response.json({ error: "Violation not found" }, { status: 404 });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
