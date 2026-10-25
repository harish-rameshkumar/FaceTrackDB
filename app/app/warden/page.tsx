import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import AppHeader from "@/components/AppHeader";
import { AuthError, requireRole } from "@/lib/auth";
import {
  getAttendance, getHostels, getMonthlyAttendance, getOpenViolations, getPresence, getSummary, parseFilters,
  LOW_ATTENDANCE_PCT, PRESENCE_VALUES, ROW_LIMIT, SORT_OPTIONS, VIOLATION_TYPES, type Limited,
} from "@/lib/dashboard";

export const metadata = { title: "Warden dashboard | FaceTrackDB" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WardenDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl p-6">
        <h1 className="text-2xl font-semibold">Warden dashboard</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">Who is in the hostel, attendance, and what needs attention. Times are IST.</p>
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <DashboardContent searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";
const th = "py-2 pr-4 font-medium";
const td = "py-2 pr-4 align-top";

async function DashboardContent({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requireRole(["warden", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["warden", "admin"]} />;
    throw e;
  }

  const hostels = await getHostels();
  const f = parseFilters(await searchParams, hostels);
  const [summary, presence, attendance, violations, monthly] = await Promise.all([
    getSummary(), getPresence(f), getAttendance(f), getOpenViolations(f), getMonthlyAttendance(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Students inside" value={summary.inside} />
        <Card label="Students outside" value={summary.outside} />
        <Card label="On approved leave today" value={summary.onLeave} />
        <Card label="Open violations" value={summary.openViolations} tone={summary.openViolations > 0 ? "warn" : undefined} />
        <Card label="Scans waiting for review" value={summary.reviewWaiting} href="/warden/review" tone={summary.reviewWaiting > 0 ? "warn" : undefined} />
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
        <label className="flex flex-col gap-1 text-sm">Hostel (all tables)
          <select name="hostel" defaultValue={f.hostelId ?? ""} className={field}>
            <option value="">All hostels</option>
            {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Presence
          <select name="presence" defaultValue={f.presence ?? ""} className={field}>
            <option value="">Inside and outside</option>
            {PRESENCE_VALUES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Student name (presence)
          <input name="q" defaultValue={f.q} maxLength={50} placeholder="e.g. Arun" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm">Attendance order
          <select name="sort" defaultValue={f.sort} className={field}>
            {Object.entries(SORT_OPTIONS).map(([key, o]) => <option key={key} value={key}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Violation type
          <select name="vtype" defaultValue={f.vtype ?? ""} className={field}>
            <option value="">All types</option>
            {VIOLATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">Apply</button>
        <Link href="/warden" className="py-2 text-sm underline">Reset</Link>
      </form>

      <Section title="Who is where" note={<LimitNote data={presence} />}>
        <Table empty="No students match these filters." isEmpty={presence.rows.length === 0}
          head={["Student", "Hostel", "Room", "Presence", "Last gate event", "Leave today"]}>
          {presence.rows.map((r) => (
            <tr key={r.student_id} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className={td}>{r.name} <span className="text-zinc-500">({r.roll_no})</span></td>
              <td className={td}>{r.hostel}</td>
              <td className={td}>{r.room_no ?? "–"}</td>
              <td className={td}><span className={r.presence === "outside" ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{r.presence}</span></td>
              <td className={td}>{r.last_seen ?? "no gate record"}</td>
              <td className={td}>{r.on_leave_today ? "yes" : "no"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Roll-call attendance" note={<><LimitNote data={attendance} /> Rows under {LOW_ATTENDANCE_PCT}% are highlighted.</>}>
        <Table empty="No attendance recorded yet." isEmpty={attendance.rows.length === 0}
          head={["Student", "Hostel", "Roll calls", "Present", "Low confidence", "Absent", "Attendance %"]}>
          {attendance.rows.map((r) => {
            const pct = r.attendance_pct === null ? null : Number(r.attendance_pct);
            const low = pct !== null && pct < LOW_ATTENDANCE_PCT;
            return (
              <tr key={r.student_id} className={`border-b border-zinc-200 dark:border-zinc-800 ${low ? "bg-red-50 dark:bg-red-950/30" : ""}`}>
                <td className={td}>{r.name} <span className="text-zinc-500">({r.roll_no})</span></td>
                <td className={td}>{r.hostel}</td>
                <td className={td}>{r.sessions_recorded}</td>
                <td className={td}>{r.present}</td>
                <td className={td}>{r.low_confidence}</td>
                <td className={td}>{r.absent}</td>
                <td className={td}>{pct === null ? "–" : <span className={low ? "font-semibold text-red-700 dark:text-red-400" : ""}>{pct.toFixed(1)}%{low ? " (low)" : ""}</span>}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Open violations" note={<LimitNote data={violations} />}>
        <Table empty="No open violations match these filters." isEmpty={violations.rows.length === 0}
          head={["Type", "Student", "Hostel", "Raised", "Details"]}>
          {violations.rows.map((r) => (
            <tr key={r.violation_id} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className={td}>{r.type}</td>
              <td className={td}>{r.student} <span className="text-zinc-500">({r.roll_no})</span></td>
              <td className={td}>{r.hostel}</td>
              <td className={td}>{r.raised_at}</td>
              <td className={td}>{r.details ?? "–"}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-sm"><Link href="/violations" className="underline">Open the violations page to resolve them</Link></p>
      </Section>

      <Section title="Attendance per hostel per month" note={<>All hostels, all months (not affected by the filters).</>}>
        <Table empty="No roll calls recorded yet." isEmpty={monthly.length === 0}
          head={["Hostel", "Month", "Marks", "Present", "Attendance %"]}>
          {monthly.map((r) => (
            <tr key={`${r.hostel}-${r.month}`} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className={td}>{r.hostel}</td><td className={td}>{r.month}</td><td className={td}>{r.marks}</td>
              <td className={td}>{r.present}</td><td className={td}>{r.attendance_pct}%</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function Card({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: "warn" }) {
  const body = (
    <>
      <span className="block text-3xl font-semibold">{value}</span>
      <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
    </>
  );
  const cls = `rounded-lg border p-4 ${tone === "warn" ? "border-amber-500" : "border-zinc-300 dark:border-zinc-700"}`;
  return href ? <Link href={href} className={`${cls} block hover:bg-zinc-100 dark:hover:bg-zinc-900`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Section({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="mb-2 mt-1 text-sm text-zinc-600 dark:text-zinc-400">{note}</p>}
      {children}
    </section>
  );
}

function LimitNote({ data }: { data: Limited<unknown> }) {
  return data.total > ROW_LIMIT
    ? <>Showing the first {ROW_LIMIT} of {data.total} rows; use the filters to narrow down.</>
    : <>Showing {data.rows.length} {data.rows.length === 1 ? "row" : "rows"} (limit {ROW_LIMIT}).</>;
}

function Table({ head, children, empty, isEmpty }: { head: string[]; children: React.ReactNode; empty: string; isEmpty: boolean }) {
  if (isEmpty) return <p className="rounded border border-dashed border-zinc-400 p-4 text-sm">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-zinc-300 dark:border-zinc-700">{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
