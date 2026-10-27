// Fixed messages for the database rules added in db/b_register.sql. The raw
// database text is never sent to the browser. The messages themselves live in
// lib/db-errors.ts; this adds which form field an error belongs to.
import { publicDbError } from "./db-errors";

export interface MappedError {
  status: number;
  message: string;
  field?: string;
}

const FIELD: Record<string, string> = { FT050: "email", FT051: "roll_no", FT054: "hostel_id" };

export function mapAdminError(e: unknown): MappedError | null {
  const known = publicDbError(e);
  if (!known) return null;
  return { status: known.status, message: known.message, ...(FIELD[known.code] ? { field: FIELD[known.code] } : {}) };
}
