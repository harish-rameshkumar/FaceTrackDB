import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { sessionsSql } from "@/lib/sessions";
import { SessionsManager } from "./SessionsManager";

export const metadata = { title: "Roll calls | FaceTrackDB" };

export default function SessionsPage() {
  return (
    <PageShell width="wide">
      <PageHeader
        title="Roll calls"
        description="Create a roll call for a hostel, and close it after it ends: everyone who did not scan is marked absent (a missed-attendance violation is raised unless they are on approved leave). Times are IST."
      />
      <Suspense fallback={<Spinner label="Loading roll calls" />}>
        <Content />
      </Suspense>
    </PageShell>
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
