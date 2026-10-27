import { Suspense } from "react";
import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { PageHeader } from "@/components/ui/PageHeader";
import ParentHistory from "./ParentHistory";

export const metadata = { title: "Child's history | FaceTrackDB" };

export default function ParentHistoryPage() {
  return (
    <PageShell>
      <PageHeader title="Child's history" description="Roll-call results and gate entries and exits of your ward." />
      <RoleGate roles={["parent"]}>
        <Suspense fallback={null}>
          <ParentHistory />
        </Suspense>
      </RoleGate>
    </PageShell>
  );
}
