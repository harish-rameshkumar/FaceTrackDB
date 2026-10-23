import type { PoolClient } from "pg";
import { COLLECTION, getQdrant } from "./qdrant";

export type Outcome = "matched" | "low_confidence" | "no_match";

export interface Thresholds {
  matchMax: number;
  reviewMax: number;
  marginMin: number;
}

// If the best match and the nearest face of a DIFFERENT student are closer
// together than this, the scan is ambiguous and goes to the warden.
export const MARGIN_MIN = 0.06;

/**
 * Euclidean distance between face-api descriptors: the same person is
 * usually below about 0.6. The defaults are a starting point and must be
 * tuned with real faces from the real camera (see docs/vector-design.md).
 */
export function getThresholds(): Thresholds {
  const matchMax = Number(process.env.MATCH_MAX_DISTANCE ?? "0.45");
  const reviewMax = Number(process.env.REVIEW_MAX_DISTANCE ?? "0.60");
  if (!Number.isFinite(matchMax) || !Number.isFinite(reviewMax) || matchMax <= 0 || reviewMax <= matchMax) {
    throw new Error("MATCH_MAX_DISTANCE / REVIEW_MAX_DISTANCE are invalid (need 0 < MATCH < REVIEW)");
  }
  return { matchMax, reviewMax, marginMin: MARGIN_MIN };
}

export interface Candidate {
  studentId: number;
  faceProfileId: number | null;
  distance: number;
}

/**
 * distance <= matchMax -> matched; <= reviewMax -> low_confidence; else no_match.
 * Margin rule: a match whose runner-up (nearest face of another student) is
 * less than marginMin further away is downgraded to low_confidence.
 */
export function classify(top: Candidate | null, runnerUp: Candidate | null, t: Thresholds): Outcome {
  if (!top) return "no_match";
  if (top.distance > t.reviewMax) return "no_match";
  if (top.distance > t.matchMax) return "low_confidence";
  if (runnerUp && runnerUp.studentId !== top.studentId && runnerUp.distance - top.distance < t.marginMin) {
    return "low_confidence";
  }
  return "matched";
}

/**
 * Nearest stored face, plus the nearest face of a different student (the
 * runner-up). A student has several samples, so the 2nd-nearest point is
 * often the same student; we look a few points further for another one.
 */
export async function searchNearest(vector: number[]): Promise<{ top: Candidate | null; runnerUp: Candidate | null }> {
  const { points } = await getQdrant().query(COLLECTION, { query: vector, limit: 10, with_payload: true });
  const candidates = points.map(
    (h): Candidate => ({
      studentId: Number(h.payload?.student_id),
      faceProfileId: h.payload?.face_profile_id == null ? null : Number(h.payload.face_profile_id),
      distance: h.score, // Euclid: the score is the distance
    }),
  );
  const top = candidates[0] ?? null;
  const runnerUp = top ? (candidates.find((c) => c.studentId !== top.studentId) ?? null) : null;
  return { top, runnerUp };
}

/**
 * face_events.confidence is NUMERIC(4,3) CHECK 0..1, so a distance is stored
 * as confidence = max(0, 1 - distance), rounded to 3 places.
 */
export function toConfidence(distance: number | null): number | null {
  if (distance === null) return null;
  return Math.round(Math.max(0, Math.min(1, 1 - distance)) * 1000) / 1000;
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
