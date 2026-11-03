import { withRole } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse, parseId } from "@/lib/api-helpers";

// DELETE /api/leave/12  (students only)
// A student may cancel their OWN request while it is still PENDING. A decided request
// (approved or rejected) is final and is never deleted: fn_leave_guard already refuses to change it,
// and this route refuses to remove it. The status check is part of the DELETE itself, so a parent
// deciding at the same moment cannot be raced: either the request is still pending and is removed,
// or it was decided first and nothing is deleted.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(["student"]);
    return await withRole(user, async (db) => {
      if (!user.studentId) {
        return Response.json({ error: "Your account is not linked to a student record" }, { status: 403 });
      }
      const leaveId = parseId((await params).id);
      if (leaveId === null) return Response.json({ error: "Invalid leave request id" }, { status: 400 });

      const pool = db;
      const removed = await pool.query(
        "DELETE FROM leave_requests WHERE leave_id = $1 AND student_id = $2 AND status = 'pending'",
        [leaveId, user.studentId],
      );
      if (removed.rowCount) return Response.json({ ok: true, id: leaveId, cancelled: true });

      // nothing deleted: not yours / does not exist (404, the same answer for both), or already decided (409)
      const row = await pool.query<{ status: string }>("SELECT status FROM leave_requests WHERE leave_id = $1 AND student_id = $2", [leaveId, user.studentId]);
      if (row.rowCount) {
        return Response.json({ error: "This leave request has already been decided and cannot be cancelled" }, { status: 409 });
      }
      return Response.json({ error: "Leave request not found" }, { status: 404 });
    });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
