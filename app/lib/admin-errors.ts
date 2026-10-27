// Fixed messages for the database rules added in db/b_register.sql. The raw
// database text is never sent to the browser.
export interface MappedError {
  status: number;
  message: string;
  field?: string;
}

const MAP: Record<string, MappedError> = {
  FT050: { status: 409, message: "This email is already registered", field: "email" },
  FT051: { status: 409, message: "This SRN is already registered", field: "roll_no" },
  FT052: { status: 409, message: "A parent email already belongs to a student or staff account" },
  FT053: { status: 400, message: "The registration details are not valid" },
  FT054: { status: 400, message: "Hostel not found", field: "hostel_id" },
  FT055: { status: 409, message: "This student has history and cannot be deleted" },
  FT060: { status: 409, message: "Another roll call for this hostel overlaps that time" },
  FT061: { status: 422, message: "That roll call time is already over" },
  FT002: { status: 404, message: "Roll call not found" },
  FT008: { status: 409, message: "This roll call has not ended yet" },
  FT009: { status: 404, message: "Student not found" },
  "23505": { status: 409, message: "That email or SRN is already registered" }, // a race the pre-checks could not see
  "23514": { status: 400, message: "The values break a database rule (for example, end time must be after start time)" },
};

export function mapAdminError(e: unknown): MappedError | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? (MAP[code] ?? null) : null;
}
