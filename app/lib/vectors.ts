import { VECTOR_SIZE } from "./qdrant";

/**
 * Validates a face descriptor (128 finite numbers) and returns a copy.
 * Descriptors are stored and searched exactly as the model produced them:
 * the model is trained for Euclidean distance, so they are NOT normalised.
 */
export function toDescriptor(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== VECTOR_SIZE) return null;
  for (const x of input) {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
  }
  return [...(input as number[])];
}
