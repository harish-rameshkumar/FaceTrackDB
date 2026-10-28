import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { GateScanner } from "./GateScanner";

export const metadata = { title: "Gate | FaceTrackDB" };

export default function GatePage() {
  return (
    <PageShell width="wide">
      <PageHeader title="Gate and roll-call scanner" description="Security staff. Recognises a face and records the gate crossing or the roll-call mark." />
      <Suspense fallback={<Spinner label="Loading" />}>
        <GateContent />
      </Suspense>
    </PageShell>
  );
}

async function GateContent() {
  try {
    await requireRole(["security", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["security", "admin"]} />;
    throw e;
  }
  const { rows } = await getPool().query(
    `SELECT c.camera_id, c.location, g.name AS gate, h.name AS hostel
     FROM cameras c JOIN gates g ON g.gate_id = c.gate_id JOIN hostels h ON h.hostel_id = g.hostel_id
     WHERE c.status = 'active'
     ORDER BY h.name, g.name, c.camera_id`,
  );
  return <GateScanner cameras={rows} />;
}
