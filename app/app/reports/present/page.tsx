import { Suspense } from "react";
import { loadReports, type SearchParams } from "../ReportsLoader";
import { Presentation } from "./Presentation";

export const metadata = { title: "Presentation | FaceTrackDB" };

export default function PresentPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="p-8 text-sm">Loading slides…</p>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const loaded = await loadReports(searchParams);
  if ("denied" in loaded) return loaded.denied;
  if ("error" in loaded) return <p className="p-8 text-sm text-red-600" role="alert">{loaded.error}</p>;
  const back = new URLSearchParams({ from: loaded.filters.from, to: loaded.filters.to, ...(loaded.filters.hostelId ? { hostel: String(loaded.filters.hostelId) } : {}) }).toString();
  return <Presentation reports={loaded.reports} scope={loaded.scope} historyNote={loaded.historyNote} backHref={`/reports?${back}`} />;
}
