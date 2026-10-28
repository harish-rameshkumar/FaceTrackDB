"use client";

import StateMessage from "@/components/StateMessage";
import { useFetch } from "@/components/useApi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";
import type { History } from "./history/StudentHistory";

type Leave = { id: number; startDate: string; endDate: string; reason: string | null; status: "pending" | "approved" | "rejected" };
type Violation = { id: number; type: string; raisedAt: string; details: string | null };
const TYPE_LABEL: Record<string, string> = { late_return: "Late return", missed_attendance: "Missed attendance", no_leave: "Left without leave" };
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** The student's home: where they are, today's roll call, open violations and the latest leave request. Uses only existing APIs. */
export default function StudentHome() {
  const history = useFetch<History>("/api/history");
  const violations = useFetch<{ violations: Violation[] }>("/api/violations?status=open");
  const leave = useFetch<{ requests: Leave[] }>("/api/leave");

  if (history.loading && !history.data) return <Spinner label="Loading your status" />;
  if (history.error || !history.data) return <StateMessage status={history.status} error={history.error} />;

  const { currentStatus, attendance, gate, summary } = history.data;
  const today = attendance.find((a) => a.date === todayIst());
  const open = violations.data?.violations ?? [];
  const latestLeave = [...(leave.data?.requests ?? [])].sort((a, b) => b.id - a.id)[0];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Where you are">
        {currentStatus ? (
          <p className="flex flex-wrap items-center gap-2"><StatusPill status={currentStatus} /> <span className="text-sm text-muted">since {gate[0]?.time.slice(0, 16)} ({gate[0]?.gateName})</span></p>
        ) : (
          <p className="text-sm text-muted">No gate events recorded yet.</p>
        )}
        <p className="mt-3 text-sm text-muted">Roll-call attendance so far: <strong className="text-fg">{summary.attendedPercent === null ? "–" : `${summary.attendedPercent}%`}</strong></p>
        <Button href="/student/history" variant="link" className="mt-3">See full history</Button>
      </Card>

      <Card title="Today's roll call">
        {today ? (
          <p className="flex flex-wrap items-center gap-2"><StatusPill status={today.status === "low_confidence" ? "present_low" : today.status} /> <span className="text-sm text-muted">{today.startTime.slice(0, 5)} to {today.endTime.slice(0, 5)}</span></p>
        ) : (
          <p className="text-sm text-muted">No roll-call result for today yet.</p>
        )}
      </Card>

      <Card title="Open violations" actions={<StatusPill status={open.length ? "open" : "resolved"} label={open.length ? `${open.length} open` : "None open"} />}>
        {open.length === 0 ? (
          <p className="text-sm text-muted">You have no open violations.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {open.slice(0, 3).map((v) => (
              <li key={v.id}><span className="font-medium">{TYPE_LABEL[v.type] ?? v.type}</span> <span className="text-muted">· {v.raisedAt.slice(0, 16)}</span></li>
            ))}
          </ul>
        )}
        <Button href="/violations" variant="link" className="mt-3">All violations</Button>
      </Card>

      <Card title="Latest leave request">
        {latestLeave ? (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm">
              <p>{latestLeave.startDate} to {latestLeave.endDate}</p>
              <p className="text-muted">{latestLeave.reason}</p>
            </div>
            <StatusPill status={latestLeave.status} />
          </div>
        ) : (
          <p className="text-sm text-muted">You have not requested leave yet.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button href="/student/leave" variant="primary" size="sm">{latestLeave ? "Manage leave" : "Request leave"}</Button>
        </div>
      </Card>
    </div>
  );
}
