"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { inputClasses } from "@/components/ui/styles";
import { Notice } from "@/components/ui/Notice";
import { StatusPill } from "@/components/ui/StatusPill";

interface Hostel { hostel_id: number; name: string }
interface Session {
  session_id: number; hostel: string; date: string; start: string; end: string;
  present: number; absent: number; low_confidence: number; pending: number; status: "upcoming" | "open" | "ended";
}

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export function SessionsManager({ hostels, sessions }: { hostels: Hostel[]; sessions: Session[] }) {
  const router = useRouter();
  const [hostelId, setHostelId] = useState<number | "">(hostels[0]?.hostel_id ?? "");
  const [date, setDate] = useState(todayIst());
  const [start, setStart] = useState("20:00");
  const [end, setEnd] = useState("20:30");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [closing, setClosing] = useState<{ s: Session; absent: number; violations: number } | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (hostelId === "") return setError("Choose a hostel");
    if (end <= start) return setError("The end time must be after the start time");
    setBusy(true);
    try {
      const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hostel_id: hostelId, date, start, end }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setError(json.error ?? "Could not create the roll call");
      setNotice("Roll call created.");
      router.refresh();
    } catch {
      setError("Could not create the roll call. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function askClose(s: Session) {
    setCloseError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sessions/${s.session_id}/close`);
      const json = await res.json();
      if (!res.ok) return setNotice(json.error ?? "Could not check the roll call");
      setClosing({ s, absent: json.willBeAbsent, violations: json.willGetViolation });
    } catch {
      setNotice("Could not check the roll call. Check the connection and try again.");
    }
  }

  async function confirmClose() {
    if (!closing) return;
    setCloseBusy(true);
    setCloseError(null);
    try {
      const res = await fetch(`/api/sessions/${closing.s.session_id}/close`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setCloseError(json.error ?? "Could not close the roll call");
      setClosing(null);
      setNotice(`Roll call closed: ${json.markedAbsent} marked absent, ${json.violationsRaised} violation${json.violationsRaised === 1 ? "" : "s"} raised.`);
      router.refresh();
    } catch {
      setCloseError("Could not close the roll call. Check the connection and try again.");
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title="Create a roll call">
        <form onSubmit={create} aria-label="Create a roll call" className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Hostel">
              {(c) => (
                <select {...c} className={inputClasses} value={hostelId} onChange={(e) => setHostelId(e.target.value === "" ? "" : Number(e.target.value))}>
                  {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
                </select>
              )}
            </FormField>
            <FormField label="Date">{(c) => <input {...c} type="date" className={inputClasses} value={date} min={todayIst()} onChange={(e) => setDate(e.target.value)} required />}</FormField>
            <FormField label="Start">{(c) => <input {...c} type="time" className={inputClasses} value={start} onChange={(e) => setStart(e.target.value)} required />}</FormField>
            <FormField label="End">{(c) => <input {...c} type="time" className={inputClasses} value={end} onChange={(e) => setEnd(e.target.value)} required />}</FormField>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <div><Button type="submit" variant="primary" loading={busy}>Create roll call</Button></div>
        </form>
      </Card>

      {notice && <Notice tone="info">{notice}</Notice>}

      <Card title="Roll calls" description="The latest 100. A roll call can be closed once it has ended and students are still unmarked.">
        <DataTable
          caption="Roll calls"
          rows={sessions}
          rowKey={(s) => s.session_id}
          empty={<EmptyState title="No roll calls yet">Create one above.</EmptyState>}
          columns={[
            { key: "h", header: "Hostel", render: (s) => s.hostel },
            { key: "d", header: "Date", render: (s) => s.date, className: "whitespace-nowrap" },
            { key: "w", header: "Window", render: (s) => `${s.start}–${s.end}`, className: "whitespace-nowrap" },
            { key: "s", header: "Status", render: (s) => <StatusPill status={s.status === "ended" && s.pending === 0 ? "closed" : s.status} /> },
            { key: "p", header: "Present", render: (s) => s.present },
            { key: "a", header: "Absent", render: (s) => s.absent },
            { key: "r", header: "Review", render: (s) => s.low_confidence },
            { key: "n", header: "Not yet marked", render: (s) => s.pending },
            { key: "x", header: "", render: (s) => (s.status === "ended" && s.pending > 0 ? <Button variant="link" onClick={() => askClose(s)}>Close roll call</Button> : null) },
          ]}
        />
      </Card>

      <ConfirmDialog
        open={closing !== null}
        title="Close this roll call?"
        confirmLabel="Close roll call"
        tone="danger"
        busy={closeBusy}
        error={closeError}
        onConfirm={confirmClose}
        onCancel={() => setClosing(null)}
      >
        {closing && (
          <p>
            {closing.s.hostel}, {closing.s.date} {closing.s.start}–{closing.s.end}. <strong className="text-fg">{closing.absent} student{closing.absent === 1 ? "" : "s"}</strong> will be marked absent
            {closing.absent > 0 && <>, and <strong className="text-fg">{closing.violations}</strong> missed-attendance violation{closing.violations === 1 ? "" : "s"} will be raised (students on approved leave get none)</>}.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
