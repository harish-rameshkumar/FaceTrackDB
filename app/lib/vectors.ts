import { VECTOR_SIZE } from "./qdrant";

/**
 * Validates a face embedding (512 finite numbers, not all zero) and returns an
 * L2-normalised copy. The embedder already returns unit vectors; normalising
 * again keeps cosine similarity equal to a plain dot product whatever the caller sent.
 */
export function toEmbedding(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== VECTOR_SIZE) return null;
  let sum = 0;
  for (const x of input) {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    sum += x * x;
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) return null;
  return (input as number[]).map((x) => x / norm);
}
