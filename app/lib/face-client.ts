// Browser-only helpers around @vladmandic/face-api (import this from client components).
// Model weights are served from /models (copied from the npm package).
type FaceApi = typeof import("@vladmandic/face-api");

let loading: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  loading ??= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
    return faceapi;
  })();
  loading.catch(() => {
    loading = null; // allow a retry after a failed load
  });
  return loading;
}

/** Returns the 128-d descriptor of the single most prominent face, or null if none is visible. */
export async function describeFace(faceapi: FaceApi, video: HTMLVideoElement): Promise<number[] | null> {
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result ? Array.from(result.descriptor) : null;
}
