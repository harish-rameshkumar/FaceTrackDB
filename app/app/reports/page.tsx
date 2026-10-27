import { Suspense } from "react";
import { PageShell } from "@/components/PageShell";
import { ReportView } from "@/components/reports/ReportView";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { loadReports, type SearchParams } from "./ReportsLoader";

export const metadata = { title: "Reports | FaceTrackDB" };

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageShell width="wide">
      <Suspense fallback={<Spinner label="Loading reports" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const loaded = await loadReports(searchParams);
  if ("denied" in loaded) return loaded.denied;
  if ("error" in loaded) return <Notice tone="danger">{loaded.error}</Notice>;
  const { filters, hostels, reports, historyNote, scope } = loaded;
  const qs = new URLSearchParams({ from: filters.from, to: filters.to, ...(filters.hostelId ? { hostel: String(filters.hostelId) } : {}) }).toString();
  return (
    <>
      <PageHeader
        title="Reports"
        description={`Every number comes from a SQL function in db/b_reports.sql. Showing ${scope}.`}
        actions={<Button href={`/reports/present?${qs}`} variant="primary">Presentation mode</Button>}
      />
      {historyNote && <Notice tone="warning" className="mb-4">{historyNote}</Notice>}
      <form method="get" aria-label="Report filters" className="mb-6 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="From">{(c) => <input {...c} type="date" name="from" defaultValue={filters.from} className={inputClasses} />}</FormField>
          <FormField label="To">{(c) => <input {...c} type="date" name="to" defaultValue={filters.to} className={inputClasses} />}</FormField>
          <FormField label="Hostel">
            {(c) => (
              <select {...c} name="hostel" defaultValue={filters.hostelId ?? ""} className={inputClasses}>
                <option value="">All hostels</option>
                {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
              </select>
            )}
          </FormField>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit" variant="primary">Apply</Button>
          <Button href="/reports" variant="secondary">Reset</Button>
        </div>
      </form>
      <div className="grid gap-6 lg:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.key} className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">SQL concept used: {r.concept}</p>
            <h2 id={`h-${r.key}`} className="mb-3 mt-1 text-lg font-semibold">{r.title}</h2>
            <ReportView report={r} chartHeight={300} />
          </Card>
        ))}
      </div>
    </>
  );
}
