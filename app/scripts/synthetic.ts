// Deterministic synthetic 512-d unit vectors, so enrolment and matching can be
// tested without a camera or the embedder. NOT real faces: random directions in
// 512 dimensions are almost orthogonal (cosine about 0), which is far easier than
// real look-alike people. The tests therefore only prove the matching RULES work,
// not that the model separates real people (that is what `npm run faces:eval` measures).

/** mulberry32: small seeded PRNG returning floats in [0, 1) */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

export const DIM = 512;

/** A unit-length random direction. */
export function randomEmbedding(seed: number): number[] {
  const r = prng(seed);
  return normalise(Array.from({ length: DIM }, () => gaussian(r)));
}

/** The "true face" of a student: a fixed unit vector per student id. */
export function baseEmbedding(studentId: number): number[] {
  return randomEmbedding(1000 + studentId);
}

export function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

/**
 * A unit vector whose cosine similarity to `base` is exactly `similarity`
 * (a "new photo" of the same face): similarity * base + sqrt(1 - similarity^2) * d,
 * where d is a random direction made orthogonal to base.
 */
export function embeddingAtSimilarity(base: number[], similarity: number, seed: number): number[] {
  const d0 = randomEmbedding(seed);
  const p = dot(d0, base);
  const d = normalise(d0.map((x, i) => x - p * base[i]));
  const s = Math.sqrt(1 - similarity * similarity);
  return base.map((x, i) => similarity * x + s * d[i]);
}

/**
 * Safety: the synthetic scripts write fake enrolments into face_profiles and a
 * Qdrant collection, so they must never run against the real ones. Both the database
 * name and the collection name have to say "test" or "scratch".
 */
export function assertTestEnvironment(collection: string, options: { requireTestCollection?: boolean } = {}): void {
  const dbName = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
    } catch {
      return "";
    }
  })();
  const problems: string[] = [];
  if (!/(test|scratch)/i.test(dbName)) problems.push(`database "${dbName}" is not a scratch/test database (its name must contain "test" or "scratch")`);
  if ((options.requireTestCollection ?? true) && !collection.endsWith("_test")) problems.push(`collection "${collection}" must end in _test (set QDRANT_COLLECTION)`);
  if (problems.length) {
    console.error("Refusing to run synthetic data against real data:\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
}
