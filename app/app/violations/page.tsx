import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import ViolationsList from "./ViolationsList";

export const metadata = { title: "Violations | FaceTrackDB" };

export default function ViolationsPage() {
  return (
    <PageShell width="narrow">
      <PageHeader title="Violations" description="Late returns, leaving without leave and missed roll calls." />
      <RoleGate roles={["student", "parent", "warden", "admin"]}>
        <ViolationsList />
      </RoleGate>
    </PageShell>
  );
}
