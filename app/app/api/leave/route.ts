import { getPool } from "@/lib/db";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { dbErrorResponse } from "@/lib/api-helpers";

const LIST_SQL = `
  SELECT l.leave_id AS id, l.student_id, s.name AS student_name, s.roll_no,
         l.start_date, l.end_date, l.reason, l.status, l.decided_at,
         p.name AS decided_by_name
  FROM leave_requests l
  JOIN students s ON s.student_id = l.student_id
  LEFT JOIN parents p ON p.parent_id = l.decided_by`;

// GET /api/leave[?status=pending|approved|rejected]
//   student        -> only their own requests
//   parent         -> requests of their own wards
//   warden / admin -> every request (read only)
export async function GET(request: Request) {
  try {
    const user = await requireRole(["student", "parent", "warden", "admin"]);
    const params: unknown[] = [];
    const where: string[] = [];

    if (user.role === "student") {
      if (!user.studentId) return noProfile("student");
      params.push(user.studentId);
      where.push(`l.student_id = $${params.length}`);
    } else if (user.role === "parent") {
      if (!user.parentId) return noProfile("parent");
      params.push(user.parentId);
      where.push(
        `l.student_id IN (SELECT student_id FROM student_parent WHERE parent_id = $${params.length})`
      );
    }

    const status = new URL(request.url).searchParams.get("status");
    if (status !== null) {
      if (!["pending", "approved", "rejected"].includes(status)) {
        return Response.json({ error: "status must be pending, approved or rejected" }, { status: 400 });
      }
      params.push(status);
      where.push(`l.status = $${params.length}`);
    }

    const { rows } = await getPool().query(
      `${LIST_SQL}
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY (l.status = 'pending') DESC, l.start_date DESC, l.leave_id DESC
       LIMIT 200`,
      params
    );

    return Response.json({
      requests: rows.map((r) => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        rollNo: r.roll_no,
        startDate: r.start_date,
        endDate: r.end_date,
        reason: r.reason,
        status: r.status,
        decidedAt: r.decided_at,
        decidedByName: r.decided_by_name,
      })),
    });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}

// POST /api/leave   { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", reason: "..." }
// Students only. The request starts as pending; a parent decides it later.
export async function POST(request: Request) {
  try {
    const user = await requireRole(["student"]);
    if (!user.studentId) return noProfile("student");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Send JSON with startDate, endDate and reason" }, { status: 400 });
    }
    const { startDate, endDate, reason: rawReason } = (body ?? {}) as Record<string, unknown>;

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      return Response.json({ error: "Dates must be real dates in YYYY-MM-DD form" }, { status: 400 });
    }
    if (endDate < startDate) {
      return Response.json({ error: "The end date cannot be before the start date" }, { status: 400 });
    }
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (reason.length < 3 || reason.length > 500) {
      return Response.json({ error: "Please give a reason of 3 to 500 characters" }, { status: 400 });
    }

    const pool = getPool();

    // "today" in the hostel's time zone comes from the database, not the browser
    const today = (await pool.query("SELECT current_date::text AS today")).rows[0].today as string;
    if (startDate < today) {
      return Response.json({ error: "Leave cannot start in the past" }, { status: 422 });
    }

    const overlap = await pool.query(
      `SELECT 1 FROM leave_requests
       WHERE student_id = $1 AND status IN ('pending', 'approved')
         AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
       LIMIT 1`,
      [user.studentId, startDate, endDate]
    );
    if (overlap.rowCount) {
      return Response.json(
        { error: "You already have a pending or approved request for these dates" },
        { status: 409 }
      );
    }

    const { rows } = await pool.query(
      `INSERT INTO leave_requests (student_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING leave_id AS id, start_date, end_date, reason, status`,
      [user.studentId, startDate, endDate, reason]
    );
    const r = rows[0];
    return Response.json(
      { request: { id: r.id, startDate: r.start_date, endDate: r.end_date, reason: r.reason, status: r.status } },
      { status: 201 }
    );
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}

function noProfile(kind: string) {
  return Response.json({ error: `Your account is not linked to a ${kind} record` }, { status: 403 });
}

// A real calendar date written as YYYY-MM-DD (rejects 2026-02-31, "tomorrow", etc.)
function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
