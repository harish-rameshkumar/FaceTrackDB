"use client";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/registration";

const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) return setMsg({ ok: false, text: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (next !== again) return setMsg({ ok: false, text: "The two new passwords do not match" });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current, next }) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) return setMsg({ ok: false, text: "Please sign in first" });
      if (!res.ok) return setMsg({ ok: false, text: json.error ?? "Could not change the password" });
      setCurrent(""); setNext(""); setAgain("");
      setMsg({ ok: true, text: "Password changed." });
    } catch {
      setMsg({ ok: false, text: "Could not change the password. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">Current password<input type="password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
      <label className="flex flex-col gap-1 text-sm">New password<input type="password" className={field} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
      <label className="flex flex-col gap-1 text-sm">New password again<input type="password" className={field} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`} role="status">{msg.text}</p>}
      <button disabled={busy} className="w-fit rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black">Change password</button>
    </form>
  );
}
