import "server-only";
import { randomBytes } from "node:crypto";
import { getPool } from "./db";

export const SCOPES = {
  both: "Violations and leave reasons",
  violations: "Violation details",
  leaves: "Leave reasons",
} as const;
export type Scope = keyof typeof SCOPES;

export const MAX_QUERY_LENGTH = 200;
export const MAX_RESULTS = 50;

// ts_headline wraps each match in marker strings; the page splits on them and
// renders <mark>. The text itself is never inserted as HTML. The markers
// contain a random value chosen per request, so stored text can never contain
// them by accident (or on purpose) and fake a highlight.
export interface Markers { start: string; end: string }

function newMarkers(): Markers {
  const nonce = randomBytes(8).toString("hex"); // hex only, safe inside the SQL option string
  return { start: `[[${nonce}:`, end: `:${nonce}]]` };
}

export function parseSearch(raw: Record<string, string | string[] | undefined>): { q: string; scope: Scope; tooLong: boolean } {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const full = pick(raw.q).replace(/\0/g, "").trim(); // PostgreSQL text cannot hold NUL bytes
  const scope = pick(raw.scope);
  return {
    q: full.slice(0, MAX_QUERY_LENGTH),
    scope: Object.prototype.hasOwnProperty.call(SCOPES, scope) ? (scope as Scope) : "both",
    tooLong: full.length > MAX_QUERY_LENGTH,
  };
}

export interface SearchHit {
  source: "violation" | "leave";
  id: number;
  student: string;
  roll_no: string;
  hostel: string;
  kind: string;
  happened: string;
  rank: number;
  snippet: string;
}

// websearch_to_tsquery understands plain words, "quoted phrases", OR and -exclusion
// and never raises a syntax error, whatever the user types. The text indexes are
// the generated columns from db/b_search.sql (load them with ./db/load_b.sh).
export async function searchText(q: string, scope: Scope): Promise<{ hits: SearchHit[]; markers: Markers }> {
  const markers = newMarkers();
  const opts = `StartSel=${markers.start}, StopSel=${markers.end}, MaxWords=30, MinWords=10`;
  const { rows } = await getPool().query(
    `WITH query AS (SELECT websearch_to_tsquery('english', $1) AS tsq)
     SELECT * FROM (
       SELECT 'violation'::text AS source, v.violation_id AS id, s.name AS student, s.roll_no, h.name AS hostel,
              v.type || ' (' || v.status || ')' AS kind,
              to_char(v.raised_at, 'DD Mon YYYY HH24:MI') AS happened,
              ts_rank(v.details_tsv, query.tsq) AS rank,
              ts_headline('english', coalesce(v.details, ''), query.tsq, '${opts}') AS snippet
       FROM violations v
       JOIN students s ON s.student_id = v.student_id
       JOIN hostels  h ON h.hostel_id  = s.hostel_id, query
       WHERE $2::text IN ('both', 'violations') AND v.details_tsv @@ query.tsq
       UNION ALL
       SELECT 'leave'::text, l.leave_id, s.name, s.roll_no, h.name,
              l.status,
              to_char(l.start_date, 'DD Mon YYYY'),
              ts_rank(l.reason_tsv, query.tsq),
              ts_headline('english', coalesce(l.reason, ''), query.tsq, '${opts}')
       FROM leave_requests l
       JOIN students s ON s.student_id = l.student_id
       JOIN hostels  h ON h.hostel_id  = s.hostel_id, query
       WHERE $2::text IN ('both', 'leaves') AND l.reason_tsv @@ query.tsq
     ) hits
     ORDER BY rank DESC, source, id
     LIMIT ${MAX_RESULTS}`,
    [q, scope],
  );
  return { hits: rows.map((r) => ({ ...r, rank: Number(r.rank) })), markers };
}
