import "server-only";
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
}

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

// The logged-in user, read from the signed session cookie; null when not logged in.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return readSession();
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
