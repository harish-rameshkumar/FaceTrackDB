"use client";
import Link from "next/link";
import { useState } from "react";
import { blankParent, generatePassword, isBlankParent, RELATIONS, validateRegistration, type FieldErrors, type ParentInput } from "@/lib/registration";

interface Hostel { hostel_id: number; name: string }
interface Created { student_id: number; student: { email: string; password: string }; parents: { name: string; email: string; password: string; created: boolean }[] }

const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";

function Input({ label, error, ...rest }: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input className={field} aria-invalid={!!error} {...rest} />
      {error && <span className="text-xs text-red-600" role="alert">{error}</span>}
    </label>
  );
}

export function RegisterForm({ hostels }: { hostels: Hostel[] }) {
  const [name, setName] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [hostelId, setHostelId] = useState<number | "">("");
  const [roomNo, setRoomNo] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [parents, setParents] = useState<ParentInput[]>(() => [
    { ...blankParent(), password: generatePassword() },
    { ...blankParent(), password: generatePassword() },
  ]);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const setParent = (i: number, patch: Partial<ParentInput>) => setParents((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  function collect() {
    const used = isBlankParent(parents[1]) ? [parents[0]] : parents;
    return { name, roll_no: rollNo, hostel_id: hostelId === "" ? null : hostelId, room_no: roomNo, email, password, parents: used, consent };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = collect();
    const clientErrors = validateRegistration(input);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) {
      setFormError("Please correct the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/students", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const json = await res.json();
      if (!res.ok) {
        setErrors(json.fieldErrors ?? {});
        setFormError(json.error ?? "Registration failed");
        return;
      }
      setCreated({
        student_id: json.student_id,
        student: { email: email.trim().toLowerCase(), password },
        parents: input.parents.map((p, i) => ({ name: p.name, email: p.email.trim().toLowerCase(), password: p.password, created: json.parents[i]?.created !== false })),
      });
    } catch {
      setFormError("Registration failed. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (created) return <Credentials created={created} />;

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5" noValidate>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Student</legend>
        <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={100} />
        <Input label="SRN / roll number" value={rollNo} onChange={(e) => setRollNo(e.target.value)} error={errors.roll_no} maxLength={20} />
        <label className="flex flex-col gap-1 text-sm">
          Hostel
          <select className={field} value={hostelId} onChange={(e) => setHostelId(e.target.value === "" ? "" : Number(e.target.value))} aria-invalid={!!errors.hostel_id}>
            <option value="">Choose a hostel…</option>
            {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
          </select>
          {errors.hostel_id && <span className="text-xs text-red-600" role="alert">{errors.hostel_id}</span>}
        </label>
        <Input label="Room number" value={roomNo} onChange={(e) => setRoomNo(e.target.value)} error={errors.room_no} maxLength={10} />
        <Input label="Student login email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordInput label="Temporary password" value={password} onChange={setPassword} error={errors.password} />
      </fieldset>

      {parents.map((p, i) => (
        <fieldset key={i} className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 font-semibold">{i === 0 ? "Parent 1" : "Parent 2 (optional)"}</legend>
          <Input label="Name" value={p.name} onChange={(e) => setParent(i, { name: e.target.value })} error={errors[`parents.${i}.name`]} maxLength={100} />
          <label className="flex flex-col gap-1 text-sm">
            Relation
            <select className={field} value={p.relation} onChange={(e) => setParent(i, { relation: e.target.value })}>
              <option value="">Choose…</option>
              {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {errors[`parents.${i}.relation`] && <span className="text-xs text-red-600" role="alert">{errors[`parents.${i}.relation`]}</span>}
          </label>
          <Input label="Phone" value={p.phone} onChange={(e) => setParent(i, { phone: e.target.value })} error={errors[`parents.${i}.phone`]} maxLength={15} />
          <Input label="Login email" type="email" value={p.email} onChange={(e) => setParent(i, { email: e.target.value })} error={errors[`parents.${i}.email`]} />
          <PasswordInput label="Temporary password" value={p.password} onChange={(v) => setParent(i, { password: v })} error={errors[`parents.${i}.password`]} />
        </fieldset>
      ))}
      <p className="text-xs text-zinc-500">If a parent&apos;s email already belongs to a parent account, that account is linked (a parent can have several wards) and its password is left unchanged.</p>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" aria-invalid={!!errors.consent} />
        <span>The student and guardian consent to storing face data for hostel attendance. <span className="text-xs text-zinc-500">(Only face embeddings are stored, never photos: see docs/privacy-and-biometric-policy.md.)</span></span>
      </label>
      {errors.consent && <span className="text-xs text-red-600" role="alert">{errors.consent}</span>}

      {formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}
      <button type="submit" disabled={busy} className="w-fit rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black">
        {busy ? "Registering…" : "Register student"}
      </button>
    </form>
  );
}

function PasswordInput({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error} autoComplete="off" spellCheck={false} />
      <button type="button" onClick={() => onChange(generatePassword())} className="w-fit text-xs underline">Generate another</button>
    </div>
  );
}

function Credentials({ created }: { created: Created }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }
  const rows = [
    { key: "s", who: "Student", email: created.student.email, password: created.student.password, note: "" },
    ...created.parents.map((p, i) => ({ key: `p${i}`, who: `Parent: ${p.name}`, email: p.email, password: p.password, note: p.created ? "" : "Existing parent account linked; its password is unchanged" })),
  ];
  return (
    <section className="max-w-2xl" aria-labelledby="creds">
      <h2 id="creds" className="text-xl font-semibold">Credentials created</h2>
      <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">Shown once. These temporary passwords are not stored anywhere in readable form: copy or print them now, and ask each person to change theirs at /account.</p>
      <table className="mt-4 w-full text-left text-sm">
        <thead><tr className="border-b border-zinc-300"><th className="py-2">Account</th><th>Email</th><th>Temporary password</th><th className="print:hidden" /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-zinc-200 align-top dark:border-zinc-800">
              <td className="py-2">{r.who}</td>
              <td className="break-all">{r.email}</td>
              <td className="font-mono">{r.note ? <em className="font-sans text-xs">{r.note}</em> : r.password}</td>
              <td className="space-x-2 whitespace-nowrap print:hidden">
                <button type="button" className="underline" onClick={() => copy(`${r.key}e`, r.email)}>{copied === `${r.key}e` ? "Copied" : "Copy email"}</button>
                {!r.note && <button type="button" className="underline" onClick={() => copy(`${r.key}p`, r.password)}>{copied === `${r.key}p` ? "Copied" : "Copy password"}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-6 flex gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded border border-zinc-400 px-4 py-2 text-sm">Print</button>
        <Link href={`/admin/students/${created.student_id}/enrol`} className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">Continue to face enrolment</Link>
      </div>
    </section>
  );
}
