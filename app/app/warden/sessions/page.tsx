import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { sessionsSql } from "@/lib/sessions";
import { SessionsManager } from "./SessionsManager";

export const metadata = { title: "Roll calls | FaceTrackDB" };

export default function SessionsPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl p-8">
        <h1 className="text-2xl font-semibold">Roll calls</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">Create a roll call for a hostel, and close it after it ends: everyone who did not scan is marked absent (a missed-attendance violation is raised unless they are on approved leave). Times are IST.</p>
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <Content />
        </Suspense>
      </main>
    </>
  );
}

async function Content() {
  try {
    await requireRole(["warden", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["warden", "admin"]} />;
    throw e;
  }
  const pool = getPool();
  const [hostels, sessions] = await Promise.all([pool.query("SELECT hostel_id, name FROM hostels ORDER BY name"), pool.query(sessionsSql)]);
  return <SessionsManager hostels={hostels.rows} sessions={sessions.rows} />;
}
