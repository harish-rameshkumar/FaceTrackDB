import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import StudentLeave from "./StudentLeave";

export const metadata = { title: "My leave | FaceTrackDB" };

export default function StudentLeavePage() {
  return (
    <PageShell width="narrow">
      <PageHeader title="My leave" description="Ask for leave and follow the decision." />
      <RoleGate roles={["student"]}>
        <StudentLeave />
      </RoleGate>
    </PageShell>
  );
}
