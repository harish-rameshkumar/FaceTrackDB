// Deterministic synthetic face descriptors, so enrolment and matching can be
// demonstrated and tested without a camera. NOT real faces.

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

/** The "true face" of a student: a fixed unit-length direction per student id. */
export function baseDescriptor(studentId: number): number[] {
  const r = prng(1000 + studentId);
  return normalise(Array.from({ length: 128 }, () => gaussian(r)));
}

/** base + gaussian noise; cosine with base is about 1 / sqrt(1 + noise²). */
export function noisyDescriptor(base: number[], noise: number, seed: number): number[] {
  const r = prng(seed);
  return normalise(base.map((x) => x + (noise * gaussian(r)) / Math.sqrt(128)));
}

/** A vector unrelated to every student. */
export function randomDescriptor(seed: number): number[] {
  const r = prng(seed);
  return normalise(Array.from({ length: 128 }, () => gaussian(r)));
}

export function cosine(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

/**
 * Mixes a base direction with an orthogonal one so the cosine with the base
 * is (almost exactly) `target`. Used to land a probe inside a score band.
 */
export function descriptorWithCosine(base: number[], target: number, seed: number): number[] {
  const other = randomDescriptor(seed);
  const dot = other.reduce((s, x, i) => s + x * base[i], 0);
  const ortho = normalise(other.map((x, i) => x - dot * base[i]));
  const t = Math.sqrt(1 - target * target);
  return normalise(base.map((x, i) => target * x + t * ortho[i]));
}
