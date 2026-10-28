"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { inputClasses } from "@/components/ui/styles";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import { homeFor } from "@/lib/home";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0); // seconds left of a "too many attempts" lock
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // count the lock down once a second; it is a visual aid only (hidden from screen readers)
  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (wait > 0) return;
    setBusy(true);
    setError(null);
    setLockedMessage(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const seconds = Number(data.retryAfterSeconds ?? res.headers.get("retry-after") ?? 0);
        setLockedMessage(data.error ?? "Too many failed sign-in attempts. Try again later.");
        setWait(Number.isFinite(seconds) ? seconds : 0);
        return;
      }
      if (!res.ok) {
        // the same words whether the email exists or not
        setError(res.status === 401 ? "Invalid email or password." : (data.error ?? "Sign in failed. Please try again."));
        return;
      }
      router.push(homeFor(data.user.role));
      router.refresh();
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(wait / 60)).padStart(2, "0");
  const ss = String(wait % 60).padStart(2, "0");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
      <FormField label="Email">
        {(c) => <input {...c} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClasses} />}
      </FormField>
      <FormField label="Password">
        {(c) => (
          <div className="relative">
            <input {...c} type={show ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClasses} pr-11`} />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-2"
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        )}
      </FormField>

      {error && <Notice tone="danger">{error}</Notice>}
      {lockedMessage && (
        <Notice tone="warning" title="Sign-in is paused">
          {lockedMessage}
          {wait > 0 && <span aria-hidden="true"> You can try again in {mm}:{ss}.</span>}
        </Notice>
      )}

      <Button type="submit" variant="primary" loading={busy} disabled={wait > 0}>
        {busy ? "Signing in…" : wait > 0 ? `Try again in ${mm}:${ss}` : "Sign in"}
      </Button>
    </form>
  );
}
