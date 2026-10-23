import Link from "next/link";
export function AccessDenied({ roles }: { roles: string[] }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This page needs the role: {roles.join(" or ")}. Sign in with an account that has it.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">Back to home</Link>
    </main>
  );
}
