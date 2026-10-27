import Link from "next/link";
import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { EnrolForm } from "@/app/enrol/EnrolForm";
import { parseId } from "@/lib/api-helpers";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const metadata = { title: "Enrol face | FaceTrackDB" };

export default function EnrolStudentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Face enrolment</h1>
        <Suspense fallback={<p className="mt-4 text-sm">Loading…</p>}>
          <Content params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["admin"]} />;
    throw e;
  }
  const id = parseId((await params).id);
  const { rows } = id
    ? await getPool().query(
        `SELECT s.student_id, s.roll_no, s.name, h.name AS hostel,
                (SELECT count(*)::int FROM face_profiles f WHERE f.student_id = s.student_id) AS profiles
         FROM students s JOIN hostels h ON h.hostel_id = s.hostel_id WHERE s.student_id = $1`,
        [id],
      )
    : { rows: [] };
  if (rows.length === 0) {
    return <p className="mt-4 text-sm">Student not found. <Link href="/admin/students" className="underline">Back to students</Link></p>;
  }
  const s = rows[0];
  return (
    <>
      <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {s.name} ({s.roll_no}) · {s.hostel} · {s.profiles} face sample{s.profiles === 1 ? "" : "s"} stored.
        {s.profiles > 0 && " Re-enrolling replaces the old samples once the new ones are saved."}
        {" "}<Link href="/admin/students" className="underline">Back to students</Link>
      </p>
      <EnrolForm students={[s]} fixedStudentId={s.student_id} replace={s.profiles > 0} />
    </>
  );
}
