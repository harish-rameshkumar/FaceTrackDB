import { withRole } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse, parseId } from "@/lib/api-helpers";

// POST /api/leave/12/decide   { decision: "approved" | "rejected" }
// Parents only. All the rules live in the decide_leave stored procedure:
// only a parent of that student, only while pending, no overlapping approvals.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(["parent"]);
    return await withRole(user, async (db) => {
      if (!user.parentId) {
        return Response.json({ error: "Your account is not linked to a parent record" }, { status: 403 });
      }

      const leaveId = parseId((await params).id);
      if (leaveId === null) {
        return Response.json({ error: "Invalid leave request id" }, { status: 400 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Send JSON like {"decision":"approved"}' }, { status: 400 });
      }
      const decision = (body as { decision?: unknown } | null)?.decision;
      if (decision !== "approved" && decision !== "rejected") {
        return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });
      }

      await db.query("CALL decide_leave($1, $2, $3)", [leaveId, user.parentId, decision]);
      return Response.json({ ok: true, id: leaveId, status: decision });
    });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
