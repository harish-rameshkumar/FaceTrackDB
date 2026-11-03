import { authErrorResponse, requireRole } from "@/lib/auth";
import { parseId } from "@/lib/api-helpers";
import { listSamples } from "@/lib/faces";

// GET /api/admin/students/[id]/faces (admin only): the student's face samples with their active flag,
// for the "Face samples" panel on the students page. Each sample can then be read, deactivated,
// reactivated or deleted through /api/faces/[faceProfileId].
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["admin"]);
    const id = parseId((await params).id);
    if (id === null) return Response.json({ error: "Invalid student id" }, { status: 400 });
    return Response.json({ samples: await listSamples(id) });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("list face samples failed", e);
    return Response.json({ error: "Could not list the face samples" }, { status: 500 });
  }
}
