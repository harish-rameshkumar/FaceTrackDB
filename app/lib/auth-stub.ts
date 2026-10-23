// TODO(Person A): DEV-ONLY STUB. Replace this whole file with the real JWT
// authentication (verify the signed token, load the user and role from it).
// Keep the two exports and their shapes and nothing else in the app needs to
// change: every API route and page calls requireRole() from here.
//
// How to act as a role in development (never works in production):
//   * header   x-dev-role: admin|security|warden|student|parent
//              x-dev-user-id: <users.user_id>   (optional)
//   * or cookie dev_role / dev_user_id (handy for browsing the pages)
//   * or env   DEV_AUTH_ROLE / DEV_AUTH_USER_ID
// Without x-dev-user-id the seeded staff accounts are used (see DEFAULT_IDS).
import { cookies, headers } from "next/headers";

export type Role = "student" | "parent" | "warden" | "security" | "admin";

export interface CurrentUser {
  userId: number;
  role: Role;
}

const ROLES: readonly Role[] = ["student", "parent", "warden", "security", "admin"];

// users.user_id of the seeded staff accounts in db/seed.sql
const DEFAULT_IDS: Partial<Record<Role, number>> = { warden: 1, security: 2, admin: 3 };

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (process.env.NODE_ENV === "production") {
    // Refuse outright: this stub must never authenticate anyone for real.
    throw new AuthError(401, "auth-stub is disabled in production");
  }
  const h = await headers();
  const c = await cookies();
  const role = h.get("x-dev-role") ?? c.get("dev_role")?.value ?? process.env.DEV_AUTH_ROLE;
  if (!role || !(ROLES as readonly string[]).includes(role)) return null;
  const rawId = h.get("x-dev-user-id") ?? c.get("dev_user_id")?.value ?? process.env.DEV_AUTH_USER_ID;
  const userId = rawId ? Number(rawId) : DEFAULT_IDS[role as Role];
  if (!Number.isInteger(userId) || (userId as number) <= 0) return null;
  return { userId: userId as number, role: role as Role };
}

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
