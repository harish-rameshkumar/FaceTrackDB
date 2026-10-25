import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import AppHeader from "@/components/AppHeader";
import { AuthError, requireRole } from "@/lib/auth";
import { MAX_QUERY_LENGTH, MAX_RESULTS, SCOPES, parseSearch, searchText, type Markers, type SearchHit } from "@/lib/search";

export const metadata = { title: "Search | FaceTrackDB" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WardenSearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Full-text search over violation details and leave reasons. Plain words, &quot;quoted phrases&quot;, <code>or</code> and <code>-exclude</code> all work.
        </p>
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <SearchContent searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";

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
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">Search for
          <input name="q" defaultValue={q} maxLength={MAX_QUERY_LENGTH} placeholder="e.g. curfew, medical, &quot;roll call&quot;" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm">Look in
          <select name="scope" defaultValue={scope} className={field}>
            {Object.entries(SCOPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">Search</button>
      </form>

      {tooLong && <p className="text-sm text-amber-700 dark:text-amber-400">The search was longer than {MAX_QUERY_LENGTH} characters and was shortened.</p>}

      {!q && <p className="rounded border border-dashed border-zinc-400 p-4 text-sm">Type a word or phrase above to search, for example <em>curfew</em> or <em>medical</em>.</p>}
      {failed && <p role="alert" className="text-sm text-red-600">The search could not be completed. Please try again.</p>}
      {q && !failed && hits.length === 0 && <p className="rounded border border-dashed border-zinc-400 p-4 text-sm">No results for this search.</p>}

      {hits.length > 0 && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {hits.length === MAX_RESULTS ? `Showing the best ${MAX_RESULTS} results; refine the search to narrow them down.` : `${hits.length} ${hits.length === 1 ? "result" : "results"}.`} Best match first.
          </p>
          <ul className="flex flex-col gap-3">
            {hits.map((h) => (
              <li key={`${h.source}-${h.id}`} className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
                <p className="text-sm">
                  <span className="font-medium">{h.student}</span> <span className="text-zinc-500">({h.roll_no})</span> · {h.hostel}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                  {h.source === "violation" ? "Violation" : "Leave request"} · {h.kind} · {h.happened} · rank {h.rank.toFixed(3)}
                </p>
                <p className="mt-2 text-sm"><Highlighted text={h.snippet} markers={markers} /></p>
              </li>
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
    if (piece) out.push(marked ? <mark key={key++} className="rounded bg-yellow-200 px-0.5 text-black">{piece}</mark> : <span key={key++}>{piece}</span>);
    if (at === -1) break;
    rest = rest.slice(at + next.length);
    marked = !marked;
  }
  return <>{out}</>;
}
