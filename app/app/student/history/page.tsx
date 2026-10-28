import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import StudentHistory from "./StudentHistory";

export const metadata = { title: "My history | FaceTrackDB" };

export default function StudentHistoryPage() {
  return (
    <PageShell>
      <PageHeader title="My attendance and gate history" description="Your roll-call results and every gate entry and exit." />
      <RoleGate roles={["student"]}>
        <StudentHistory />
      </RoleGate>
    </PageShell>
  );
}
