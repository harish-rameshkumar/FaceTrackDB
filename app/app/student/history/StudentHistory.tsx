"use client";

import StateMessage from "@/components/StateMessage";
import { useFetch } from "@/components/useApi";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";

export type History = {
  summary: { present: number; lowConfidence: number; absent: number; total: number; attendedPercent: number | null };
  currentStatus: "inside" | "outside" | null;
  attendance: { date: string; startTime: string; endTime: string; status: "present" | "absent" | "low_confidence"; markedAt: string | null }[];
  gate: { id: number; direction: "IN" | "OUT"; time: string; gateName: string }[];
};

/** Attendance and gate history. A student sees their own; a parent passes the ward's studentId. */
export default function StudentHistory({ studentId, who = "you" }: { studentId?: number; who?: string }) {
  const { data, error, status, loading } = useFetch<History>(studentId ? `/api/history?studentId=${studentId}` : "/api/history");

  if (loading) return <Spinner label="Loading history" />;
  if (error || !data) return <StateMessage status={status} error={error} />;
  const { summary, currentStatus, attendance, gate } = data;
  const are = who === "you" ? "you are" : `${who} is`;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Attended" value={summary.attendedPercent === null ? "–" : `${summary.attendedPercent}%`} />
        <Stat label="Present" value={String(summary.present)} />
        <Stat label="Present (low confidence)" value={String(summary.lowConfidence)} />
        <Stat label="Absent" value={String(summary.absent)} />
      </section>

      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span>Right now {are}</span>
        {currentStatus ? <StatusPill status={currentStatus} /> : <span className="text-muted">not recorded yet (no gate events)</span>}
        {currentStatus && <span className="text-muted">(from the last gate event)</span>}
      </p>

      <Card title="Roll-call attendance">
        <DataTable
          caption="Roll-call attendance"
          rows={attendance}
          rowKey={(a) => `${a.date}-${a.startTime}`}
          empty={<EmptyState title="No attendance records yet" />}
          columns={[
            { key: "d", header: "Date", render: (a) => a.date, className: "whitespace-nowrap" },
            { key: "w", header: "Roll call", render: (a) => `${a.startTime.slice(0, 5)} to ${a.endTime.slice(0, 5)}`, className: "whitespace-nowrap" },
            { key: "r", header: "Result", render: (a) => <StatusPill status={a.status === "low_confidence" ? "present_low" : a.status} /> },
            { key: "m", header: "Marked at", render: (a) => (a.markedAt ? a.markedAt.slice(11, 16) : "–"), className: "whitespace-nowrap" },
          ]}
        />
      </Card>

      <Card title="Gate entries and exits">
        <DataTable
          caption="Gate entries and exits"
          rows={gate}
          rowKey={(g) => g.id}
          empty={<EmptyState title="No gate events yet" />}
          columns={[
            { key: "t", header: "When", render: (g) => g.time.slice(0, 16), className: "whitespace-nowrap" },
            { key: "d", header: "Direction", render: (g) => (g.direction === "IN" ? "Came in" : "Went out") },
            { key: "g", header: "Gate", render: (g) => g.gateName },
          ]}
        />
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
