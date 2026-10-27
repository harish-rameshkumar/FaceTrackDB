import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Who am I? Used by the UI to decide what to show, and handy for testing login.
// getCurrentUser also checks that the user still exists and the token is not revoked.
export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }

  const { rows } = await getPool().query(
    `SELECT u.email, COALESCE(s.name, p.name) AS name
     FROM users u
     LEFT JOIN students s ON s.user_id = u.user_id
     LEFT JOIN parents  p ON p.user_id = u.user_id
     WHERE u.user_id = $1`,
    [session.userId]
  );
  if (!rows[0]) {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }

  return Response.json({
    user: {
      id: session.userId,
      email: rows[0].email,
      name: rows[0].name ?? null,
      role: session.role,
      studentId: session.studentId ?? null,
      parentId: session.parentId ?? null,
    },
  });
}
