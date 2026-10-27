import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Register student | FaceTrackDB" };

export default function NewStudentPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Register a student</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">Admin only. Creates the student, their login and their parents&apos; logins, then continues to face enrolment.</p>
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <Content />
        </Suspense>
      </main>
    </>
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
