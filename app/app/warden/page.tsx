import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";
import { AuthError, requireRole } from "@/lib/auth";
import {
  getAttendance, getHostels, getMonthlyAttendance, getOpenViolations, getPresence, parseFilters,
  LOW_ATTENDANCE_PCT, PRESENCE_VALUES, ROW_LIMIT, SORT_OPTIONS, VIOLATION_TYPES, type Limited,
} from "@/lib/dashboard";

export const metadata = { title: "Warden dashboard | FaceTrackDB" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WardenDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageShell width="wide">
      <PageHeader title="Warden dashboard" description="Who is in the hostel, attendance, and what needs attention. Times are IST." />
      <Suspense fallback={<Spinner label="Loading the dashboard" />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function DashboardContent({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requireRole(["warden", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["warden", "admin"]} />;
    throw e;
  }

  const hostels = await getHostels();
  const f = parseFilters(await searchParams, hostels);
  const [presence, attendance, violations, monthly] = await Promise.all([
    getPresence(f), getAttendance(f), getOpenViolations(f), getMonthlyAttendance(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <form method="get" aria-label="Filters" className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FormField label="Hostel (all tables)">
            {(c) => (
              <select {...c} name="hostel" defaultValue={f.hostelId ?? ""} className={inputClasses}>
                <option value="">All hostels</option>
                {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Presence">
            {(c) => (
              <select {...c} name="presence" defaultValue={f.presence ?? ""} className={inputClasses}>
                <option value="">Inside and outside</option>
                {PRESENCE_VALUES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Student name (presence)">
            {(c) => <input {...c} name="q" defaultValue={f.q} maxLength={50} placeholder="e.g. Arun" className={inputClasses} />}
          </FormField>
          <FormField label="Attendance order">
            {(c) => (
              <select {...c} name="sort" defaultValue={f.sort} className={inputClasses}>
                {Object.entries(SORT_OPTIONS).map(([key, o]) => <option key={key} value={key}>{o.label}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Violation type">
            {(c) => (
              <select {...c} name="vtype" defaultValue={f.vtype ?? ""} className={inputClasses}>
                <option value="">All types</option>
                {VIOLATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </FormField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary">Apply</Button>
          <Button href="/warden" variant="secondary">Reset</Button>
        </div>
      </form>

      <Card title="Who is where" description={<LimitNote data={presence} />}>
        <DataTable
          caption="Who is where"
          rows={presence.rows}
          rowKey={(r) => r.student_id}
          empty={<EmptyState title="No students match these filters" />}
          columns={[
            { key: "s", header: "Student", render: (r) => <>{r.name} <span className="text-muted">({r.roll_no})</span></> },
            { key: "h", header: "Hostel", render: (r) => r.hostel },
            { key: "r", header: "Room", render: (r) => r.room_no ?? "–" },
            { key: "p", header: "Presence", render: (r) => <StatusPill status={r.presence} /> },
            { key: "l", header: "Last gate event", render: (r) => r.last_seen ?? "no gate record" },
            { key: "v", header: "Leave today", render: (r) => (r.on_leave_today ? "yes" : "no") },
          ]}
        />
      </Card>

      <Card title="Roll-call attendance" description={<><LimitNote data={attendance} /> Rows under {LOW_ATTENDANCE_PCT}% are marked low.</>}>
        <DataTable
          caption="Roll-call attendance"
          rows={attendance.rows}
          rowKey={(r) => r.student_id}
          empty={<EmptyState title="No attendance recorded yet" />}
          columns={[
            { key: "s", header: "Student", render: (r) => <>{r.name} <span className="text-muted">({r.roll_no})</span></> },
            { key: "h", header: "Hostel", render: (r) => r.hostel },
            { key: "c", header: "Roll calls", render: (r) => r.sessions_recorded },
            { key: "p", header: "Present", render: (r) => r.present },
            { key: "lc", header: "Low confidence", render: (r) => r.low_confidence },
            { key: "a", header: "Absent", render: (r) => r.absent },
            {
              key: "pct", header: "Attendance %", render: (r) => {
                const pct = r.attendance_pct === null ? null : Number(r.attendance_pct);
                if (pct === null) return "–";
                return pct < LOW_ATTENDANCE_PCT ? <span className="font-semibold text-danger">{pct.toFixed(1)}% (low)</span> : `${pct.toFixed(1)}%`;
              },
            },
          ]}
        />
      </Card>

      <Card title="Open violations" description={<LimitNote data={violations} />}>
        <DataTable
          caption="Open violations"
          rows={violations.rows}
          rowKey={(r) => r.violation_id}
          empty={<EmptyState title="No open violations match these filters" />}
          columns={[
            { key: "t", header: "Type", render: (r) => <StatusPill status="open" label={String(r.type).replace(/_/g, " ")} /> },
            { key: "s", header: "Student", render: (r) => <>{r.student} <span className="text-muted">({r.roll_no})</span></> },
            { key: "h", header: "Hostel", render: (r) => r.hostel },
            { key: "r", header: "Raised", render: (r) => r.raised_at, className: "whitespace-nowrap" },
            { key: "d", header: "Details", render: (r) => r.details ?? "–" },
          ]}
        />
        <p className="mt-3 text-sm"><Link href="/violations" className="text-primary underline">Open the violations page to resolve them</Link></p>
      </Card>

      <Card title="Attendance per hostel per month" description="All hostels, all months (not affected by the filters).">
        <DataTable
          caption="Attendance per hostel per month"
          rows={monthly}
          rowKey={(r) => `${r.hostel}-${r.month}`}
          empty={<EmptyState title="No roll calls recorded yet" />}
          columns={[
            { key: "h", header: "Hostel", render: (r) => r.hostel },
            { key: "m", header: "Month", render: (r) => r.month },
            { key: "k", header: "Marks", render: (r) => r.marks },
            { key: "p", header: "Present", render: (r) => r.present },
            { key: "a", header: "Attendance %", render: (r) => `${r.attendance_pct}%` },
          ]}
        />
      </Card>
    </div>
  );
}

function LimitNote({ data }: { data: Limited<unknown> }) {
  return data.total > ROW_LIMIT
    ? <>Showing the first {ROW_LIMIT} of {data.total} rows; use the filters to narrow down.</>
    : <>Showing {data.rows.length} {data.rows.length === 1 ? "row" : "rows"} (limit {ROW_LIMIT}).</>;
}
