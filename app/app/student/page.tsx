import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import StudentHome from "./StudentHome";

export const metadata = { title: "Home | FaceTrackDB" };

export default function StudentHomePage() {
  return (
    <PageShell>
      <PageHeader title="Home" description="Your status today, at a glance." />
      <RoleGate roles={["student"]}>
        <StudentHome />
      </RoleGate>
    </PageShell>
  );
}
