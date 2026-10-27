import { authErrorResponse, requireRole } from "@/lib/auth";
import { enrolEmbeddings, FaceError } from "@/lib/faces";
import { embedFrames, FramesError, readFrames } from "@/lib/frames";

const ENROL_FRAMES = 5;

// multipart/form-data: student_id and 5 JPEG parts named "frames", in capture order.
// Every frame must pass the quality gate; otherwise nothing is stored and the
// response says which frames failed and why (fixed messages).
export async function POST(request: Request) {
  try {
    await requireRole(["admin"]);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Body must be multipart form data" }, { status: 400 });
    }
    const studentId = Number(form.get("student_id"));
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return Response.json({ error: "student_id must be a positive integer" }, { status: 400 });
    }
    const files = await readFrames(form, ENROL_FRAMES, ENROL_FRAMES);

    const reports = await embedFrames(files);
    const failed = reports.filter((r) => !r.ok);
    if (failed.length > 0) {
      return Response.json(
        {
          error: "Some frames were not usable. Nothing was saved.",
          code: "quality",
          frames: reports.map(({ index, ok, code, message }) => ({ index, ok, code, message })),
        },
        { status: 422 },
      );
    }

    const profiles = await enrolEmbeddings(studentId, reports.map((r) => r.embedding!));
    return Response.json({ student_id: studentId, profiles }, { status: 201 });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    if (e instanceof FramesError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    if (e instanceof FaceError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("enrol failed", e);
    return Response.json({ error: "Enrolment failed" }, { status: 500 });
  }
}
