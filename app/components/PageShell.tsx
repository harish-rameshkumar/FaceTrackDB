import AppHeader from "@/components/AppHeader";

const WIDTH = { narrow: "max-w-2xl", default: "max-w-5xl", wide: "max-w-7xl" } as const;

/** The header plus the page's <main> (the target of the "Skip to main content" link). */
export function PageShell({ children, width = "default" }: { children: React.ReactNode; width?: keyof typeof WIDTH }) {
  return (
    <>
      <AppHeader />
      <main id="main" className={`mx-auto w-full ${WIDTH[width]} flex-1 px-4 py-6 sm:px-6`}>
        {children}
      </main>
    </>
  );
}
