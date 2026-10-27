// Browser-side frame capture. The browser does no face analysis at all: it only
// grabs JPEG frames from the camera and posts them to the Next.js API, which
// calls the embedding service on the server.

const CAPTURE_WIDTH = 640;
const JPEG_QUALITY = 0.85;

/** One JPEG frame of the video, scaled to about 640 px wide. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const vw = video.videoWidth || CAPTURE_WIDTH;
  const vh = video.videoHeight || Math.round(CAPTURE_WIDTH * 0.75);
  const scale = Math.min(1, CAPTURE_WIDTH / vw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas unavailable"));
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode frame"))), "image/jpeg", JPEG_QUALITY);
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
