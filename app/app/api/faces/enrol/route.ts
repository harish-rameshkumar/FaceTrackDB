import { authErrorResponse, requireRole } from "@/lib/auth";
import { enrolDescriptors, FaceError } from "@/lib/faces";

export async function POST(request: Request) {
  try {
    await requireRole(["admin"]);

    let body: { student_id?: unknown; descriptors?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const studentId = body.student_id;
    const descriptors = body.descriptors;
    if (typeof studentId !== "number" || !Number.isInteger(studentId) || studentId <= 0) {
      return Response.json({ error: "student_id must be a positive integer" }, { status: 400 });
    }
    if (!Array.isArray(descriptors) || descriptors.length < 3 || descriptors.length > 5) {
      return Response.json({ error: "Send 3 to 5 descriptors" }, { status: 400 });
    }

    const profiles = await enrolDescriptors(studentId, descriptors);
    return Response.json({ student_id: studentId, profiles }, { status: 201 });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    if (e instanceof FaceError) return Response.json({ error: e.message }, { status: e.status });
    console.error("enrol failed", e);
    return Response.json({ error: "Enrolment failed" }, { status: 500 });
  }
}
