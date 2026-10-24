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
// Unit length only so synthetic "faces" are about 1.4 apart (real different people
// are roughly 0.8-1.2 apart); the app itself never normalises descriptors.
export function baseDescriptor(studentId: number): number[] {
  const r = prng(1000 + studentId);
  return normalise(Array.from({ length: 128 }, () => gaussian(r)));
}

/** A unit-length random direction. */
function randomDirection(seed: number): number[] {
  const r = prng(seed);
  return normalise(Array.from({ length: 128 }, () => gaussian(r)));
}

/** base moved by exactly `distance` (Euclidean) in a seeded random direction. */
export function descriptorAtDistance(base: number[], distance: number, seed: number): number[] {
  const dir = randomDirection(seed);
  return base.map((x, i) => x + distance * dir[i]);
}

/** Same thing under the name the seed script uses: a "photo" of the same face. */
export const noisyDescriptor = descriptorAtDistance;

/** A descriptor unrelated to every student (about 1.4 from any other unit-length base). */
export function randomDescriptor(seed: number): number[] {
  return randomDirection(seed);
}

export function euclidean(a: number[], b: number[]): number {
  return Math.hypot(...a.map((x, i) => x - b[i]));
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
