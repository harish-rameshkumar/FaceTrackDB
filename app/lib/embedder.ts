
// Client for the embedding service in /embedder (InsightFace buffalo_l).
// The browser never talks to it: only the Next.js server does, with a shared secret.

export interface EmbeddedFace {
  embedding: number[]; // 512 numbers, L2-normalised
  detScore: number;
  width: number; // face box size in pixels of the submitted image
  height: number;
  blurScore: number; // variance of the Laplacian over the face crop; higher = sharper
}

export interface EmbedResult {
  count: number; // faces the detector found
  face: EmbeddedFace | null; // the largest one
}

export class EmbedderError extends Error {}

const TIMEOUT_MS = 15_000;

export async function embedImage(image: Uint8Array | Buffer): Promise<EmbedResult> {
  const url = process.env.EMBEDDER_URL;
  const token = process.env.EMBEDDER_TOKEN;
  if (!url || !token) throw new EmbedderError("EMBEDDER_URL / EMBEDDER_TOKEN are not set (see .env.example)");

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/embed`, {
      method: "POST",
      headers: { "x-embedder-token": token, "content-type": "application/octet-stream" },
      body: image as BodyInit,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new EmbedderError(`embedder unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 400) return { count: 0, face: null }; // not a decodable image: treated as "no face"
  if (!res.ok) throw new EmbedderError(`embedder returned HTTP ${res.status}`);

  const json = (await res.json()) as {
    count: number;
    face: null | { embedding: number[]; det_score: number; width: number; height: number; blur_score: number };
  };
  if (!json.face) return { count: json.count, face: null };
  return {
    count: json.count,
    face: {
      embedding: json.face.embedding,
      detScore: json.face.det_score,
      width: json.face.width,
      height: json.face.height,
      blurScore: json.face.blur_score,
    },
  };
}
