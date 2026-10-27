import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";

const WIDTH = { narrow: "max-w-2xl", default: "max-w-5xl", wide: "max-w-7xl" } as const;

/**
 * The header plus the page's <main> (the target of the "Skip to main content" link).
 * `suspendHeader` wraps the header in Suspense, needed only on routes with a dynamic [segment]
 * because the header reads the current path.
 */
export function PageShell({ children, width = "default", suspendHeader = false }: { children: React.ReactNode; width?: keyof typeof WIDTH; suspendHeader?: boolean }) {
  return (
    <>
      {suspendHeader ? (
        <Suspense fallback={<div className="h-14 border-b border-border bg-surface" aria-hidden="true" />}>
          <AppHeader />
        </Suspense>
      ) : (
        <AppHeader />
      )}
      <main id="main" className={`mx-auto w-full ${WIDTH[width]} flex-1 px-4 py-6 sm:px-6`}>
        {children}
      </main>
    </>
  );
}
