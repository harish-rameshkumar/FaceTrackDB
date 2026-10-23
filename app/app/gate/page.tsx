import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth-stub";
import { getPool } from "@/lib/db";
import { GateScanner } from "./GateScanner";

export default function GatePage() {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Link href="/" className="text-sm underline">Home</Link>
      <h1 className="mt-2 text-2xl font-semibold">Gate and roll-call scanner</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">Security staff. Recognises a face and records the gate crossing or the roll-call mark.</p>
      <Suspense fallback={<p className="text-sm">Loading…</p>}>
        <GateContent />
      </Suspense>
    </main>
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
