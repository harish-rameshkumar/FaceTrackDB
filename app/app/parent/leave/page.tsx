import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import ParentLeave from "./ParentLeave";

export const metadata = { title: "Leave requests | FaceTrackDB" };

export default function ParentLeavePage() {
  return (
    <PageShell width="narrow">
      <PageHeader title="Leave requests" description="Approve or reject your ward's requests. A decision cannot be changed afterwards." />
      <RoleGate roles={["parent"]}>
        <ParentLeave />
      </RoleGate>
    </PageShell>
  );
}
