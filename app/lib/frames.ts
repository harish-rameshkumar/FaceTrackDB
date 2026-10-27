import "server-only";
import { embedImage, EmbedderError } from "./embedder";
import { checkQuality, QUALITY_MESSAGES, type QualityCode } from "./quality";

export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export class FramesError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

export interface FrameReport {
  index: number; // 0-based position in the upload
  ok: boolean;
  code?: QualityCode;
  message?: string;
  embedding?: number[];
}

/** Reads the uploaded JPEG/PNG parts named `frames` from a multipart request. */
export async function readFrames(form: FormData, min: number, max: number): Promise<File[]> {
  const files = form.getAll("frames").filter((f): f is File => typeof f !== "string");
  if (files.length < min || files.length > max) throw new FramesError(400, `Send ${min === max ? min : `${min} to ${max}`} images`);
  for (const f of files) {
    if (f.size === 0 || f.size > MAX_FRAME_BYTES) throw new FramesError(400, "Each image must be between 1 byte and 2 MB");
    if (f.type !== "image/jpeg" && f.type !== "image/png") throw new FramesError(400, "Images must be JPEG or PNG");
  }
  return files;
}

/** Embeds every frame and applies the quality gate. A failure of the embedder service becomes one fixed 503. */
export async function embedFrames(files: File[]): Promise<FrameReport[]> {
  const reports: FrameReport[] = [];
  for (let i = 0; i < files.length; i++) {
    let result;
    try {
      result = await embedImage(new Uint8Array(await files[i].arrayBuffer()));
    } catch (e) {
      if (e instanceof EmbedderError) {
        console.error("embedder failed", e.message);
        throw new FramesError(503, "The face recognition service is not available. Try again in a moment.", "embedder_unavailable");
      }
      throw e;
    }
    const code = checkQuality(result);
    if (code) {
      // server log only (never sent to the browser): helps calibrate the FACE_MIN_* limits on the real camera
      const f = result.face;
      console.info(`frame ${i} rejected: ${code}; faces=${result.count}${f ? ` score=${f.detScore.toFixed(2)} width=${f.width.toFixed(0)} blur=${f.blurScore.toFixed(0)}` : ""}`);
    }
    reports.push(code ? { index: i, ok: false, code, message: QUALITY_MESSAGES[code] } : { index: i, ok: true, embedding: result.face!.embedding });
  }
  return reports;
}
