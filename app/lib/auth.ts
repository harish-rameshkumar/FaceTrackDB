import "server-only";
import { getPool } from "./db";
import { readSession, type Role } from "./session";

// Real JWT-based authentication. It keeps the exact exports and shapes of the
// old dev stub (auth-stub.ts), so every API route and page that calls
// requireRole() keeps working without changes.

export type { Role };

export interface CurrentUser {
  userId: number; // users.user_id
  role: Role;
  studentId?: number; // set when the user is a student
  parentId?: number; // set when the user is a parent
  tokenVersion?: number; // users.token_version the token was issued with
}

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

// The logged-in user, or null. This is the ONE place every route and page goes through
// (requireRole calls it), so the checks below cover the whole app:
//   1. the signed cookie must be valid and unexpired (lib/session.ts);
//   2. the user must still exist in the database;
//   3. the role in the database must still be the role in the token (a demoted user loses access);
//   4. the token's version must equal users.token_version (a password change or the admin
//      action "Sign out everywhere" adds 1 to it, which invalidates every older token).
// One small indexed query per request is the price of being able to revoke a session.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await readSession();
  if (!session) return null;
  const { rows } = await getPool().query<{ role: string; token_version: number }>(
    "SELECT role, token_version FROM users WHERE user_id = $1",
    [session.userId],
  );
  const user = rows[0];
  if (!user || user.role !== session.role || user.token_version !== (session.tokenVersion ?? 0)) return null;
  return session;
}

// Throws AuthError(401) when not logged in and AuthError(403) for the wrong role.
export async function requireRole(roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "Not signed in");
  if (!roles.includes(user.role)) throw new AuthError(403, "Not allowed for this role");
  return user;
}

/** Turns an AuthError into a JSON response; returns null for any other error. */
export function authErrorResponse(e: unknown): Response | null {
  if (e instanceof AuthError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  return null;
}
