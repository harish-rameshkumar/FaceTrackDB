import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Home | FaceTrackDB" };

export default function SecurityHomePage() {
  return (
    <PageShell width="narrow">
      <PageHeader title="Home" description="Security staff scan faces at the gate and at roll call." />
      <RoleGate roles={["security"]}>
        <Card title="Gate and roll-call scanner" description="Recognises a student, records the entry or exit, or marks roll-call attendance.">
          <Button href="/gate" variant="primary">Open the gate scanner</Button>
        </Card>
      </RoleGate>
    </PageShell>
  );
}
