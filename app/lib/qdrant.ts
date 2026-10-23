import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION = "face_embeddings";
export const VECTOR_SIZE = 128;

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
