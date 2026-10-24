import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { createSession, type Role } from "@/lib/session";

// A real bcrypt hash of a throwaway password. When the email does not exist we
// still run one bcrypt comparison against this, so the response time does not
// reveal which emails are registered.
const DUMMY_HASH =
  "$2b$10$JvyxRPnir66KtRoCoqrxOeNmKPyMMxeLzjOg2Z/mq9ilX0.y8lWMa";

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

  const { rows } = await getPool().query(
    `SELECT u.user_id, u.email, u.password_hash, u.role,
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
    // Same message for "no such email" and "wrong password"
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession({
    userId: user.user_id,
    role: user.role as Role,
    studentId: user.student_id ?? undefined,
    parentId: user.parent_id ?? undefined,
  });

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
