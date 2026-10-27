import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { checkJwtSecret } from "./jwt-secret";

export const ROLES = ["student", "parent", "warden", "security", "admin"] as const;
export type Role = (typeof ROLES)[number];

// The minimum the rest of the app needs to know about the logged-in user.
// studentId / parentId let API routes limit data to the user's own records.
export type SessionPayload = {
  userId: number;
  role: Role;
  studentId?: number;
  parentId?: number;
  // users.token_version when the token was issued. lib/auth.ts compares it with the
  // database on every request, so bumping the version signs the user out everywhere.
  tokenVersion?: number;
};

export const SESSION_COOKIE = "facetrack_session";
const SESSION_SECONDS = 8 * 60 * 60; // 8 hours

// Fails closed: a missing, short or placeholder secret throws, so login answers 500 and no
// token is ever accepted. The error names the problem but never prints the secret.
function secretKey(): Uint8Array {
  const problem = checkJwtSecret(process.env.JWT_SECRET);
  if (problem) {
    throw new Error(`${problem}. Set JWT_SECRET to a random string of at least 32 characters, for example the output of: openssl rand -hex 32`);
  }
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

// Signs a JWT and stores it in an HttpOnly cookie (JavaScript in the browser cannot read it).
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({
    role: payload.role,
    studentId: payload.studentId,
    parentId: payload.parentId,
    tv: payload.tokenVersion ?? 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secretKey());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

// Returns the session if the cookie holds a valid, unexpired token; otherwise null.
export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const key = secretKey(); // outside the try, so a missing secret is reported, not hidden
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    const role = payload.role as Role;
    if (!Number.isInteger(userId) || !(ROLES as readonly string[]).includes(role)) {
      return null;
    }
    return {
      userId,
      role,
      studentId: typeof payload.studentId === "number" ? payload.studentId : undefined,
      parentId: typeof payload.parentId === "number" ? payload.parentId : undefined,
      tokenVersion: typeof payload.tv === "number" ? payload.tv : 0, // tokens issued before revocation existed count as version 0
    };
  } catch {
    return null; // bad signature, tampered or expired token
  }
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
