import { authErrorResponse, requireRole } from "@/lib/auth";
import { embedFrames, FramesError, readFrames } from "@/lib/frames";
import { processScan } from "@/lib/scan";

const SCAN_FRAMES = 3;
const MIN_USABLE_FRAMES = 2;

// multipart/form-data: camera_id, purpose, optional direction, and 3 JPEG parts
// named "frames" captured about 300 ms apart. The same student must win on at
// least 2 usable frames to be accepted (see lib/matching.ts).
export async function POST(request: Request) {
  try {
    await requireRole(["security", "admin"]);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Body must be multipart form data" }, { status: 400 });
    }
    const cameraId = Number(form.get("camera_id"));
    if (!Number.isInteger(cameraId) || cameraId <= 0) {
      return Response.json({ error: "camera_id must be a positive integer" }, { status: 400 });
    }
    const purpose = form.get("purpose");
    if (purpose !== "attendance" && purpose !== "entry_exit") {
      return Response.json({ error: "purpose must be 'attendance' or 'entry_exit'" }, { status: 400 });
    }
    const direction = form.get("direction");
    if (direction !== null && direction !== "IN" && direction !== "OUT") {
      return Response.json({ error: "direction must be 'IN' or 'OUT'" }, { status: 400 });
    }
    const files = await readFrames(form, SCAN_FRAMES, SCAN_FRAMES);

    const reports = await embedFrames(files);
    const usable = reports.filter((r) => r.ok);
    if (usable.length < MIN_USABLE_FRAMES) {
      // No usable face: nothing is logged. Tell the guard why, using the most common reason.
      const first = reports.find((r) => !r.ok);
      return Response.json({ error: first?.message ?? "No usable face in view", code: "quality", quality: first?.code }, { status: 422 });
    }

    const result = await processScan({
      embeddings: usable.map((r) => r.embedding!),
      cameraId,
      purpose,
      ...(direction ? { direction } : {}),
    });
    return Response.json(result.body, { status: result.status, headers: result.headers });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    if (e instanceof FramesError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("match failed", e);
    return Response.json({ error: "Matching failed" }, { status: 500 });
  }
}
