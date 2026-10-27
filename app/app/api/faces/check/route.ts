import { authErrorResponse, requireRole } from "@/lib/auth";
import { embedFrames, FramesError, readFrames } from "@/lib/frames";

// POST /api/faces/check  (multipart: ONE JPEG part named "frames")
// Used only for the live feedback on the camera pages ("move closer", "hold still"...). It runs
// the same quality gate as enrolment and scanning on one frame and answers with the result.
// It does NOT search Qdrant, does not touch PostgreSQL, logs no face event and changes no matching
// rule. Staff who use the camera pages only (admin, security).
export async function POST(request: Request) {
  try {
    await requireRole(["security", "admin"]);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Body must be multipart form data" }, { status: 400 });
    }
    const [file] = await readFrames(form, 1, 1);
    const [report] = await embedFrames([file], { quiet: true });
    return Response.json(report.ok ? { ok: true } : { ok: false, code: report.code, message: report.message });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    if (e instanceof FramesError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("check failed", e);
    return Response.json({ error: "Check failed" }, { status: 500 });
  }
}
