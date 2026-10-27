// Measures how well the embedder separates people, on YOUR photos.
//   npm run faces:eval -- <folder>
// <folder> holds one subfolder per person, each with several photos of that person
// (jpg/jpeg/png). Needs the embedder running (docker compose up -d embedder).
// Prints: photos rejected by the quality gate, same-person and different-person cosine
// similarity min/mean/max, the best separating threshold, and a leave-one-out
// identification summary at the thresholds from the environment (MATCH_MIN_SIMILARITY,
// REVIEW_MIN_SIMILARITY, MIN_MARGIN). Nothing is written to PostgreSQL or Qdrant.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { embedImage } from "../lib/embedder";
import { classifyFrame, getThresholds, rankStudents } from "../lib/matching";
import { checkQuality, getQualityLimits } from "../lib/quality";

interface Photo { person: number; name: string; file: string; embedding: number[] }

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const stats = (xs: number[]) => (xs.length ? { n: xs.length, min: Math.min(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs) } : null);
const fmt = (s: ReturnType<typeof stats>) => (s ? `n=${s.n}  min ${s.min.toFixed(3)}  mean ${s.mean.toFixed(3)}  max ${s.max.toFixed(3)}` : "no pairs");

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Usage: npm run faces:eval -- <folder with one subfolder per person>");
    process.exit(1);
  }
  const root = resolve(folder);
  const people = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort();
  const limits = getQualityLimits();
  const thresholds = getThresholds();

  const photos: Photo[] = [];
  const rejected: string[] = [];
  for (let p = 0; p < people.length; p++) {
    const files = readdirSync(join(root, people[p])).filter((f) => [".jpg", ".jpeg", ".png"].includes(extname(f).toLowerCase())).sort();
    for (const f of files) {
      const res = await embedImage(readFileSync(join(root, people[p], f)));
      const why = checkQuality(res, limits);
      if (why) rejected.push(`${people[p]}/${f}: ${why}${res.face ? ` (score ${res.face.detScore.toFixed(2)}, width ${res.face.width.toFixed(0)}, blur ${res.face.blurScore.toFixed(0)})` : ""}`);
      else photos.push({ person: p, name: people[p], file: f, embedding: res.face!.embedding });
    }
  }

  const usablePeople = new Set(photos.map((x) => x.person)).size;
  console.log(`People: ${people.length}, usable photos: ${photos.length}, rejected by the quality gate: ${rejected.length}`);
  rejected.forEach((r) => console.log(`  rejected  ${r}`));
  if (usablePeople < 2) {
    console.error("Need usable photos of at least 2 people.");
    process.exit(1);
  }
  const perPerson = people.map((_, p) => photos.filter((x) => x.person === p).length);
  if (usablePeople < 4 || Math.min(...perPerson.filter((n) => n > 0)) < 5) {
    console.log("NOTE: fewer than 4 people or fewer than 5 usable photos per person; the numbers below are weak evidence.");
  }

  const same: number[] = [], diff: number[] = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      (photos[i].person === photos[j].person ? same : diff).push(dot(photos[i].embedding, photos[j].embedding));
    }
  }
  console.log("\nCosine similarity");
  console.log(`  same person       ${fmt(stats(same))}`);
  console.log(`  different people  ${fmt(stats(diff))}`);

  // best separating threshold: the one with the fewest wrong pair decisions (accept if similarity >= t)
  let best = { t: 0, errors: Infinity, far: 0, frr: 0 };
  for (const t of [...new Set([...same, ...diff])].sort((a, b) => a - b)) {
    const frr = same.filter((s) => s < t).length;
    const far = diff.filter((s) => s >= t).length;
    if (frr + far < best.errors) best = { t, errors: frr + far, far: far / diff.length, frr: frr / same.length };
  }
  console.log(`\nBest separating threshold: ${best.t.toFixed(3)}  (false accept rate ${(best.far * 100).toFixed(2)}%, false reject rate ${(best.frr * 100).toFixed(2)}%)`);
  if (Math.min(...same) <= Math.max(...diff)) console.log("  The distributions OVERLAP: no threshold separates every pair.");
  console.log(`  Suggestion: REVIEW_MIN_SIMILARITY a little above the highest different-person value (${Math.max(...diff).toFixed(3)}), MATCH_MIN_SIMILARITY above it with margin.`);

  // leave-one-out identification at the configured thresholds, as the gate would decide it
  const counts = { correct: 0, wrong: 0, reviewRight: 0, reviewWrong: 0, noMatch: 0 };
  for (let i = 0; i < photos.length; i++) {
    const hits = photos
      .map((g, j) => ({ g, j }))
      .filter(({ j }) => j !== i)
      .map(({ g, j }) => ({ studentId: g.person, similarity: dot(photos[i].embedding, photos[j].embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
    const v = classifyFrame(rankStudents(hits), thresholds);
    const right = v.top?.studentId === photos[i].person;
    if (v.outcome === "matched") counts[right ? "correct" : "wrong"]++;
    else if (v.outcome === "low_confidence") counts[right ? "reviewRight" : "reviewWrong"]++;
    else counts.noMatch++;
  }
  const n = photos.length;
  const pct = (x: number) => `${x} (${((x / n) * 100).toFixed(1)}%)`;
  console.log(`\nLeave-one-out identification of each photo against all the others (single frame), thresholds match>=${thresholds.matchMin}, review>=${thresholds.reviewMin}, margin>=${thresholds.minMargin}:`);
  console.log(`  matched, right student        ${pct(counts.correct)}`);
  console.log(`  matched, WRONG student        ${pct(counts.wrong)}   <- the dangerous one; keep this at 0`);
  console.log(`  warden review, right student  ${pct(counts.reviewRight)}`);
  console.log(`  warden review, wrong student  ${pct(counts.reviewWrong)}`);
  console.log(`  no match                      ${pct(counts.noMatch)}`);
}

main().catch((e) => {
  console.error("faces:eval failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
