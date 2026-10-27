// Idempotent: creates the face_embeddings collection (512-d, Cosine) if it
// is missing, and fails loudly if it exists with a different configuration.
// Run: npm run qdrant:init
import { checkCollection, COLLECTION, createCollection, DISTANCE, VECTOR_SIZE } from "../lib/qdrant";

async function main() {
  let status = await checkCollection();
  if (status.state === "missing") {
    await createCollection();
    console.log(`Created collection ${COLLECTION} (${VECTOR_SIZE}-d, ${DISTANCE})`);
    status = await checkCollection();
  }
  if (status.state !== "ok") {
    console.error(`Collection ${COLLECTION} has the wrong configuration:`, status);
    process.exit(1);
  }
  console.log(`OK: ${COLLECTION} size=${status.size} distance=${status.distance} points=${status.points}`);
}

main().catch((e) => {
  console.error("create-collection failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
