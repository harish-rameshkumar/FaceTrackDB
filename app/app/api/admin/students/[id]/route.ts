import { authErrorResponse, requireRole } from "@/lib/auth";
import { mapAdminError } from "@/lib/admin-errors";
import { parseId } from "@/lib/api-helpers";
import { getPool } from "@/lib/db";
import { COLLECTION, getQdrant } from "@/lib/qdrant";

// DELETE /api/admin/students/[id]: only when the student has no attendance, gate,
// violation, leave or scan history. Removes the face profiles and their Qdrant
// points, the student, the student's login, and parent logins with no other ward.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["admin"]);
    const id = parseId((await params).id);
    if (!id) return Response.json({ error: "Invalid student id" }, { status: 400 });

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query("SELECT 1 FROM students WHERE student_id = $1", [id]);
      if (exists.rowCount === 0) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Student not found" }, { status: 404 });
      }
      const blockers = (await client.query<{ b: string[] }>("SELECT student_delete_blockers($1) AS b", [id])).rows[0].b;
      if (blockers.length > 0) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: `This student cannot be deleted because they have ${blockers.join(", ")}. History is kept.`, code: "has_history", blockers },
          { status: 409 },
        );
      }
      const points = (await client.query<{ qdrant_point_id: string }>("SELECT qdrant_point_id FROM face_profiles WHERE student_id = $1", [id])).rows.map((r) => r.qdrant_point_id);
      const removedParents = (await client.query<{ n: number }>("SELECT delete_student($1) AS n", [id])).rows[0].n;
      // Deleting a missing point is a no-op, so a retry after a failed commit is safe.
      if (points.length > 0) await getQdrant().delete(COLLECTION, { wait: true, points });
      await client.query("COMMIT");
      return Response.json({ deleted: id, removed_parent_logins: removedParents });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      const mapped = mapAdminError(e);
      if (mapped) return Response.json({ error: mapped.message }, { status: mapped.status });
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("delete student failed", e);
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }
}
