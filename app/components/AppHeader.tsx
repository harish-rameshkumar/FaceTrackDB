"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFetch } from "./useApi";

type Me = { user: { name: string | null; email: string; role: string } };

// Which links each role sees
const NAV: Record<string, { href: string; label: string }[]> = {
  student: [
    { href: "/student/leave", label: "My leave" },
    { href: "/violations", label: "Violations" },
  ],
  parent: [
    { href: "/parent/leave", label: "Leave requests" },
    { href: "/violations", label: "Violations" },
  ],
  warden: [
    { href: "/warden", label: "Dashboard" },
    { href: "/warden/search", label: "Search" },
    { href: "/warden/review", label: "Review scans" },
    { href: "/violations", label: "Violations" },
  ],
  security: [{ href: "/gate", label: "Gate" }],
  admin: [
    { href: "/warden", label: "Dashboard" },
    { href: "/warden/search", label: "Search" },
    { href: "/enrol", label: "Enrol faces" },
    { href: "/gate", label: "Gate" },
    { href: "/warden/review", label: "Review scans" },
    { href: "/violations", label: "Violations" },
  ],
};

export default function AppHeader() {
  const router = useRouter();
  const { data } = useFetch<Me>("/api/me");
  const user = data?.user;

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 px-6 py-3">
      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="font-semibold">
          FaceTrackDB
        </Link>
        {user &&
          (NAV[user.role] ?? []).map((link) => (
            <Link key={link.href} href={link.href} className="underline">
              {link.label}
            </Link>
          ))}
      </nav>
      <div className="flex items-center gap-3 text-sm">
        {user ? (
          <>
            <span>
              {user.name ?? user.email} ({user.role})
            </span>
            <button type="button" onClick={signOut} className="underline">
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login" className="underline">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
