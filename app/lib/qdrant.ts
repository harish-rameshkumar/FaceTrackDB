import { QdrantClient } from "@qdrant/js-client-rest";

// QDRANT_COLLECTION only exists so the tests can use a throw-away collection;
// leave it unset in normal use.
export const COLLECTION = process.env.QDRANT_COLLECTION?.trim() || "face_embeddings";
// InsightFace ArcFace (buffalo_l) gives 512-d vectors trained for angular
// similarity. The embedder returns them L2-normalised, and the collection uses
// Cosine, so a Qdrant "score" is the cosine similarity itself: higher is closer.
export const VECTOR_SIZE = 512;
export const DISTANCE = "Cosine";

const globalForQdrant = globalThis as unknown as { __ftQdrant?: QdrantClient };

export function getQdrant(): QdrantClient {
  if (!globalForQdrant.__ftQdrant) {
    const url = process.env.QDRANT_URL;
    if (!url) throw new Error("QDRANT_URL is not set (see .env.example)");
    globalForQdrant.__ftQdrant = new QdrantClient({
      url,
      apiKey: process.env.QDRANT_API_KEY,
    });
  }
  return globalForQdrant.__ftQdrant;
}

export type CollectionStatus =
  | { state: "missing" }
  | { state: "mismatch"; size?: number; distance?: string }
  | { state: "ok"; size: number; distance: string; points: number };

/** Confirms the collection exists with 512 dimensions and cosine distance. */
export async function checkCollection(): Promise<CollectionStatus> {
  const q = getQdrant();
  const { collections } = await q.getCollections();
  if (!collections.some((c) => c.name === COLLECTION)) return { state: "missing" };
  const info = await q.getCollection(COLLECTION);
  const vectors = info.config.params.vectors;
  // an unnamed single-vector config is an object with size/distance
  const cfg = vectors as { size?: number; distance?: string } | undefined;
  if (!cfg || cfg.size !== VECTOR_SIZE || cfg.distance !== DISTANCE) {
    return { state: "mismatch", size: cfg?.size, distance: cfg?.distance };
  }
  return { state: "ok", size: cfg.size, distance: cfg.distance, points: info.points_count ?? 0 };
}

/** Creates the collection (512-d, Cosine) plus its student_id payload index. */
export async function createCollection(): Promise<void> {
  const q = getQdrant();
  await q.createCollection(COLLECTION, { vectors: { size: VECTOR_SIZE, distance: DISTANCE } });
  // filter by student_id (e.g. when deleting a student's vectors)
  await q.createPayloadIndex(COLLECTION, { field_name: "student_id", field_schema: "integer", wait: true });
}
