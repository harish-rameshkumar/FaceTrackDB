import bcrypt from "bcryptjs";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { mapAdminError } from "@/lib/admin-errors";
import { getPool } from "@/lib/db";
import { blankParent, isBlankParent, validateRegistration, type ParentInput, type RegistrationInput } from "@/lib/registration";

const str = (v: unknown) => (typeof v === "string" ? v : "");

function parseBody(raw: unknown): RegistrationInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const parents = (Array.isArray(b.parents) ? b.parents : []).slice(0, 3).map((p): ParentInput => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { ...blankParent(), name: str(o.name), phone: str(o.phone), email: str(o.email), relation: str(o.relation), password: str(o.password) };
  });
  while (parents.length > 1 && isBlankParent(parents[parents.length - 1])) parents.pop();
  const hostel = Number(b.hostel_id);
  return {
    name: str(b.name), roll_no: str(b.roll_no), room_no: str(b.room_no), email: str(b.email), password: str(b.password),
    hostel_id: Number.isInteger(hostel) && hostel > 0 ? hostel : null, parents, consent: b.consent === true,
  };
}

// POST /api/admin/students: registers a student, the student's login and one or two
// parents (new logins, or existing parent accounts) in ONE database transaction.
// Plain passwords are hashed here and never stored, logged or returned.
export async function POST(request: Request) {
  try {
    const admin = await requireRole(["admin"]);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const input = parseBody(raw);
    const fieldErrors = validateRegistration(input);
    if (Object.keys(fieldErrors).length > 0) {
      return Response.json({ error: "Please correct the highlighted fields", fieldErrors }, { status: 400 });
    }

    const hash = (pw: string) => bcrypt.hash(pw, 10);
    const student = {
      email: input.email.trim(), hash: await hash(input.password), roll_no: input.roll_no.trim(), name: input.name.trim(),
      hostel_id: input.hostel_id, room_no: input.room_no.trim(),
    };
    const parents = await Promise.all(
      input.parents.map(async (p) => ({ email: p.email.trim(), hash: await hash(p.password), name: p.name.trim(), phone: p.phone.trim(), relation: p.relation })),
    );

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ r: { student_id: number; parents: { email: string; created: boolean }[] } }>(
        "SELECT register_student($1::jsonb, $2::jsonb, $3, $4) AS r",
        [JSON.stringify(student), JSON.stringify(parents), input.consent, admin.userId],
      );
      await client.query("COMMIT");
      const r = rows[0].r;
      return Response.json({ student_id: r.student_id, parents: r.parents }, { status: 201 });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      const mapped = mapAdminError(e);
      if (mapped) {
        return Response.json(
          { error: mapped.message, ...(mapped.field ? { fieldErrors: { [mapped.field]: mapped.message } } : {}) },
          { status: mapped.status },
        );
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    // log the error code only: the request body holds passwords
    console.error("register student failed", (e as { code?: string })?.code ?? (e as Error)?.name);
    return Response.json({ error: "Registration failed" }, { status: 500 });
  }
}
