import { randomUUID } from "node:crypto";
import { getPool } from "./db";
import { getThresholds } from "./matching";
import { COLLECTION, getQdrant, NOT_DEACTIVATED } from "./qdrant";
import { toEmbedding } from "./vectors";

export class FaceError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

export interface EnrolledProfile {
  faceProfileId: number;
  qdrantPointId: string;
}

/**
 * Duplicate-face guard. Compares the new embeddings with every stored sample of
 * every OTHER student (the student's own samples are excluded, so re-enrolling is fine).
 * Returns the other student whose best sample similarity is at or above
 * REVIEW_MIN_SIMILARITY, or null. There is deliberately no override.
 */
export async function findDuplicateFace(
  studentId: number,
  embeddings: number[][],
): Promise<{ studentId: number; similarity: number } | null> {
  const { reviewMin } = getThresholds();
  let worst: { studentId: number; similarity: number } | null = null;
  for (const embedding of embeddings) {
    const { points } = await getQdrant().query(COLLECTION, {
      query: embedding,
      limit: 1,
      with_payload: true,
      filter: { must_not: [{ key: "student_id", match: { value: studentId } }, NOT_DEACTIVATED] },
    });
    const hit = points[0];
    if (hit && hit.score >= reviewMin && (!worst || hit.score > worst.similarity)) {
      worst = { studentId: Number(hit.payload?.student_id), similarity: hit.score };
    }
  }
  return worst;
}

/**
 * Stores one face_profiles row and one Qdrant point per embedding.
 * Order: duplicate check, insert rows in a transaction (not yet committed), write
 * the points to Qdrant, then commit. If Qdrant fails the rows roll back; if the
 * commit fails the new points are deleted again, so neither side keeps orphans.
 */
export async function enrolEmbeddings(studentId: number, embeddings: unknown[]): Promise<EnrolledProfile[]> {
  const vectors = embeddings.map(toEmbedding);
  if (vectors.some((v) => v === null)) {
    throw new FaceError(400, "Every embedding must be an array of 512 finite numbers");
  }
  const raw = vectors as number[][];

  const client = await getPool().connect();
  const created: EnrolledProfile[] = [];
  let pointsWritten = false;
  try {
    const student = await client.query("SELECT 1 FROM students WHERE student_id = $1", [studentId]);
    if (student.rowCount === 0) throw new FaceError(404, "Student not found");

    const dup = await findDuplicateFace(studentId, raw);
    if (dup) {
      const who = await client.query<{ name: string; roll_no: string }>("SELECT name, roll_no FROM students WHERE student_id = $1", [dup.studentId]);
      const w = who.rows[0];
      throw new FaceError(409, `This face already matches ${w ? `${w.name} (${w.roll_no})` : "another student"}`, "duplicate_face");
    }

    await client.query("BEGIN");
    for (let i = 0; i < raw.length; i++) {
      const pointId = randomUUID();
      const { rows } = await client.query<{ profile_id: number }>(
        "INSERT INTO face_profiles (student_id, qdrant_point_id) VALUES ($1, $2) RETURNING profile_id",
        [studentId, pointId],
      );
      created.push({ faceProfileId: rows[0].profile_id, qdrantPointId: pointId });
    }

    await getQdrant().upsert(COLLECTION, {
      wait: true,
      points: created.map((p, i) => ({
        id: p.qdrantPointId,
        vector: raw[i],
        payload: { student_id: studentId, face_profile_id: p.faceProfileId, active: true },
      })),
    });
    pointsWritten = true;

    await client.query("COMMIT");
    return created;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (created.length > 0) {
      // best effort: remove any points that may have been written
      await getQdrant()
        .delete(COLLECTION, { wait: true, points: created.map((p) => p.qdrantPointId) })
        .catch((err) => console.error("enrol cleanup failed", pointsWritten, err));
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Deletes the face_profiles row and its Qdrant point. Returns false if the profile does not exist. */
export async function deleteProfile(faceProfileId: number): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ qdrant_point_id: string }>(
      "DELETE FROM face_profiles WHERE profile_id = $1 RETURNING qdrant_point_id",
      [faceProfileId],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    // Deleting a missing point is a no-op in Qdrant, so a retry after a failed commit is safe.
    await getQdrant().delete(COLLECTION, { wait: true, points: [rows[0].qdrant_point_id] });
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface FaceSample {
  faceProfileId: number;
  studentId: number;
  qdrantPointId: string;
  enrolledAt: string;
  /** false when an admin deactivated the sample: matching ignores it. A point with no `active` key counts as active. */
  active: boolean;
  /** payload as stored in Qdrant (student_id, face_profile_id, active); the vector itself is never returned */
  payload: Record<string, unknown> | null;
}

async function activeOf(pointIds: string[]): Promise<Map<string, { active: boolean; payload: Record<string, unknown> | null }>> {
  const out = new Map<string, { active: boolean; payload: Record<string, unknown> | null }>();
  if (pointIds.length === 0) return out;
  const found = await getQdrant().retrieve(COLLECTION, { ids: pointIds, with_payload: true, with_vector: false });
  for (const pt of found) out.set(String(pt.id), { active: pt.payload?.active !== false, payload: (pt.payload as Record<string, unknown>) ?? null });
  return out;
}

/** READ: one face sample, from PostgreSQL (who it belongs to) and Qdrant (its payload, by point id). Null if the profile does not exist. */
export async function getSample(faceProfileId: number): Promise<FaceSample | null> {
  const { rows } = await getPool().query<{ profile_id: number; student_id: number; qdrant_point_id: string; enrolled_at: string }>(
    "SELECT profile_id, student_id, qdrant_point_id, enrolled_at FROM face_profiles WHERE profile_id = $1",
    [faceProfileId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const q = (await activeOf([r.qdrant_point_id])).get(r.qdrant_point_id);
  // a row whose point is missing in Qdrant is reported as inactive with no payload (it cannot be matched)
  return { faceProfileId: r.profile_id, studentId: r.student_id, qdrantPointId: r.qdrant_point_id, enrolledAt: r.enrolled_at, active: q?.active ?? false, payload: q?.payload ?? null };
}

/** READ: every sample of one student, with its active flag. */
export async function listSamples(studentId: number): Promise<FaceSample[]> {
  const { rows } = await getPool().query<{ profile_id: number; student_id: number; qdrant_point_id: string; enrolled_at: string }>(
    "SELECT profile_id, student_id, qdrant_point_id, enrolled_at FROM face_profiles WHERE student_id = $1 ORDER BY profile_id",
    [studentId],
  );
  const state = await activeOf(rows.map((r) => r.qdrant_point_id));
  return rows.map((r) => {
    const q = state.get(r.qdrant_point_id);
    return { faceProfileId: r.profile_id, studentId: r.student_id, qdrantPointId: r.qdrant_point_id, enrolledAt: r.enrolled_at, active: q?.active ?? false, payload: q?.payload ?? null };
  });
}

/**
 * UPDATE: deactivate or reactivate a sample by changing the `active` key of its Qdrant payload
 * (set_payload merges, so student_id and face_profile_id are kept). Returns the new state, or null
 * if the profile does not exist. The vector is never touched, so reactivating restores it exactly.
 */
export async function setSampleActive(faceProfileId: number, active: boolean): Promise<FaceSample | null> {
  const { rows } = await getPool().query<{ qdrant_point_id: string }>("SELECT qdrant_point_id FROM face_profiles WHERE profile_id = $1", [faceProfileId]);
  if (rows.length === 0) return null;
  await getQdrant().setPayload(COLLECTION, { payload: { active }, points: [rows[0].qdrant_point_id], wait: true });
  return getSample(faceProfileId);
}
