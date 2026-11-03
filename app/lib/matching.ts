import type { PoolClient } from "pg";
import { COLLECTION, getQdrant, NOT_DEACTIVATED } from "./qdrant";

export type Outcome = "matched" | "low_confidence" | "no_match";

export interface Thresholds {
  matchMin: number; // student score at or above this: automatic match
  reviewMin: number; // between reviewMin and matchMin: warden review; below: no_match
  minMargin: number; // the winner must beat the best OTHER student by this much
}

/**
 * Cosine similarity between ArcFace embeddings (higher is closer, 1 = identical).
 * These defaults are STARTING GUESSES, not measured values: calibrate them with
 * `npm run faces:eval` on photos from your own camera (see docs/vector-design.md).
 */
export function getThresholds(): Thresholds {
  const matchMin = Number(process.env.MATCH_MIN_SIMILARITY ?? "0.50");
  const reviewMin = Number(process.env.REVIEW_MIN_SIMILARITY ?? "0.35");
  const minMargin = Number(process.env.MIN_MARGIN ?? "0.08");
  if (
    !Number.isFinite(matchMin) || !Number.isFinite(reviewMin) || !Number.isFinite(minMargin) ||
    reviewMin <= 0 || matchMin <= reviewMin || matchMin > 1 || minMargin < 0
  ) {
    throw new Error("MATCH_MIN_SIMILARITY / REVIEW_MIN_SIMILARITY / MIN_MARGIN are invalid (need 0 < REVIEW < MATCH <= 1, MARGIN >= 0)");
  }
  return { matchMin, reviewMin, minMargin };
}

// A scan is accepted only if the same student wins this many usable frames.
export const MIN_AGREEING_FRAMES = 2;

export const DEFAULT_SCAN_COOLDOWN_SECONDS = 20;
const warnedCooldownValues = new Set<string>();

/**
 * Minimum seconds between two gate (entry/exit) scans of the same student, from
 * SCAN_COOLDOWN_SECONDS. 0 disables it. A missing value means the default; an
 * invalid value falls back to the default with a one-time server-side warning.
 */
export function getScanCooldownSeconds(): number {
  const raw = process.env.SCAN_COOLDOWN_SECONDS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_SCAN_COOLDOWN_SECONDS;
  if (/^\d{1,6}$/.test(raw)) return Number(raw);
  if (!warnedCooldownValues.has(raw)) {
    warnedCooldownValues.add(raw);
    console.warn(`SCAN_COOLDOWN_SECONDS="${raw}" is not a non-negative integer; using ${DEFAULT_SCAN_COOLDOWN_SECONDS}`);
  }
  return DEFAULT_SCAN_COOLDOWN_SECONDS;
}

/**
 * Gate-scan cooldown check. Call it inside the transaction, BEFORE inserting
 * anything for the scan. It takes a per-student advisory lock (held until the
 * transaction ends), so two simultaneous scans of one student take turns and
 * the second sees the first one's gate log row. The two-integer key does not
 * collide with the single-class locks used inside the procedures.
 *
 * The age is computed in PostgreSQL on the same basis that
 * entry_exit_log.event_time uses: wall-clock time in the session time zone
 * (Asia/Kolkata) stored as TIMESTAMP, so Node's clock is never compared with
 * the database's. Returns the seconds still to wait, or null if the scan may go on.
 */
export async function secondsUntilGateScanAllowed(client: PoolClient, studentId: number, cooldownSeconds: number): Promise<number | null> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('gate_cooldown'), $1)", [studentId]);
  const { rows } = await client.query<{ remaining: number }>(
    `SELECT CEIL($2::numeric - EXTRACT(EPOCH FROM (clock_timestamp()::timestamp - event_time)))::int AS remaining
     FROM entry_exit_log
     WHERE student_id = $1
     ORDER BY event_time DESC, log_id DESC
     LIMIT 1`,
    [studentId, cooldownSeconds],
  );
  const remaining = rows[0]?.remaining;
  if (remaining === undefined || remaining <= 0) return null;
  return Math.min(remaining, cooldownSeconds); // a log row dated in the future still waits at most one cooldown
}

export interface PointHit {
  studentId: number;
  similarity: number;
}

export interface StudentScore {
  studentId: number;
  score: number; // mean of the student's best two sample similarities (the best one if only one sample)
}

/**
 * Groups search hits by student. A student's score is the mean of their best two
 * sample similarities, or the best one if they have a single sample in the hits.
 * Sorted best first.
 */
export function rankStudents(hits: PointHit[]): StudentScore[] {
  const byStudent = new Map<number, number[]>();
  for (const h of hits) {
    const list = byStudent.get(h.studentId) ?? [];
    list.push(h.similarity);
    byStudent.set(h.studentId, list);
  }
  const ranked: StudentScore[] = [];
  for (const [studentId, sims] of byStudent) {
    sims.sort((a, b) => b - a);
    const best = sims.slice(0, 2);
    ranked.push({ studentId, score: best.reduce((x, y) => x + y, 0) / best.length });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export interface FrameVerdict {
  outcome: Outcome;
  top: StudentScore | null;
  margin: number | null; // top.score - best other student's score; null if nobody else is in the hits
}

/**
 * One frame: score >= matchMin -> matched; >= reviewMin -> low_confidence; else no_match.
 * Margin rule: a match whose margin over the best other student is below minMargin
 * is downgraded to low_confidence.
 */
export function classifyFrame(ranked: StudentScore[], t: Thresholds): FrameVerdict {
  const top = ranked[0] ?? null;
  if (!top || top.score < t.reviewMin) return { outcome: "no_match", top, margin: null };
  const margin = ranked[1] ? top.score - ranked[1].score : null;
  if (top.score < t.matchMin) return { outcome: "low_confidence", top, margin };
  if (margin !== null && margin < t.minMargin) return { outcome: "low_confidence", top, margin };
  return { outcome: "matched", top, margin };
}

export interface ScanDecision {
  outcome: Outcome;
  studentId: number | null;
  similarity: number | null; // mean score of the frames that back the decision
  margin: number | null; // smallest margin among those frames
  usableFrames: number;
  agreeingFrames: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Combines the per-frame verdicts of one scan.
 *  - matched: the same student is a confident match (outcome "matched") on at least
 *    MIN_AGREEING_FRAMES frames.
 *  - low_confidence: some frame saw a plausible student but the frames disagree or are
 *    not confident enough; the student with the most votes is suggested to the warden.
 *  - no_match: nobody reached reviewMin on any frame.
 */
export function combineFrames(verdicts: FrameVerdict[]): ScanDecision {
  const usable = verdicts.length;
  const votes = (pred: (v: FrameVerdict) => boolean) => {
    const m = new Map<number, FrameVerdict[]>();
    for (const v of verdicts) {
      if (v.top && pred(v)) m.set(v.top.studentId, [...(m.get(v.top.studentId) ?? []), v]);
    }
    return [...m.entries()]
      .map(([studentId, vs]) => ({ studentId, vs, score: mean(vs.map((v) => v.top!.score)) }))
      .sort((a, b) => b.vs.length - a.vs.length || b.score - a.score);
  };
  const summarise = (c: { studentId: number; vs: FrameVerdict[]; score: number }, outcome: Outcome): ScanDecision => {
    const margins = c.vs.map((v) => v.margin).filter((m): m is number => m !== null);
    return {
      outcome,
      studentId: c.studentId,
      similarity: c.score,
      margin: margins.length ? Math.min(...margins) : null,
      usableFrames: usable,
      agreeingFrames: c.vs.length,
    };
  };

  const confident = votes((v) => v.outcome === "matched")[0];
  if (confident && confident.vs.length >= MIN_AGREEING_FRAMES) return summarise(confident, "matched");

  const plausible = votes((v) => v.outcome !== "no_match")[0];
  if (plausible) return summarise(plausible, "low_confidence");

  const best = verdicts.reduce<number | null>((acc, v) => (v.top && (acc === null || v.top.score > acc) ? v.top.score : acc), null);
  return { outcome: "no_match", studentId: null, similarity: best, margin: null, usableFrames: usable, agreeingFrames: 0 };
}

/** Top 10 stored samples nearest to the embedding, as student similarities. */
export async function searchFrame(embedding: number[]): Promise<StudentScore[]> {
  const { points } = await getQdrant().query(COLLECTION, { query: embedding, limit: 10, with_payload: true, filter: { must_not: [NOT_DEACTIVATED] } });
  return rankStudents(
    points.map((h) => ({ studentId: Number(h.payload?.student_id), similarity: h.score })), // Cosine: the score is the similarity
  );
}

/**
 * face_events.confidence is NUMERIC(4,3) CHECK 0..1: the similarity clamped to
 * 0..1 and rounded to 3 places.
 */
export function toConfidence(similarity: number | null): number | null {
  if (similarity === null) return null;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 1000) / 1000;
}

// Clean, fixed messages for the database's FT*** business-rule errors
// (codes are listed in db/docs/phase3-logic.md section 4).
const PROCEDURE_ERRORS: Record<string, { status: number; message: string }> = {
  FT001: { status: 409, message: "Attendance is already recorded for this student in this roll call" },
  FT002: { status: 404, message: "Roll call session not found" },
  FT003: { status: 403, message: "This student does not live in the hostel of this roll call" },
  FT004: { status: 422, message: "The scan is outside the roll call time window" },
  FT005: { status: 409, message: "A present mark cannot be changed" },
  FT006: { status: 404, message: "Face event not found" },
  FT007: { status: 422, message: "Face event belongs to a different student" },
  FT009: { status: 404, message: "Student not found" },
  FT020: { status: 400, message: "Direction must be IN or OUT" },
  FT021: { status: 422, message: "This gate does not belong to the student's hostel" },
  FT022: { status: 409, message: "Student is already marked in that direction" },
  FT023: { status: 409, message: "Gate event is not later than the student's last gate event" },
  FT024: { status: 422, message: "Face event was captured at a different gate" },
  FT040: { status: 422, message: "A user has the wrong role for this action" },
};

export function mapProcedureError(e: unknown): { code: string; status: number; message: string } | null {
  const code = (e as { code?: string } | null)?.code;
  if (code && PROCEDURE_ERRORS[code]) return { code, ...PROCEDURE_ERRORS[code] };
  return null;
}

/** Runs a CALL in a savepoint so a rejected mark keeps the face event. */
export async function callInSavepoint<T>(client: PoolClient, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  await client.query("SAVEPOINT attempt");
  try {
    const value = await run();
    await client.query("RELEASE SAVEPOINT attempt");
    return { ok: true, value };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    return { ok: false, error };
  }
}
