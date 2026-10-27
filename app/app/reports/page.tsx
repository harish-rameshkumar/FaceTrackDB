import Link from "next/link";
import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import { ReportView } from "@/components/reports/ReportView";
import { loadReports, type SearchParams } from "./ReportsLoader";

export const metadata = { title: "Reports | FaceTrackDB" };

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl p-6">
        <Suspense fallback={<p className="text-sm">Loading reports…</p>}>
          <Content searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const loaded = await loadReports(searchParams);
  if ("denied" in loaded) return loaded.denied;
  if ("error" in loaded) return <p className="text-sm text-red-600" role="alert">{loaded.error}</p>;
  const { filters, hostels, reports, historyNote, scope } = loaded;
  const qs = new URLSearchParams({ from: filters.from, to: filters.to, ...(filters.hostelId ? { hostel: String(filters.hostelId) } : {}) }).toString();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Every number comes from a SQL function in db/b_reports.sql. Showing {scope}.</p>
        </div>
        <Link href={`/reports/present?${qs}`} className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">Presentation mode</Link>
      </div>
      {historyNote && <p className="mt-4 rounded border border-amber-500 p-3 text-sm" role="note">{historyNote}</p>}
      <form method="get" className="my-6 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
        <label className="flex flex-col gap-1 text-sm">From<input type="date" name="from" defaultValue={filters.from} className={field} /></label>
        <label className="flex flex-col gap-1 text-sm">To<input type="date" name="to" defaultValue={filters.to} className={field} /></label>
        <label className="flex flex-col gap-1 text-sm">Hostel
          <select name="hostel" defaultValue={filters.hostelId ?? ""} className={field}>
            <option value="">All hostels</option>
            {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
          </select>
        </label>
        <button className="rounded border border-zinc-400 px-4 py-2 text-sm">Apply</button>
        <Link href="/reports" className="py-2 text-sm underline">Reset</Link>
      </form>
      <div className="grid gap-6 lg:grid-cols-2">
        {reports.map((r) => (
          <section key={r.key} className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700" aria-labelledby={`h-${r.key}`}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">SQL concept used: {r.concept}</p>
            <h2 id={`h-${r.key}`} className="mb-3 mt-1 text-lg font-semibold">{r.title}</h2>
            <ReportView report={r} chartHeight={300} />
          </section>
        ))}
      </div>
    </>
  );
}
