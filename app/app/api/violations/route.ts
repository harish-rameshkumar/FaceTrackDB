import { withRole } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse, parseId } from "@/lib/api-helpers";

// GET /api/violations[?status=open|resolved][&studentId=3]
//   student        -> only their own
//   parent         -> their wards (read only)
//   warden / admin -> everyone's, and canResolve is true
export async function GET(request: Request) {
  try {
    const user = await requireRole(["student", "parent", "warden", "admin"]);
    return await withRole(user, async (db) => {
      const params: unknown[] = [];
      const where: string[] = [];
      const staff = user.role === "warden" || user.role === "admin";

      if (user.role === "student") {
        if (!user.studentId) {
          return Response.json({ error: "Your account is not linked to a student record" }, { status: 403 });
        }
        params.push(user.studentId);
        where.push(`v.student_id = $${params.length}`);
      } else if (user.role === "parent") {
        if (!user.parentId) {
          return Response.json({ error: "Your account is not linked to a parent record" }, { status: 403 });
        }
        params.push(user.parentId);
        where.push(
          `v.student_id IN (SELECT student_id FROM student_parent WHERE parent_id = $${params.length})`
        );
      }

      const search = new URL(request.url).searchParams;
      const status = search.get("status");
      if (status !== null) {
        if (status !== "open" && status !== "resolved") {
          return Response.json({ error: "status must be open or resolved" }, { status: 400 });
        }
        params.push(status);
        where.push(`v.status = $${params.length}`);
      }
      const studentIdParam = search.get("studentId");
      if (studentIdParam !== null) {
        const studentId = parseId(studentIdParam);
        if (studentId === null) {
          return Response.json({ error: "Invalid studentId" }, { status: 400 });
        }
        params.push(studentId);
        where.push(`v.student_id = $${params.length}`);
      }

      const { rows } = await db.query(
        `SELECT v.violation_id AS id, v.student_id, s.name AS student_name, s.roll_no,
                v.type, v.details, v.raised_at, v.status, v.resolved_at,
                ru.email AS resolved_by_email
         FROM violations v
         JOIN students s ON s.student_id = v.student_id
         LEFT JOIN users ru ON ru.user_id = v.resolved_by
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY (v.status = 'open') DESC, v.raised_at DESC, v.violation_id DESC
         LIMIT 200`,
        params
      );

      return Response.json({
        canResolve: staff,
        violations: rows.map((r) => ({
          id: r.id,
          studentId: r.student_id,
          studentName: r.student_name,
          rollNo: r.roll_no,
          type: r.type,
          details: r.details,
          raisedAt: r.raised_at,
          status: r.status,
          resolvedAt: r.resolved_at,
          resolvedByEmail: r.resolved_by_email,
        })),
      });
    });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
