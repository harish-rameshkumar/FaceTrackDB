import { getPool } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse } from "@/lib/api-helpers";

// GET /api/wards  (parents only; READ-ONLY, added for the parent home and history pages)
// The students this parent is linked to through student_parent. The parent id comes from the signed
// session, so a parent can only ever list their own wards.
export async function GET() {
  try {
    const user = await requireRole(["parent"]);
    if (!user.parentId) {
      return Response.json({ error: "Your account is not linked to a parent record" }, { status: 403 });
    }
    const { rows } = await getPool().query(
      `SELECT s.student_id, s.name, s.roll_no, h.name AS hostel, sp.relation
       FROM student_parent sp
       JOIN students s ON s.student_id = sp.student_id
       JOIN hostels h ON h.hostel_id = s.hostel_id
       WHERE sp.parent_id = $1
       ORDER BY s.name`,
      [user.parentId],
    );
    return Response.json({
      wards: rows.map((r) => ({ studentId: r.student_id, name: r.name, rollNo: r.roll_no, hostel: r.hostel, relation: r.relation })),
    });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
