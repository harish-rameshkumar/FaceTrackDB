import { VECTOR_SIZE } from "./qdrant";

/** Returns an L2-normalised copy, or null if the input is not a valid 128-d finite vector. */
export function toUnitVector(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== VECTOR_SIZE) return null;
  let sumSquares = 0;
  for (const x of input) {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    sumSquares += x * x;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return null;
  return input.map((x: number) => x / norm);
}
