import "server-only";
import { readSession, type Role, type SessionPayload } from "./session";

// Role guard for API routes. Use it as the first line of a protected route:
//
//   const auth = await requireRole("parent");
//   if (auth instanceof Response) return auth;   // 401 or 403
//   // from here on, auth is the logged-in user's session
//
// Roles come from the signed token, so they cannot be changed by the client.
export async function requireRole(
  ...roles: Role[]
): Promise<SessionPayload | Response> {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }
  if (!roles.includes(session.role)) {
    return Response.json(
      { error: "You do not have access to this" },
      { status: 403 }
    );
  }
  return session;
}
