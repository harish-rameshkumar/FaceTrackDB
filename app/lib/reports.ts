import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "./db";

// ---------------------------------------------------------------------------
// Filters. They come from the URL, so each value is validated and an invalid one
// is ignored (falls back to the default) instead of reaching SQL.
// ---------------------------------------------------------------------------
export interface ReportFilters {
  from: string; // YYYY-MM-DD, inclusive
  to: string;
  hostelId: number | null;
}
export interface Hostel { hostel_id: number; name: string }

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 366 * 5;

function realDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v); // rejects 2026-02-30 and 2026-13-45
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export async function parseReportFilters(raw: Record<string, string | string[] | undefined>, hostels: Hostel[]): Promise<ReportFilters> {
  // "today" in India, from the database, so the default range does not depend on the server's zone
  const today: string = (await getPool().query("SELECT to_char(current_date, 'YYYY-MM-DD') AS d")).rows[0].d;
  let to = realDate(first(raw.to)) ? first(raw.to) : today;
  let from = realDate(first(raw.from)) ? first(raw.from) : addDays(to, -DEFAULT_RANGE_DAYS);
  if (from > to) [from, to] = [to, from];
  if (Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * DAY_MS) from = addDays(to, -MAX_RANGE_DAYS);
  const h = first(raw.hostel);
  const hostelId = /^\d{1,9}$/.test(h) && hostels.some((x) => x.hostel_id === Number(h)) ? Number(h) : null;
  return { from, to, hostelId };
}

export async function getHostels(): Promise<Hostel[]> {
  return (await getPool().query("SELECT hostel_id, name FROM hostels ORDER BY name")).rows;
}

// ---------------------------------------------------------------------------
// The reports. Each one is a SQL function in db/b_reports.sql; the slide shows that
// function's text, read from the file. `finding` writes the slide title from the rows.
// ---------------------------------------------------------------------------
type Row = Record<string, string | number | null>;
const n = (v: unknown) => Number(v ?? 0);
const sum = (rows: Row[], k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((1000 * a) / b) / 10);
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const TYPE_LABEL: Record<string, string> = { late_return: "late return", missed_attendance: "missed roll call", no_leave: "leaving without leave" };

export interface KeyNumber { label: string; value: string }
export interface ReportDef {
  key: string;
  fn: string; // SQL function name
  extraArgs?: string; // extra literal arguments, fixed in code
  concept: string; // "SQL concept used" label
  chart: "bars" | "stacked" | "hbars" | "steps";
  finding: (rows: Row[]) => string;
  numbers: (rows: Row[]) => KeyNumber[];
  note?: string; // honest limits, shown under the chart
  hasData?: (rows: Row[]) => boolean; // for reports that return zero-filled rows even when nothing happened
}

export const REPORTS: ReportDef[] = [
  {
    key: "attendance_by_hostel_month", fn: "report_attendance_by_hostel_month", concept: "CTE (WITH ... AS)", chart: "bars",
    note: "A mark counts as attendance only when it is 'present'; 'low_confidence' marks waiting for the warden count as not present.",
    finding: (r) => {
      const by = new Map<string, [number, number]>();
      for (const x of r) by.set(String(x.hostel), [(by.get(String(x.hostel))?.[0] ?? 0) + n(x.present), (by.get(String(x.hostel))?.[1] ?? 0) + n(x.marks)]);
      const ranked = [...by].map(([h, [p, m]]) => ({ h, p: pct(p, m) })).sort((a, b) => b.p - a.p);
      return ranked.length > 1
        ? `${ranked[0].h} had the best roll-call attendance: ${ranked[0].p}%, against ${ranked[ranked.length - 1].p}% at ${ranked[ranked.length - 1].h}`
        : `Roll-call attendance at ${ranked[0].h} was ${ranked[0].p}%`;
    },
    numbers: (r) => [
      { label: "Overall attendance", value: `${pct(sum(r, "present"), sum(r, "marks"))}%` },
      { label: "Roll-call marks", value: String(sum(r, "marks")) },
      { label: "Months covered", value: String(new Set(r.map((x) => x.month)).size) },
    ],
  },
  {
    key: "violations_by_type_hostel", fn: "report_violations_by_type_hostel", extraArgs: ", 1", concept: "GROUP BY with HAVING", chart: "bars",
    finding: (r) => {
      const by = new Map<string, number>();
      for (const x of r) by.set(String(x.type), (by.get(String(x.type)) ?? 0) + n(x.violations));
      const top = [...by].sort((a, b) => b[1] - a[1])[0];
      return `${TYPE_LABEL[top[0]] ?? top[0]} is the most common violation: ${top[1]} of ${sum(r, "violations")}`.replace(/^./, (c) => c.toUpperCase());
    },
    numbers: (r) => [
      { label: "Violations", value: String(sum(r, "violations")) },
      { label: "Still open", value: String(sum(r, "still_open")) },
      { label: "Resolved", value: String(sum(r, "violations") - sum(r, "still_open")) },
    ],
  },
  {
    key: "cumulative_violations", fn: "report_cumulative_violations", concept: "Window function: SUM() OVER (PARTITION BY ... ORDER BY ...)", chart: "steps",
    finding: (r) => {
      const last = new Map<string, number>();
      for (const x of r) last.set(String(x.hostel), n(x.cumulative));
      const top = [...last].sort((a, b) => b[1] - a[1])[0];
      return `${plural(sum(r, "violations"), "violation")} so far; ${top[0]} has the most (${top[1]})`;
    },
    numbers: (r) => [
      { label: "Total violations", value: String(sum(r, "violations")) },
      { label: "Days with a violation", value: String(new Set(r.map((x) => x.day)).size) },
      { label: "Last one on", value: String(r[r.length - 1]?.day ?? "–") },
    ],
  },
  {
    key: "late_return_rank", fn: "report_late_return_rank", concept: "Window functions: RANK() and DENSE_RANK()", chart: "hbars",
    note: "Ties share a rank: RANK() skips the next number after a tie, DENSE_RANK() does not.",
    finding: (r) => {
      const top = [...r].sort((a, b) => n(b.late_returns) - n(a.late_returns))[0];
      return `${top.student} (${top.hostel}) has the most late returns: ${top.late_returns}`;
    },
    numbers: (r) => [
      { label: "Students with late returns", value: String(r.length) },
      { label: "Most by one student", value: String(Math.max(...r.map((x) => n(x.late_returns)))) },
      { label: "Late returns listed", value: String(sum(r, "late_returns")) },
    ],
  },
  {
    key: "gate_traffic_by_hour", fn: "report_gate_traffic_by_hour", concept: "GROUP BY on EXTRACT(hour) + generate_series", chart: "bars",
    hasData: (r) => sum(r, "crossings") > 0,
    finding: (r) => {
      const peak = (d: string) => r.filter((x) => x.direction === d).sort((a, b) => n(b.crossings) - n(a.crossings))[0];
      const o = peak("OUT"), i = peak("IN");
      return `Most exits happen around ${hourLabel(n(o.hour))} and most returns around ${hourLabel(n(i.hour))}`;
    },
    numbers: (r) => [
      { label: "Gate crossings", value: String(sum(r, "crossings")) },
      { label: "Exits (OUT)", value: String(sum(r.filter((x) => x.direction === "OUT"), "crossings")) },
      { label: "Returns (IN)", value: String(sum(r.filter((x) => x.direction === "IN"), "crossings")) },
    ],
  },
  {
    key: "time_outside", fn: "report_time_outside", concept: "Window function LEAD() (via a view)", chart: "bars",
    note: "A trip is an OUT followed by the same student's next IN; a student who has not returned yet is not counted.",
    finding: (r) => {
      const trips = sum(r, "trips");
      const avg = r.reduce((s, x) => s + n(x.avg_hours) * n(x.trips), 0) / trips;
      const longest = [...r].sort((a, b) => n(b.avg_hours) - n(a.avg_hours))[0];
      return `A trip outside lasts ${avg.toFixed(1)} hours on average; ${longest.weekday} trips are the longest (${n(longest.avg_hours).toFixed(1)} h)`;
    },
    numbers: (r) => [
      { label: "Completed trips", value: String(sum(r, "trips")) },
      { label: "Average time outside", value: `${(r.reduce((s, x) => s + n(x.avg_hours) * n(x.trips), 0) / sum(r, "trips")).toFixed(1)} h` },
      { label: "Longest weekday average", value: `${Math.max(...r.map((x) => n(x.avg_hours))).toFixed(1)} h` },
    ],
  },
  {
    key: "leave_summary", fn: "report_leave_summary", concept: "Aggregate FILTER and percentile_cont (median)", chart: "bars",
    note: "How long a request waited for a decision cannot be measured: leave requests have no 'requested at' time. The median lead time is the days between the decision and the first day of leave.",
    finding: (r) => {
      const by = (s: string) => sum(r.filter((x) => x.status === s), "requests");
      return `${plural(sum(r, "requests"), "leave request")}: ${by("approved")} approved, ${by("rejected")} rejected, ${by("pending")} pending`;
    },
    numbers: (r) => {
      const med = r.map((x) => n(x.median_days)).sort((a, b) => a - b);
      return [
        { label: "Leave requests", value: String(sum(r, "requests")) },
        { label: "Approved", value: String(sum(r.filter((x) => x.status === "approved"), "requests")) },
        { label: "Typical length (median)", value: `${med[Math.floor(med.length / 2)]} days` },
      ];
    },
  },
  {
    key: "recognition_outcomes", fn: "report_recognition_outcomes", concept: "Aggregate FILTER with date_trunc('week')", chart: "stacked",
    finding: (r) => {
      const t = sum(r, "scans");
      return `${pct(sum(r, "matched"), t)}% of ${t} face scans matched automatically; ${pct(sum(r, "low_confidence"), t)}% went to review and ${pct(sum(r, "no_match"), t)}% found no match`;
    },
    numbers: (r) => {
      const t = sum(r, "scans");
      return [
        { label: "Face scans", value: String(t) },
        { label: "Matched automatically", value: `${pct(sum(r, "matched"), t)}%` },
        { label: "Mean similarity", value: (r.reduce((s, x) => s + n(x.avg_similarity) * n(x.scans), 0) / t).toFixed(2) },
      ];
    },
  },
  {
    key: "similarity_distribution", fn: "report_similarity_distribution", concept: "width_bucket() histogram", chart: "stacked",
    hasData: (r) => sum(r, "scans") > 0,
    note: "Similarity is the cosine similarity stored in face_events.confidence. Scans written before the ArcFace model came from a different model and are not comparable.",
    finding: (r) => {
      const byBand = new Map<string, number>();
      for (const x of r) byBand.set(String(x.band), (byBand.get(String(x.band)) ?? 0) + n(x.scans));
      const top = [...byBand].sort((a, b) => b[1] - a[1])[0];
      return `Most scans (${pct(top[1], sum(r, "scans"))}%) score ${top[0]} similarity`;
    },
    numbers: (r) => {
      const t = sum(r, "scans");
      const hi = sum(r.filter((x) => n(x.band_no) >= 8), "scans");
      return [
        { label: "Scans with a similarity", value: String(t) },
        { label: "Scoring 0.7 or more", value: `${pct(hi, t)}%` },
        { label: "Matched but below 0.7", value: String(sum(r.filter((x) => x.outcome === "matched" && n(x.band_no) < 8), "scans")) },
      ];
    },
  },
  {
    key: "low_attendance_students", fn: "report_low_attendance_students", extraArgs: ", 75", concept: "Subqueries (derived table and IN)", chart: "hbars",
    note: "Only students with at least 3 roll-call marks are considered.",
    finding: (r) => `${plural(r.length, "student")} ${r.length === 1 ? "is" : "are"} below 75% roll-call attendance`,
    numbers: (r) => [
      { label: "Students below 75%", value: String(r.length) },
      { label: "Lowest attendance", value: `${Math.min(...r.map((x) => n(x.attendance_pct)))}%` },
      { label: "Marks behind the list", value: String(sum(r, "marks")) },
    ],
  },
  {
    key: "top_words", fn: "report_top_words", concept: "Full-text search: to_tsvector and lexemes", chart: "hbars",
    note: "Words are stemmed lexemes (for example 'famili' stands for family). Search terms typed on the search page are not logged, so a 'top search terms' report is not possible.",
    finding: (r) => {
      const lv = r.filter((x) => x.source === "leave reasons")[0];
      return `"${r[0].word}" is the most common word in violation details${lv ? `; in leave reasons it is "${lv.word}" (${lv.occurrences} times)` : ""}`;
    },
    numbers: (r) => [
      { label: "Top word", value: String(r[0].word) },
      { label: "Occurrences", value: String(n(r[0].occurrences)) },
      { label: "Words listed", value: String(r.length) },
    ],
  },
];

export interface ReportResult {
  key: string;
  title: string;
  concept: string;
  chart: ReportDef["chart"];
  numbers: KeyNumber[];
  note: string | null;
  rows: Row[];
  sql: string;
  empty: boolean;
}

// The text of each report's function, read from db/b_reports.sql (not copied into the app).
let sqlCache: Map<string, string> | null = null;
function reportSql(key: string): string {
  if (!sqlCache) {
    const text = readFileSync(resolve(process.cwd(), "..", "db", "b_reports.sql"), "utf8");
    sqlCache = new Map();
    for (const m of text.matchAll(/-- @report (\w+)\n([\s\S]*?)-- @end/g)) sqlCache.set(m[1], m[2].trim());
  }
  return sqlCache.get(key) ?? "(query text not found in db/b_reports.sql)";
}

export async function runReports(f: ReportFilters): Promise<ReportResult[]> {
  const pool = getPool();
  return Promise.all(
    REPORTS.map(async (d): Promise<ReportResult> => {
      // d.fn and d.extraArgs are constants from the list above; all user input is a parameter
      const { rows } = await pool.query(`SELECT * FROM ${d.fn}($1::date, $2::date, $3::int${d.extraArgs ?? ""})`, [f.from, f.to, f.hostelId]);
      const empty = rows.length === 0 || (d.hasData ? !d.hasData(rows) : false);
      return {
        key: d.key, concept: d.concept, chart: d.chart, note: d.note ?? null, rows, empty, sql: reportSql(d.key),
        title: empty ? `${TITLE_WHEN_EMPTY[d.key]}: no data for this range` : d.finding(rows),
        numbers: empty ? [] : d.numbers(rows),
      };
    }),
  );
}

const TITLE_WHEN_EMPTY: Record<string, string> = {
  attendance_by_hostel_month: "Roll-call attendance", violations_by_type_hostel: "Violations by type", cumulative_violations: "Violations over time",
  late_return_rank: "Late returns by student", gate_traffic_by_hour: "Gate traffic by hour", time_outside: "Time outside per trip",
  leave_summary: "Leave requests", recognition_outcomes: "Face recognition outcomes", similarity_distribution: "Face similarity scores",
  low_attendance_students: "Students below 75% attendance", top_words: "Most common words",
};

/** Set by `npm run demo:history`; the reports page shows a note while it applies to the selected range. */
export async function getGeneratedHistoryNote(f: ReportFilters): Promise<string | null> {
  const { rows } = await getPool().query("SELECT value FROM b_meta WHERE key = 'generated_history'");
  if (!rows[0]) return null;
  try {
    const v = JSON.parse(rows[0].value) as { days: number; from: string; to: string; first_event_id?: number; last_event_id?: number };
    // only when the selected range overlaps the generated days
    if (f.to < v.from || f.from > v.to) return null;
    // the label only counts while some of the generated rows still exist: b_demo_rows lists them exactly;
    // a label from before that table existed falls back to its range of face-event ids
    const tracked = await getPool().query("SELECT 1 FROM b_demo_rows WHERE kind = 'face_event' LIMIT 1").catch(() => null);
    if (tracked) {
      if (tracked.rowCount === 0) return null;
    } else if (typeof v.first_event_id === "number" && typeof v.last_event_id === "number") {
      const still = await getPool().query("SELECT 1 FROM face_events WHERE event_id BETWEEN $1 AND $2 LIMIT 1", [v.first_event_id, v.last_event_id]);
      if (still.rowCount === 0) return null;
    }
    return `Includes generated demo history: ${v.days} days from ${v.from} to ${v.to}. It is simulated data, not real activity.`;
  } catch {
    return "Includes generated demo history. It is simulated data, not real activity.";
  }
}
