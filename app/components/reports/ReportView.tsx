"use client";
import type { ReportResult } from "@/lib/reports";
import { ReportChart } from "./charts";

/** One report: key numbers, chart (or an empty-data message), note, and collapsible query and data. */
export function ReportView({ report, chartHeight, big = false }: { report: ReportResult; chartHeight: number; big?: boolean }) {
  const cols = report.rows[0] ? Object.keys(report.rows[0]) : [];
  return (
    <div className="flex flex-col gap-4">
      {report.empty ? (
        <p className="rounded border border-dashed border-zinc-400 p-8 text-center text-lg" role="status">No data for this range</p>
      ) : (
        <>
          <dl className={`grid gap-3 ${big ? "grid-cols-3" : "grid-cols-3 text-sm"}`}>
            {report.numbers.map((k) => (
              <div key={k.label} className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
                <dd className={`${big ? "text-3xl" : "text-xl"} font-semibold`}>{k.value}</dd>
                <dt className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{k.label}</dt>
              </div>
            ))}
          </dl>
          <ReportChart report={report} height={chartHeight} />
        </>
      )}
      {report.note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{report.note}</p>}
      <details className="no-print rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700">
        <summary className="cursor-pointer select-none">Show query</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{report.sql}</pre>
      </details>
      {!report.empty && (
        <details className="no-print rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700">
          <summary className="cursor-pointer select-none">Show data ({report.rows.length} rows)</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-zinc-300 dark:border-zinc-700">{cols.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}</tr></thead>
              <tbody>{report.rows.map((r, i) => <tr key={i} className="border-b border-zinc-200 dark:border-zinc-800">{cols.map((c) => <td key={c} className="py-1 pr-3">{String(r[c] ?? "–")}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
