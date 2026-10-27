"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { FormField } from "@/components/ui/FormField";
import { inputClasses } from "@/components/ui/styles";
import { Notice } from "@/components/ui/Notice";
import { blankParent, generatePassword, isBlankParent, RELATIONS, validateRegistration, type FieldErrors, type ParentInput } from "@/lib/registration";

interface Hostel { hostel_id: number; name: string }
interface Created { student_id: number; student: { email: string; password: string }; parents: { name: string; email: string; password: string; created: boolean }[] }

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
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Card title="Student">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" error={errors.name}>{(c) => <input {...c} className={inputClasses} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />}</FormField>
          <FormField label="SRN / roll number" error={errors.roll_no}>{(c) => <input {...c} className={inputClasses} value={rollNo} onChange={(e) => setRollNo(e.target.value)} maxLength={20} />}</FormField>
          <FormField label="Hostel" error={errors.hostel_id}>
            {(c) => (
              <select {...c} className={inputClasses} value={hostelId} onChange={(e) => setHostelId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Choose a hostel…</option>
                {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Room number" error={errors.room_no}>{(c) => <input {...c} className={inputClasses} value={roomNo} onChange={(e) => setRoomNo(e.target.value)} maxLength={10} />}</FormField>
          <FormField label="Student login email" error={errors.email}>{(c) => <input {...c} type="email" className={inputClasses} value={email} onChange={(e) => setEmail(e.target.value)} />}</FormField>
          <PasswordField label="Temporary password" value={password} onChange={setPassword} error={errors.password} />
        </div>
      </Card>

      {parents.map((p, i) => (
        <Card key={i} title={i === 0 ? "Parent 1" : "Parent 2 (optional)"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" error={errors[`parents.${i}.name`]}>{(c) => <input {...c} className={inputClasses} value={p.name} onChange={(e) => setParent(i, { name: e.target.value })} maxLength={100} />}</FormField>
            <FormField label="Relation" error={errors[`parents.${i}.relation`]}>
              {(c) => (
                <select {...c} className={inputClasses} value={p.relation} onChange={(e) => setParent(i, { relation: e.target.value })}>
                  <option value="">Choose…</option>
                  {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </FormField>
            <FormField label="Phone" error={errors[`parents.${i}.phone`]}>{(c) => <input {...c} type="tel" className={inputClasses} value={p.phone} onChange={(e) => setParent(i, { phone: e.target.value })} maxLength={15} />}</FormField>
            <FormField label="Login email" error={errors[`parents.${i}.email`]}>{(c) => <input {...c} type="email" className={inputClasses} value={p.email} onChange={(e) => setParent(i, { email: e.target.value })} />}</FormField>
            <PasswordField label="Temporary password" value={p.password} onChange={(v) => setParent(i, { password: v })} error={errors[`parents.${i}.password`]} />
          </div>
        </Card>
      ))}
      <p className="text-xs text-muted">If a parent&apos;s email already belongs to a parent account, that account is linked (a parent can have several wards) and its password is left unchanged.</p>

      <Card>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--primary)]" aria-invalid={!!errors.consent} aria-describedby={errors.consent ? "consent-error" : undefined} />
          <span>
            The student and guardian consent to storing face data for hostel attendance.{" "}
            <span className="text-xs text-muted">(Only face embeddings are stored, never photos: see docs/privacy-and-biometric-policy.md.)</span>
          </span>
        </label>
        {errors.consent && <p id="consent-error" className="mt-2 text-xs font-medium text-danger" role="alert">{errors.consent}</p>}
      </Card>

      {formError && <Notice tone="danger">{formError}</Notice>}
      <div><Button type="submit" variant="primary" loading={busy}>{busy ? "Registering…" : "Register student"}</Button></div>
    </form>
  );
}

function PasswordField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <FormField label={label} error={error}>{(c) => <input {...c} className={`${inputClasses} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />}</FormField>
      <Button variant="link" onClick={() => onChange(generatePassword())} className="self-start text-xs">Generate another</Button>
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
    <section aria-labelledby="creds" className="flex flex-col gap-4">
      <h2 id="creds" className="text-xl font-semibold">Credentials created</h2>
      <Notice tone="warning">Shown once. These temporary passwords are not stored anywhere in readable form: copy or print them now, and ask each person to change theirs at /account.</Notice>
      <Card>
        <DataTable
          caption="New accounts"
          rows={rows}
          rowKey={(r) => r.key}
          columns={[
            { key: "w", header: "Account", render: (r) => r.who },
            { key: "e", header: "Email", render: (r) => r.email, className: "break-all" },
            { key: "p", header: "Temporary password", render: (r) => (r.note ? <em className="text-xs">{r.note}</em> : <span className="font-mono">{r.password}</span>) },
            {
              key: "a", header: "", className: "no-print", render: (r) => (
                <span className="flex flex-wrap gap-3">
                  <Button variant="link" onClick={() => copy(`${r.key}e`, r.email)}>{copied === `${r.key}e` ? "Copied" : "Copy email"}</Button>
                  {!r.note && <Button variant="link" onClick={() => copy(`${r.key}p`, r.password)}>{copied === `${r.key}p` ? "Copied" : "Copy password"}</Button>}
                </span>
              ),
            },
          ]}
        />
      </Card>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        <Button href={`/admin/students/${created.student_id}/enrol`} variant="primary">Continue to face enrolment</Button>
      </div>
    </section>
  );
}
