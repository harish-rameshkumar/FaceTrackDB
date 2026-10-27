import { authErrorResponse, requireRole } from "@/lib/auth";
import { dbErrorResponse, parseId } from "@/lib/api-helpers";
import { getPool } from "@/lib/db";

// POST /api/admin/users/[userId]/signout (admin only)
// "Sign out this user everywhere": adds 1 to users.token_version, so every login token issued
// to that account before now stops working on its next request. The user can sign in again.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["admin"]);
    const userId = parseId((await params).id);
    if (userId === null) return Response.json({ error: "Invalid user id" }, { status: 400 });
    const { rows } = await getPool().query<{ token_version: number }>(
      "UPDATE users SET token_version = token_version + 1 WHERE user_id = $1 RETURNING token_version",
      [userId],
    );
    if (rows.length === 0) return Response.json({ error: "User not found" }, { status: 404 });
    return Response.json({ ok: true, signedOutEverywhere: true });
  } catch (e) {
    const r = authErrorResponse(e) ?? dbErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
