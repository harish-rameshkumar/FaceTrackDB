import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import ParentHome from "./ParentHome";

export const metadata = { title: "Home | FaceTrackDB" };

export default function ParentHomePage() {
  return (
    <PageShell>
      <PageHeader title="Home" description="How your children are doing, and what needs your decision." />
      <RoleGate roles={["parent"]}>
        <ParentHome />
      </RoleGate>
    </PageShell>
  );
}
