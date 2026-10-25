import { authErrorResponse, requireRole } from "@/lib/auth";
import { deleteProfile } from "@/lib/faces";

export async function DELETE(_request: Request, { params }: { params: Promise<{ faceProfileId: string }> }) {
  try {
    await requireRole(["admin"]);
    const id = Number((await params).faceProfileId);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "Invalid face profile id" }, { status: 400 });
    }
    const removed = await deleteProfile(id);
    if (!removed) return Response.json({ error: "Face profile not found" }, { status: 404 });
    return Response.json({ deleted: id });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("delete face profile failed", e);
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }
}
