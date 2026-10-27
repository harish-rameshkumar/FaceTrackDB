import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { EnrolForm } from "@/app/enrol/EnrolForm";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { parseId } from "@/lib/api-helpers";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const metadata = { title: "Enrol face | FaceTrackDB" };

export default function EnrolStudentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageShell>
      <Suspense fallback={<Spinner label="Loading" />}>
        <Content params={params} />
      </Suspense>
    </PageShell>
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
    return (
      <>
        <PageHeader title="Face enrolment" />
        <Notice tone="warning" title="Student not found"><Button href="/admin/students" variant="link">Back to students</Button></Notice>
      </>
    );
  }
  const s = rows[0];
  return (
    <>
      <PageHeader
        title="Face enrolment"
        description={`${s.name} (${s.roll_no}) · ${s.hostel} · ${s.profiles} face sample${s.profiles === 1 ? "" : "s"} stored.${s.profiles > 0 ? " Re-enrolling replaces the old samples once the new ones are saved." : ""}`}
        actions={<Button href="/admin/students" variant="secondary">Back to students</Button>}
      />
      <EnrolForm students={[s]} fixedStudentId={s.student_id} replace={s.profiles > 0} />
    </>
  );
}
