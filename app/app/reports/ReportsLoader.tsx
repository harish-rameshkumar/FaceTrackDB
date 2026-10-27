import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth";
import { getGeneratedHistoryNote, getHostels, parseReportFilters, runReports, type Hostel, type ReportFilters, type ReportResult } from "@/lib/reports";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export interface LoadedReports {
  filters: ReportFilters;
  hostels: Hostel[];
  reports: ReportResult[];
  historyNote: string | null;
  scope: string;
}

/** Checks the role, validates the filters and runs every report. Returns an AccessDenied element, or the data, or a fixed error message. */
export async function loadReports(searchParams: SearchParams): Promise<{ denied: React.ReactElement } | { error: string } | LoadedReports> {
  try {
    await requireRole(["warden", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return { denied: <AccessDenied roles={["warden", "admin"]} /> };
    throw e;
  }
  try {
    const hostels = await getHostels();
    const filters = await parseReportFilters(await searchParams, hostels);
    const [reports, historyNote] = await Promise.all([runReports(filters), getGeneratedHistoryNote(filters)]);
    const hostel = hostels.find((h) => h.hostel_id === filters.hostelId)?.name ?? "all hostels";
    return { filters, hostels, reports, historyNote, scope: `${filters.from} to ${filters.to}, ${hostel}` };
  } catch (e) {
    console.error("reports failed", e);
    return { error: "The reports could not be loaded. Check that ./db/load_b.sh has been run (it creates the report functions)." };
  }
}
