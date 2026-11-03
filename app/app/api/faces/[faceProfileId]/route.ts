import { authErrorResponse, requireRole } from "@/lib/auth";
import { deleteProfile, getSample, setSampleActive } from "@/lib/faces";

// Admin-only operations on ONE face sample (a face_profiles row and its Qdrant point):
//   GET    read the sample: its row and its Qdrant payload, looked up by point id (no vector is returned)
//   PATCH  update the payload: {"active": false} deactivates the sample (matching ignores it), {"active": true} reactivates it
//   DELETE remove the row and the point together
async function idOf(params: Promise<{ faceProfileId: string }>): Promise<number | null> {
  const id = Number((await params).faceProfileId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ faceProfileId: string }> }) {
  try {
    await requireRole(["admin"]);
    const id = await idOf(params);
    if (id === null) return Response.json({ error: "Invalid face profile id" }, { status: 400 });
    const sample = await getSample(id);
    if (!sample) return Response.json({ error: "Face profile not found" }, { status: 404 });
    return Response.json({ sample });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("read face profile failed", e);
    return Response.json({ error: "Could not read the face sample" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ faceProfileId: string }> }) {
  try {
    await requireRole(["admin"]);
    const id = await idOf(params);
    if (id === null) return Response.json({ error: "Invalid face profile id" }, { status: 400 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Send JSON like {"active": false}' }, { status: 400 });
    }
    const active = (body as { active?: unknown } | null)?.active;
    if (typeof active !== "boolean") return Response.json({ error: '"active" must be true or false' }, { status: 400 });
    const sample = await setSampleActive(id, active);
    if (!sample) return Response.json({ error: "Face profile not found" }, { status: 404 });
    return Response.json({ sample });
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("update face profile failed", e);
    return Response.json({ error: "Could not update the face sample" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ faceProfileId: string }> }) {
  try {
    await requireRole(["admin"]);
    const id = await idOf(params);
    if (id === null) return Response.json({ error: "Invalid face profile id" }, { status: 400 });
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
