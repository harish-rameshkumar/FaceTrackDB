import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { inputClasses } from "@/components/ui/styles";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";
import { AuthError, requireRole } from "@/lib/auth";
import { MAX_QUERY_LENGTH, MAX_RESULTS, SCOPES, parseSearch, searchText, type Markers, type SearchHit } from "@/lib/search";

export const metadata = { title: "Search | FaceTrackDB" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WardenSearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageShell>
      <PageHeader
        title="Search"
        description={<>Full-text search over violation details and leave reasons. Plain words, &quot;quoted phrases&quot;, <code>or</code> and <code>-exclude</code> all work.</>}
      />
      <Suspense fallback={<Spinner label="Loading" />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function SearchContent({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requireRole(["warden", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["warden", "admin"]} />;
    throw e;
  }

  const { q, scope, tooLong } = parseSearch(await searchParams);
  let hits: SearchHit[] = [];
  let markers: Markers = { start: "", end: "" };
  let failed = false;
  if (q) {
    try {
      ({ hits, markers } = await searchText(q, scope));
    } catch (e) {
      console.error("search failed", e);
      failed = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field label="Search for" className="min-w-64 flex-1">
          <input name="q" defaultValue={q} maxLength={MAX_QUERY_LENGTH} placeholder="e.g. curfew, medical, &quot;roll call&quot;" className={inputClasses} />
        </Field>
        <Field label="Look in">
              <select name="scope" defaultValue={scope} className={inputClasses}>
              {Object.entries(SCOPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            </Field>
        <Button type="submit" variant="primary">Search</Button>
      </form>

      {tooLong && <Notice tone="warning">The search was longer than {MAX_QUERY_LENGTH} characters and was shortened.</Notice>}
      {!q && <EmptyState title="Type a word or phrase to search">For example <em>curfew</em> or <em>medical</em>.</EmptyState>}
      {failed && <Notice tone="danger">The search could not be completed. Please try again.</Notice>}
      {q && !failed && hits.length === 0 && <EmptyState title="No results for this search">Try fewer or different words.</EmptyState>}

      {hits.length > 0 && (
        <>
          <p className="text-sm text-muted" role="status">
            {hits.length === MAX_RESULTS ? `Showing the best ${MAX_RESULTS} results; refine the search to narrow them down.` : `${hits.length} ${hits.length === 1 ? "result" : "results"}.`} Best match first.
          </p>
          <ul className="flex flex-col gap-3">
            {hits.map((h) => (
              <Card as="li" key={`${h.source}-${h.id}`}>
                <p className="text-sm">
                  <span className="font-medium">{h.student}</span> <span className="text-muted">({h.roll_no})</span> · {h.hostel}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusPill status={h.source} label={h.source === "violation" ? "Violation" : "Leave request"} />
                  <span>{h.kind} · {h.happened} · rank {h.rank.toFixed(3)}</span>
                </p>
                <p className="mt-2 text-sm"><Highlighted text={h.snippet} markers={markers} /></p>
              </Card>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Splits the ts_headline output on this request's start and end markers and
// renders the matched parts in <mark>. Everything else is plain text that React escapes.
function Highlighted({ text, markers }: { text: string; markers: Markers }) {
  const out: React.ReactNode[] = [];
  let marked = false;
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const next = marked ? markers.end : markers.start;
    const at = rest.indexOf(next);
    const piece = at === -1 ? rest : rest.slice(0, at);
    if (piece) out.push(marked ? <mark key={key++} className="rounded bg-mark-bg px-0.5 text-mark-text">{piece}</mark> : <span key={key++}>{piece}</span>);
    if (at === -1) break;
    rest = rest.slice(at + next.length);
    marked = !marked;
  }
  return <>{out}</>;
}
