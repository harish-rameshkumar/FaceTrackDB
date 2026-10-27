import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { createSession, type Role } from "@/lib/session";

// A real bcrypt hash of a throwaway password. When the email does not exist we
// still run one bcrypt comparison against this, so the response time does not
// reveal which emails are registered.
const DUMMY_HASH =
  "$2b$10$JvyxRPnir66KtRoCoqrxOeNmKPyMMxeLzjOg2Z/mq9ilX0.y8lWMa";

// The caller's address, for the per-address limit. Behind a reverse proxy this comes from
// X-Forwarded-For; WITHOUT a trusted proxy that header can be spoofed, which only weakens the
// per-address limit (the per-email limit does not depend on it). See the README.
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send JSON with an email and a password" },
      { status: 400 }
    );
  }

  const { email: rawEmail, password } = (body ?? {}) as {
    email?: unknown;
    password?: unknown;
  };
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

  if (!email || typeof password !== "string" || !password) {
    return Response.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }
  if (email.length > 255 || password.length > 200) {
    return Response.json({ error: "Email or password is too long" }, { status: 400 });
  }

  const pool = getPool();
  const ip = clientIp(request);

  // Rate limit, kept in the database (login_attempts; see db/procedures.sql). It is checked
  // BEFORE the email is looked up, so a locked known email and a locked unknown email get
  // exactly the same answer.
  const { rows: limit } = await pool.query<{ wait: number }>("SELECT login_retry_after($1, $2) AS wait", [email, ip]);
  const wait = limit[0].wait;
  if (wait > 0) {
    const minutes = Math.max(1, Math.ceil(wait / 60));
    return Response.json(
      { error: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, retryAfterSeconds: wait },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const { rows } = await pool.query(
    `SELECT u.user_id, u.email, u.password_hash, u.role, u.token_version,
            s.student_id, p.parent_id,
            COALESCE(s.name, p.name) AS name
     FROM users u
     LEFT JOIN students s ON s.user_id = u.user_id
     LEFT JOIN parents  p ON p.user_id = u.user_id
     WHERE lower(u.email) = $1`,
    [email]
  );
  const user = rows[0];

  const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    await pool.query("SELECT login_record($1, $2, false)", [email, ip]);
    // Same message for "no such email" and "wrong password"
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Create the session first: if JWT_SECRET is unusable this throws (500) and nothing is recorded as a success
  await createSession({
    userId: user.user_id,
    role: user.role as Role,
    studentId: user.student_id ?? undefined,
    parentId: user.parent_id ?? undefined,
    tokenVersion: user.token_version,
  });
  await pool.query("SELECT login_record($1, $2, true)", [email, ip]);

  return Response.json({
    user: {
      id: user.user_id,
      email: user.email,
      name: user.name ?? null,
      role: user.role,
      studentId: user.student_id ?? null,
      parentId: user.parent_id ?? null,
    },
  });
}
