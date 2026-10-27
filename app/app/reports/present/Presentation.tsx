"use client";
import Link from "next/link";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ReportView } from "@/components/reports/ReportView";
import type { ReportResult } from "@/lib/reports";

// Full-screen slides, one report per slide. Keys: Right / Down / PageDown / Space = next,
// Left / Up / PageUp = previous, Home / End, F = full screen, Esc leaves full screen.
// Printing (browser Print dialog > Save as PDF) puts every slide on its own landscape page.
// The current slide lives in the URL hash (#slide-3), so reloading or sharing the link keeps the place.
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener("slidechange", cb);
  return () => { window.removeEventListener("hashchange", cb); window.removeEventListener("slidechange", cb); };
};
const readHash = () => window.location.hash;

export function Presentation({ reports, scope, historyNote, backHref }: { reports: ReportResult[]; scope: string; historyNote: string | null; backHref: string }) {
  const last = reports.length - 1;
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const m = /^#slide-(\d+)$/.exec(hash);
  const cur = m ? Math.max(0, Math.min(last, Number(m[1]) - 1)) : 0;

  const go = useCallback((i: number) => {
    const next = Math.max(0, Math.min(last, i));
    history.replaceState(null, "", `#slide-${next + 1}`);
    window.dispatchEvent(new Event("slidechange"));
  }, [last]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(cur + 1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go(cur - 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(last); }
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, go, last]);

  const btn = "rounded border border-zinc-400 px-3 py-1.5 text-sm disabled:opacity-40";
  return (
    <div className="deck fixed inset-0 z-50 flex flex-col overflow-auto bg-[var(--background)] text-[var(--foreground)] print:static print:block print:overflow-visible">
      <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-zinc-300 px-6 py-3 dark:border-zinc-700">
        <div className="text-sm"><Link href={backHref} className="underline">Exit</Link> <span className="ml-3 text-zinc-600 dark:text-zinc-400">{scope}</span></div>
        <div className="flex items-center gap-2" role="group" aria-label="Slide controls">
          <button className={btn} onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="Previous slide">&larr; Previous</button>
          <span className="min-w-16 text-center text-sm" aria-live="polite">{cur + 1} / {reports.length}</span>
          <button className={btn} onClick={() => go(cur + 1)} disabled={cur === last} aria-label="Next slide">Next &rarr;</button>
          <button className={btn} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>Full screen (F)</button>
          <button className={btn} onClick={() => window.print()}>Print / PDF</button>
        </div>
      </header>

      {reports.map((r, i) => (
        <section key={r.key} className={`slide mx-auto w-full max-w-6xl flex-1 p-8 ${i === cur ? "block" : "hidden"} print:block`} aria-label={`Slide ${i + 1} of ${reports.length}`} aria-hidden={i !== cur}>
          <p className="text-sm uppercase tracking-wide text-zinc-600 dark:text-zinc-400">SQL concept used: <strong>{r.concept}</strong></p>
          <h1 className="mb-6 mt-2 text-3xl font-semibold leading-tight">{r.title}</h1>
          <ReportView report={r} chartHeight={380} big />
          <p className="mt-6 text-xs text-zinc-600 dark:text-zinc-400">
            {scope} · slide {i + 1} of {reports.length}{historyNote ? ` · ${historyNote}` : ""}
          </p>
        </section>
      ))}
    </div>
  );
}
