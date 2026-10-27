import "server-only";
import { GENERIC_ERROR, publicDbError } from "./db-errors";

// Turns an error thrown by a database call into a JSON response with a FIXED message.
//   * one of our rules (FT***) or a constraint error: its own status and message (lib/db-errors.ts);
//   * any other database or connection error (it carries a string `code`, for example a SQL error
//     or ECONNREFUSED): a generic 500, with the real error written only to the server log;
//   * anything else (a bug, or Next.js's own control-flow errors such as "dynamic usage" during
//     prerendering): null, so the caller rethrows it and Next.js handles it.
// The database's message text never reaches the browser, because it can contain ids,
// timestamps and column names (for example "Parent 3 is not a parent of student 4").
export function dbErrorResponse(e: unknown): Response | null {
  const known = publicDbError(e);
  if (known) return Response.json({ error: known.message, code: known.code }, { status: known.status });
  if (typeof (e as { code?: unknown } | null)?.code === "string") {
    console.error("unexpected database error", e);
    return Response.json({ error: GENERIC_ERROR.message }, { status: GENERIC_ERROR.status });
  }
  return null;
}

// "12" -> 12; anything else (empty, "1e2", "-3", "abc") -> null
export function parseId(value: string): number | null {
  if (!/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}
