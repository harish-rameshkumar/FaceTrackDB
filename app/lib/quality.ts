import type { EmbedResult, EmbeddedFace } from "./embedder";

export interface QualityLimits {
  minDetScore: number;
  minFaceWidth: number;
  minBlur: number;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Defaults: see docs/vector-design.md section "Quality gate". The blur default was
// calibrated on degraded copies of the InsightFace sample photo (sharp crops scored
// 43-98, Gaussian blur sigma 1.2 scored 18), not on your webcam: check the "rejected"
// lines in the server log on the real camera and adjust FACE_MIN_BLUR.
export function getQualityLimits(): QualityLimits {
  return {
    minDetScore: numberFromEnv("FACE_MIN_DET_SCORE", 0.6),
    minFaceWidth: numberFromEnv("FACE_MIN_WIDTH", 80),
    minBlur: numberFromEnv("FACE_MIN_BLUR", 20),
  };
}

// Fixed, user-facing messages: nothing from the embedder or the model is shown to the browser.
export const QUALITY_MESSAGES = {
  no_face: "No face found. Face the camera in good light.",
  multiple_faces: "More than one face in view. Only one person at a time.",
  low_score: "The face is not clear enough. Look straight at the camera.",
  too_small: "Face too small. Move closer to the camera.",
  too_blurry: "The image is blurry. Hold still and try again.",
} as const;
export type QualityCode = keyof typeof QUALITY_MESSAGES;

/** Returns why an image cannot be used, or null if it passes. */
export function checkQuality(result: EmbedResult, limits: QualityLimits = getQualityLimits()): QualityCode | null {
  if (result.count === 0 || !result.face) return "no_face";
  if (result.count > 1) return "multiple_faces";
  const f: EmbeddedFace = result.face;
  if (f.detScore < limits.minDetScore) return "low_score";
  if (f.width < limits.minFaceWidth) return "too_small";
  if (f.blurScore < limits.minBlur) return "too_blurry";
  return null;
}
