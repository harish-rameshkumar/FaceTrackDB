import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { EnrolForm } from "./EnrolForm";

export const metadata = { title: "Enrol faces | FaceTrackDB" };

export default function EnrolPage() {
  return (
    <PageShell>
      <PageHeader title="Face enrolment" description="Admin only. Captures five guided frames, checks their quality and stores each face as a 512-number embedding. No photos are kept." />
      <Suspense fallback={<Spinner label="Loading" />}>
        <EnrolContent />
      </Suspense>
    </PageShell>
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
