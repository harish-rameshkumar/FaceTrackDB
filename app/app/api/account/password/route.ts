import bcrypt from "bcryptjs";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { createSession } from "@/lib/session";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/registration";

// POST /api/account/password { current, next }: any signed-in user changes their own password.
export async function POST(request: Request) {
  try {
    const user = await requireRole(["student", "parent", "warden", "security", "admin"]);
    let b: Record<string, unknown>;
    try {
      b = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const current = typeof b.current === "string" ? b.current : "";
    const next = typeof b.next === "string" ? b.next : "";
    if (!current) return Response.json({ error: "Enter your current password" }, { status: 400 });
    if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
      return Response.json({ error: `The new password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters` }, { status: 400 });
    }
    if (next === current) return Response.json({ error: "The new password must be different" }, { status: 400 });

    const pool = getPool();
    const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE user_id = $1", [user.userId]);
    if (!rows[0] || !(await bcrypt.compare(current.slice(0, 200), rows[0].password_hash))) {
      return Response.json({ error: "Your current password is not correct" }, { status: 403 });
    }
    // token_version + 1 signs this account out everywhere (every older token stops working)...
    const updated = await pool.query<{ token_version: number }>(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE user_id = $2 RETURNING token_version",
      [await bcrypt.hash(next, 10), user.userId],
    );
    // ...and this browser gets a fresh token, so the person who changed it stays signed in
    await createSession({ userId: user.userId, role: user.role, studentId: user.studentId, parentId: user.parentId, tokenVersion: updated.rows[0].token_version });
    return Response.json({ ok: true });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("change password failed", (e as { code?: string })?.code ?? (e as Error)?.name);
    return Response.json({ error: "Could not change the password" }, { status: 500 });
  }
}
