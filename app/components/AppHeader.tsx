"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";
import { MenuIcon } from "./ui/icons";
import { useFetch } from "./useApi";

type Me = { user: { name: string | null; email: string; role: string } };
type NavLink = { href: string; label: string };

// Which links each role sees, in order. Account is last for everyone.
const ACCOUNT: NavLink = { href: "/account", label: "Account" };
const NAV: Record<string, NavLink[]> = {
  student: [
    { href: "/student", label: "Home" },
    { href: "/student/leave", label: "Leave" },
    { href: "/student/history", label: "History" },
    ACCOUNT,
  ],
  parent: [
    { href: "/parent", label: "Home" },
    { href: "/parent/leave", label: "Leave" },
    { href: "/parent/history", label: "Child's history" },
    ACCOUNT,
  ],
  warden: [
    { href: "/warden", label: "Dashboard" },
    { href: "/warden/search", label: "Search" },
    { href: "/warden/review", label: "Review scans" },
    { href: "/warden/sessions", label: "Roll calls" },
    { href: "/reports", label: "Reports" },
    { href: "/violations", label: "Violations" },
    ACCOUNT,
  ],
  security: [{ href: "/gate", label: "Gate" }, ACCOUNT],
  admin: [
    { href: "/admin/students", label: "Students" },
    { href: "/enrol", label: "Enrol faces" },
    { href: "/warden/sessions", label: "Roll calls" },
    { href: "/reports", label: "Reports" },
    { href: "/violations", label: "Violations" },
    ACCOUNT,
  ],
};

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { data, loading } = useFetch<Me>("/api/me");
  const user = data?.user;
  // the menu is "open for" one path, so it closes by itself when you navigate
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const toggleRef = useRef<HTMLButtonElement>(null);

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const links = user ? (NAV[user.role] ?? [ACCOUNT]) : [];

  const linkClass = (href: string) =>
    cx(
      "rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
      isActive(pathname, href) ? "bg-primary text-primary-fg" : "text-fg hover:bg-surface-2",
    );

  return (
    <header
      className="no-print sticky top-0 z-40 border-b border-border bg-surface"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpenFor(null);
          toggleRef.current?.focus();
        }
      }}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="rounded-md px-1 text-base font-semibold tracking-tight">FaceTrackDB</Link>
        </div>

        <nav aria-label="Main" className="hidden flex-1 flex-wrap items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)} aria-current={isActive(pathname, l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden max-w-[16rem] truncate text-sm sm:inline" title={user.email}>
                <span className="font-medium">{user.name ?? user.email}</span>{" "}
                <span className="rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-medium text-neutral-text">{user.role}</span>
              </span>
              <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
            </>
          ) : loading ? null : (
            <Button href="/login" variant="primary" size="sm">Sign in</Button>
          )}
          {user && (
            <button
              ref={toggleRef}
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-sm font-medium hover:bg-surface-2 lg:hidden"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpenFor(open ? null : pathname)}
            >
              <MenuIcon />
              <span>Menu</span>
            </button>
          )}
        </div>
      </div>

      {user && open && (
        <nav id="mobile-menu" aria-label="Main" className="border-t border-border px-4 py-2 lg:hidden">
          <p className="mb-1 px-3 text-xs text-muted sm:hidden">
            {user.name ?? user.email} ({user.role})
          </p>
          <ul className="flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={cx("block", linkClass(l.href))} aria-current={isActive(pathname, l.href) ? "page" : undefined}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
