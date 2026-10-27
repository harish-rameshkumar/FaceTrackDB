"use client";

import StateMessage from "@/components/StateMessage";
import { useFetch } from "@/components/useApi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";
import type { History } from "@/app/student/history/StudentHistory";
import ParentLeave from "./leave/ParentLeave";

export type Ward = { studentId: number; name: string; rollNo: string; hostel: string; relation: string | null };
type Violation = { id: number; studentId: number };

/** The parent's home: each ward's status and open violations, and the leave requests waiting for a decision. Uses existing APIs plus the read-only /api/wards. */
export default function ParentHome() {
  const wards = useFetch<{ wards: Ward[] }>("/api/wards");
  const violations = useFetch<{ violations: Violation[] }>("/api/violations?status=open");

  if (wards.loading && !wards.data) return <Spinner label="Loading your wards" />;
  if (wards.error || !wards.data) return <StateMessage status={wards.status} error={wards.error} />;
  if (wards.data.wards.length === 0) return <EmptyState title="No students are linked to your account">Ask the hostel office to link your account to your ward.</EmptyState>;

  const open = violations.data?.violations ?? [];
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Your wards" className="grid gap-4 md:grid-cols-2">
        {wards.data.wards.map((w) => (
          <WardCard key={w.studentId} ward={w} openViolations={open.filter((v) => v.studentId === w.studentId).length} />
        ))}
      </section>
      <section aria-labelledby="pending-title">
        <h2 id="pending-title" className="mb-3 text-lg font-semibold">Leave requests waiting for you</h2>
        <ParentLeave onlyPending />
      </section>
    </div>
  );
}

function WardCard({ ward, openViolations }: { ward: Ward; openViolations: number }) {
  const h = useFetch<History>(`/api/history?studentId=${ward.studentId}`);
  const last = h.data?.gate[0];
  return (
    <Card title={ward.name} description={`${ward.rollNo} · ${ward.hostel}${ward.relation ? ` · you are the ${ward.relation}` : ""}`}>
      {h.loading && !h.data ? (
        <Spinner label="Loading status" />
      ) : h.data ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Right now</dt>
            <dd className="mt-1">{h.data.currentStatus ? <StatusPill status={h.data.currentStatus} /> : <span className="text-muted">no gate events yet</span>}</dd>
            {last && <dd className="mt-1 text-xs text-muted">since {last.time.slice(0, 16)}</dd>}
          </div>
          <div>
            <dt className="text-muted">Roll-call attendance</dt>
            <dd className="mt-1 text-lg font-semibold">{h.data.summary.attendedPercent === null ? "–" : `${h.data.summary.attendedPercent}%`}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted">Open violations</dt>
            <dd className="mt-1"><StatusPill status={openViolations ? "open" : "resolved"} label={openViolations ? `${openViolations} open` : "None open"} /></dd>
          </div>
        </dl>
      ) : (
        <StateMessage status={h.status} error={h.error} />
      )}
      <Button href={`/parent/history?student=${ward.studentId}`} variant="link" className="mt-3">Full history</Button>
    </Card>
  );
}
