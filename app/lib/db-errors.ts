// Fixed, user-facing messages for the errors the database raises on purpose.
// The database's own message text is never sent to the browser: it can contain
// ids, timestamps and column names (for example "Parent 3 is not a parent of
// student 4"). Codes are listed in db/docs/phase3-logic.md; FT05x and FT06x come
// from db/b_register.sql. No "server-only" import, so the tests can load this file.

export interface PublicError {
  status: number;
  message: string;
}

export const DB_ERRORS: Record<string, PublicError> = {
  // attendance and roll calls
  FT001: { status: 409, message: "Attendance is already recorded for this student in this roll call" },
  FT002: { status: 404, message: "Roll call not found" },
  FT003: { status: 403, message: "This student does not live in the hostel of this roll call" },
  FT004: { status: 422, message: "The mark time is outside the roll call window" },
  FT005: { status: 409, message: "A present mark cannot be changed" },
  FT006: { status: 404, message: "Face event not found" },
  FT007: { status: 422, message: "That face event belongs to a different student" },
  FT008: { status: 409, message: "This roll call has not ended yet" },
  FT009: { status: 404, message: "Student not found" },
  // leave
  FT010: { status: 409, message: "A decided leave request cannot be changed" },
  FT011: { status: 422, message: "Leave that has already ended cannot be approved" },
  FT030: { status: 400, message: "The decision must be approved or rejected" },
  FT031: { status: 404, message: "Leave request not found" },
  FT032: { status: 409, message: "This leave request has already been decided" },
  FT033: { status: 403, message: "You are not a parent of this student" },
  FT034: { status: 409, message: "Approving this would overlap another approved leave" },
  // gate
  FT020: { status: 400, message: "Direction must be IN or OUT" },
  FT021: { status: 422, message: "This gate does not belong to the student's hostel" },
  FT022: { status: 409, message: "The student is already marked in that direction" },
  FT023: { status: 409, message: "This gate event is not later than the student's last gate event" },
  FT024: { status: 422, message: "That face event was captured at a different gate" },
  // roles
  FT040: { status: 422, message: "A user has the wrong role for this action" },
  // registration, deletion and roll-call creation (db/b_register.sql)
  FT050: { status: 409, message: "This email is already registered" },
  FT051: { status: 409, message: "This SRN is already registered" },
  FT052: { status: 409, message: "A parent email already belongs to a student or staff account" },
  FT053: { status: 400, message: "The registration details are not valid" },
  FT054: { status: 400, message: "Hostel not found" },
  FT055: { status: 409, message: "This student has history and cannot be deleted" },
  FT060: { status: 409, message: "Another roll call for this hostel overlaps that time" },
  FT061: { status: 422, message: "That roll call time is already over" },
  // PostgreSQL's own constraint errors, without the constraint or column names
  "23505": { status: 409, message: "That record already exists" },
  "23503": { status: 409, message: "A related record is missing or still in use" },
  "23514": { status: 400, message: "The values break a database rule" },
  "23502": { status: 400, message: "A required value is missing" },
  "22001": { status: 400, message: "A value is too long" },
  "22P02": { status: 400, message: "A value has the wrong format" },
  "22007": { status: 400, message: "A date or time has the wrong format" },
  "22008": { status: 400, message: "A date or time is out of range" },
};

export const GENERIC_ERROR: PublicError = { status: 500, message: "Something went wrong. Please try again." };

/** The fixed public error for an error thrown by the database, or null if it is not one we know. */
export function publicDbError(e: unknown): (PublicError & { code: string }) | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(DB_ERRORS, code)) {
    return { ...DB_ERRORS[code], code };
  }
  return null;
}
