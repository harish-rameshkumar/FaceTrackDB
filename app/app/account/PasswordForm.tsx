"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { Notice } from "@/components/ui/Notice";
import { MIN_PASSWORD_LENGTH } from "@/lib/registration";

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
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormField label="Current password">{(c) => <input {...c} type="password" className={inputClasses} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />}</FormField>
        <FormField label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>{(c) => <input {...c} type="password" className={inputClasses} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}</FormField>
        <FormField label="New password again">{(c) => <input {...c} type="password" className={inputClasses} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />}</FormField>
        {msg && <Notice tone={msg.ok ? "success" : "danger"}>{msg.text}</Notice>}
        <div><Button type="submit" variant="primary" loading={busy}>Change password</Button></div>
      </form>
    </Card>
  );
}
