import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION = "face_embeddings";
export const VECTOR_SIZE = 128;
// face-api descriptors are trained for Euclidean (L2) distance, so the
// collection uses Euclid. In Qdrant a Euclid "score" is the distance itself:
// smaller is closer.
export const DISTANCE = "Euclid";

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

/** Confirms the collection exists with 128 dimensions and cosine distance. */
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

/** Creates the collection (128-d, Euclid) plus its student_id payload index. */
export async function createCollection(): Promise<void> {
  const q = getQdrant();
  await q.createCollection(COLLECTION, { vectors: { size: VECTOR_SIZE, distance: DISTANCE } });
  // filter by student_id (e.g. when deleting a student's vectors)
  await q.createPayloadIndex(COLLECTION, { field_name: "student_id", field_schema: "integer", wait: true });
}
