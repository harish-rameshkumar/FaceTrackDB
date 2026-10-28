import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Register student | FaceTrackDB" };

export default function NewStudentPage() {
  return (
    <PageShell width="narrow">
      <PageHeader title="Register a student" description="Creates the student, their login and their parents' logins, then continues to face enrolment." />
      <Suspense fallback={<Spinner label="Loading" />}>
        <Content />
      </Suspense>
    </PageShell>
  );
}

async function Content() {
  try {
    await requireRole(["admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["admin"]} />;
    throw e;
  }
  const { rows } = await getPool().query("SELECT hostel_id, name FROM hostels ORDER BY name");
  return <RegisterForm hostels={rows} />;
}
