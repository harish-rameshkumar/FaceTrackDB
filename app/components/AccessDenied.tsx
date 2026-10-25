import Link from "next/link";
export function AccessDenied({ roles }: { roles: string[] }) {
  return (
    <section className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This page needs the role: {roles.join(" or ")}. Sign in with an account that has it.
      </p>
      <div className="mt-4 flex gap-4 text-sm">
        <Link href="/login" className="underline">Sign in</Link>
        <Link href="/" className="underline">Back to home</Link>
      </div>
    </section>
  );
}
