import type { PoolClient } from "pg";
import { COLLECTION, getQdrant } from "./qdrant";

export type Outcome = "matched" | "low_confidence" | "no_match";

export interface Thresholds {
  matchMin: number;
  reviewMin: number;
}

/**
 * Cosine scores of face descriptors are not calibrated: the right cut-offs
 * depend on the model, the camera and the lighting, so they come from env
 * vars and must be tuned with real faces (see docs/vector-design.md).
 */
export function getThresholds(): Thresholds {
  const matchMin = Number(process.env.MATCH_MIN_SCORE ?? "0.85");
  const reviewMin = Number(process.env.REVIEW_MIN_SCORE ?? "0.70");
  if (!Number.isFinite(matchMin) || !Number.isFinite(reviewMin) || reviewMin >= matchMin || matchMin > 1 || reviewMin < 0) {
    throw new Error("MATCH_MIN_SCORE / REVIEW_MIN_SCORE are invalid (need 0 <= REVIEW < MATCH <= 1)");
  }
  return { matchMin, reviewMin };
}

export function classify(score: number | null, t: Thresholds): Outcome {
  if (score === null) return "no_match";
  if (score >= t.matchMin) return "matched";
  if (score >= t.reviewMin) return "low_confidence";
  return "no_match";
}

export interface Candidate {
  studentId: number;
  faceProfileId: number | null;
  score: number;
}

/** Top-2 nearest points in Qdrant (cosine similarity, higher is closer). */
export async function searchTop2(vector: number[]): Promise<{ top: Candidate | null; second: Candidate | null }> {
  const { points: hits } = await getQdrant().query(COLLECTION, { query: vector, limit: 2, with_payload: true });
  const toCandidate = (h: (typeof hits)[number]): Candidate => ({
    studentId: Number(h.payload?.student_id),
    faceProfileId: h.payload?.face_profile_id == null ? null : Number(h.payload.face_profile_id),
    score: h.score,
  });
  return { top: hits[0] ? toCandidate(hits[0]) : null, second: hits[1] ? toCandidate(hits[1]) : null };
}

/** face_events.confidence is NUMERIC(4,3) CHECK 0..1; a cosine can be negative. */
export function toConfidence(score: number | null): number | null {
  if (score === null) return null;
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
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
