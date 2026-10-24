import "server-only";

// HTTP status for each custom error code raised by the database triggers and
// stored procedures (see db/docs/phase3-logic.md for what each one means).
const STATUS_BY_CODE: Record<string, number> = {
  FT001: 409, FT002: 404, FT003: 403, FT004: 422, FT005: 409,
  FT006: 404, FT007: 422, FT008: 409, FT009: 404, FT010: 409,
  FT011: 422, FT020: 400, FT021: 422, FT022: 409, FT023: 409,
  FT024: 422, FT030: 400, FT031: 404, FT032: 409, FT033: 403,
  FT034: 409, FT040: 422,
};

// If the error came from one of our database rules, answer with its message and
// the matching status; otherwise return null so the caller can rethrow (a 500).
export function dbErrorResponse(e: unknown): Response | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code in STATUS_BY_CODE) {
    return Response.json(
      { error: (e as Error).message, code },
      { status: STATUS_BY_CODE[code] }
    );
  }
  return null;
}

// "12" -> 12; anything else (empty, "1e2", "-3", "abc") -> null
export function parseId(value: string): number | null {
  if (!/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}
