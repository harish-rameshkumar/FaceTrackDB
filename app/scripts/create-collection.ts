// Idempotent: creates the face_embeddings collection (128-d, cosine) if it
// is missing, and fails loudly if it exists with a different configuration.
// Run: npm run qdrant:init
import { checkCollection, COLLECTION, getQdrant, VECTOR_SIZE } from "../lib/qdrant";

async function main() {
  const q = getQdrant();
  let status = await checkCollection();
  if (status.state === "missing") {
    await q.createCollection(COLLECTION, { vectors: { size: VECTOR_SIZE, distance: "Cosine" } });
    // filter by student_id (e.g. when deleting a student's vectors)
    await q.createPayloadIndex(COLLECTION, { field_name: "student_id", field_schema: "integer", wait: true });
    console.log(`Created collection ${COLLECTION} (${VECTOR_SIZE}-d, Cosine)`);
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
