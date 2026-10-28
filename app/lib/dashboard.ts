import "server-only";
import { getPool } from "./db";

// Filter values come from the URL, so every one is validated here before it
// reaches SQL: ids against the list of real hostels, words against allow-lists.
// An invalid or unknown value is ignored (treated as "no filter").

export const PRESENCE_VALUES = ["inside", "outside"] as const;
export const VIOLATION_TYPES = ["late_return", "missed_attendance", "no_leave"] as const;
export const SORT_OPTIONS = {
  pct_asc: { label: "Attendance %, lowest first", sql: "attendance_pct ASC NULLS LAST, name" },
  pct_desc: { label: "Attendance %, highest first", sql: "attendance_pct DESC NULLS LAST, name" },
  name: { label: "Name", sql: "name" },
} as const;
export type SortKey = keyof typeof SORT_OPTIONS;

export const ROW_LIMIT = 100;
export const LOW_ATTENDANCE_PCT = 75;

export interface Hostel { hostel_id: number; name: string }

export interface Filters {
  hostelId: number | null;
  presence: (typeof PRESENCE_VALUES)[number] | null;
  q: string;
  vtype: (typeof VIOLATION_TYPES)[number] | null;
  sort: SortKey;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseFilters(raw: RawParams, hostels: Hostel[]): Filters {
  const hostelRaw = first(raw.hostel);
  const hostelId = /^\d{1,9}$/.test(hostelRaw) ? Number(hostelRaw) : null;
  const presence = first(raw.presence);
  const vtype = first(raw.vtype);
  const sort = first(raw.sort);
  const q = first(raw.q).trim().slice(0, 50);
  return {
    hostelId: hostelId !== null && hostels.some((h) => h.hostel_id === hostelId) ? hostelId : null,
    presence: (PRESENCE_VALUES as readonly string[]).includes(presence) ? (presence as Filters["presence"]) : null,
    q,
    vtype: (VIOLATION_TYPES as readonly string[]).includes(vtype) ? (vtype as Filters["vtype"]) : null,
    sort: Object.prototype.hasOwnProperty.call(SORT_OPTIONS, sort) ? (sort as SortKey) : "pct_asc",
  };
}

export async function getHostels(): Promise<Hostel[]> {
  const { rows } = await getPool().query<Hostel>("SELECT hostel_id, name FROM hostels ORDER BY name");
  return rows;
}


export interface Limited<T> { rows: T[]; total: number }

async function limited<T>(sql: string, params: unknown[]): Promise<Limited<T>> {
  const { rows } = await getPool().query(sql, params);
  return { rows: rows.map((row) => { const copy = { ...row }; delete copy.total; return copy as T; }), total: rows.length ? Number(rows[0].total) : 0 };
}

export interface PresenceRow {
  student_id: number; roll_no: string; name: string; hostel: string; room_no: string | null;
  presence: "inside" | "outside"; last_seen: string | null; on_leave_today: boolean;
}

export function getPresence(f: Filters): Promise<Limited<PresenceRow>> {
  return limited<PresenceRow>(
    `SELECT student_id, roll_no, name, hostel, room_no, presence,
            to_char(last_event_time, 'DD Mon HH24:MI') AS last_seen, on_leave_today,
            count(*) OVER () AS total
     FROM v_current_presence
     WHERE ($1::int IS NULL OR hostel_id = $1)
       AND ($2::text IS NULL OR presence = $2)
       AND ($3::text = '' OR position(lower($3) in lower(name)) > 0)
     ORDER BY hostel, name
     LIMIT ${ROW_LIMIT}`,
    [f.hostelId, f.presence, f.q],
  );
}

export interface AttendanceRow {
  student_id: number; roll_no: string; name: string; hostel: string;
  sessions_recorded: number; present: number; low_confidence: number; absent: number; attendance_pct: string | null;
}

export function getAttendance(f: Filters): Promise<Limited<AttendanceRow>> {
  // the ORDER BY text comes from the SORT_OPTIONS allow-list, never from the URL
  return limited<AttendanceRow>(
    `SELECT student_id, roll_no, name, hostel, sessions_recorded::int, present::int, low_confidence::int, absent::int,
            attendance_pct, count(*) OVER () AS total
     FROM v_attendance_summary
     WHERE ($1::int IS NULL OR hostel = (SELECT name FROM hostels WHERE hostel_id = $1))
     ORDER BY ${SORT_OPTIONS[f.sort].sql}
     LIMIT ${ROW_LIMIT}`,
    [f.hostelId],
  );
}

export interface ViolationRow {
  violation_id: number; type: string; student: string; roll_no: string; hostel: string; room_no: string | null;
  raised_at: string; details: string | null;
}

export function getOpenViolations(f: Filters): Promise<Limited<ViolationRow>> {
  return limited<ViolationRow>(
    `SELECT violation_id, type, student, roll_no, hostel, room_no,
            to_char(raised_at, 'DD Mon HH24:MI') AS raised_at, details, count(*) OVER () AS total
     FROM v_open_violations
     WHERE ($1::int IS NULL OR hostel = (SELECT name FROM hostels WHERE hostel_id = $1))
       AND ($2::text IS NULL OR type = $2)
     ORDER BY v_open_violations.raised_at DESC, violation_id DESC
     LIMIT ${ROW_LIMIT}`,
    [f.hostelId, f.vtype],
  );
}

export interface MonthlyRow { hostel: string; month: string; marks: number; present: number; attendance_pct: string }

// Same CTE as "CTE 1" in db/b_queries.sql
export async function getMonthlyAttendance(): Promise<MonthlyRow[]> {
  const { rows } = await getPool().query(
    `WITH roll_calls AS (
         SELECT s.hostel_id, date_trunc('month', s.session_date)::date AS month, a.status
         FROM attendance a
         JOIN attendance_sessions s ON s.session_id = a.session_id
     ), per_month AS (
         SELECT hostel_id, month, count(*) AS marks, count(*) FILTER (WHERE status = 'present') AS present
         FROM roll_calls GROUP BY hostel_id, month
     )
     SELECT h.name AS hostel, to_char(p.month, 'Mon YYYY') AS month, p.marks::int, p.present::int,
            round(100.0 * p.present / p.marks, 1) AS attendance_pct
     FROM per_month p JOIN hostels h USING (hostel_id)
     ORDER BY p.month DESC, h.name
     LIMIT ${ROW_LIMIT}`,
  );
  return rows;
}
