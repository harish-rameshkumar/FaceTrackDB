import { randomUUID } from "node:crypto";
import { getPool } from "./db";
import { COLLECTION, getQdrant } from "./qdrant";
import { toUnitVector } from "./vectors";

export class FaceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface EnrolledProfile {
  faceProfileId: number;
  qdrantPointId: string;
}

/**
 * Stores one face_profiles row and one Qdrant point per descriptor.
 * Order: insert rows in a transaction (not yet committed), write the
 * points to Qdrant, then commit. If Qdrant fails the rows roll back; if the
 * commit fails the new points are deleted again, so neither side keeps
 * orphans.
 */
export async function enrolDescriptors(studentId: number, descriptors: unknown[]): Promise<EnrolledProfile[]> {
  const vectors = descriptors.map(toUnitVector);
  if (vectors.some((v) => v === null)) {
    throw new FaceError(400, "Every descriptor must be an array of 128 finite numbers");
  }
  const unit = vectors as number[][];

  const client = await getPool().connect();
  const created: EnrolledProfile[] = [];
  let pointsWritten = false;
  try {
    await client.query("BEGIN");
    const student = await client.query("SELECT 1 FROM students WHERE student_id = $1", [studentId]);
    if (student.rowCount === 0) throw new FaceError(404, "Student not found");

    for (let i = 0; i < unit.length; i++) {
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
        vector: unit[i],
        payload: { student_id: studentId, face_profile_id: p.faceProfileId },
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
