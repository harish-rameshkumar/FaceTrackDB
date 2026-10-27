import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { EnrolForm } from "./EnrolForm";

export default function EnrolPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Face enrolment</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">Admin only. Captures five guided frames, checks their quality and stores each face as a 512-number embedding. No photos are kept.</p>
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <EnrolContent />
        </Suspense>
      </main>
    </>
  );
}

async function EnrolContent() {
  try {
    await requireRole(["admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["admin"]} />;
    throw e;
  }
  const { rows } = await getPool().query(
    `SELECT s.student_id, s.roll_no, s.name, h.name AS hostel,
            (SELECT count(*)::int FROM face_profiles f WHERE f.student_id = s.student_id) AS profiles
     FROM students s JOIN hostels h ON h.hostel_id = s.hostel_id
     ORDER BY s.roll_no`,
  );
  return <EnrolForm students={rows} />;
}
