const links = [
  { href: "/enrol", title: "Enrol faces", who: "Admin", text: "Capture a student's face and store it for recognition." },
  { href: "/gate", title: "Gate and roll call", who: "Security", text: "Scan faces at the gate or during the evening roll call." },
  { href: "/warden/review", title: "Review queue", who: "Warden", text: "Decide the scans the system was not sure about." },
  { href: "/api/health", title: "System health", who: "Anyone", text: "Check the database and vector store connections." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">FaceTrackDB</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">Face-recognition attendance and gate tracking for hostels.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="block rounded-lg border border-zinc-300 p-4 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
              <span className="text-xs uppercase tracking-wide text-zinc-500">{l.who}</span>
              <span className="mt-1 block text-lg font-medium">{l.title}</span>
              <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">{l.text}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-xs text-zinc-500">
        Development: until the real login is added, act as a role with the cookie <code>dev_role</code> (admin, security or warden).
      </p>
    </main>
  );
}
