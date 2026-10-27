"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface Hostel { hostel_id: number; name: string }
interface Session {
  session_id: number; hostel: string; date: string; start: string; end: string;
  present: number; absent: number; low_confidence: number; pending: number; status: "upcoming" | "open" | "ended";
}

const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";
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

  const dialog = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState<{ s: Session; absent: number; violations: number } | null>(null);
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
    try {
      const res = await fetch(`/api/sessions/${s.session_id}/close`);
      const json = await res.json();
      if (!res.ok) return setNotice(json.error ?? "Could not check the roll call");
      setClosing({ s, absent: json.willBeAbsent, violations: json.willGetViolation });
      dialog.current?.showModal();
    } catch {
      setNotice("Could not check the roll call. Check the connection and try again.");
    }
  }

  async function confirmClose() {
    if (!closing) return;
    setBusy(true);
    setCloseError(null);
    try {
      const res = await fetch(`/api/sessions/${closing.s.session_id}/close`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setCloseError(json.error ?? "Could not close the roll call");
      dialog.current?.close();
      setNotice(`Roll call closed: ${json.markedAbsent} marked absent, ${json.violationsRaised} violation${json.violationsRaised === 1 ? "" : "s"} raised.`);
      router.refresh();
    } catch {
      setCloseError("Could not close the roll call. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3" aria-label="Create a roll call">
        <label className="flex flex-col gap-1 text-xs">Hostel
          <select className={field} value={hostelId} onChange={(e) => setHostelId(e.target.value === "" ? "" : Number(e.target.value))}>
            {hostels.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Date<input type="date" className={field} value={date} min={todayIst()} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="flex flex-col gap-1 text-xs">Start<input type="time" className={field} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label className="flex flex-col gap-1 text-xs">End<input type="time" className={field} value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
        <button disabled={busy} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black">Create roll call</button>
      </form>
      {error && <p className="-mt-6 text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="-mt-6 text-sm" role="status">{notice}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-300 dark:border-zinc-700"><th className="py-2">Hostel</th><th>Date</th><th>Window</th><th>Status</th><th>Present</th><th>Absent</th><th>Review</th><th>Not yet marked</th><th /></tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.session_id} className="border-b border-zinc-200 dark:border-zinc-800">
                <td className="py-2">{s.hostel}</td><td>{s.date}</td><td>{s.start}–{s.end}</td>
                <td>{s.status === "ended" && s.pending === 0 ? "closed" : s.status}</td>
                <td>{s.present}</td><td>{s.absent}</td><td>{s.low_confidence}</td><td>{s.pending}</td>
                <td>{s.status === "ended" && s.pending > 0 && <button type="button" className="underline" onClick={() => askClose(s)}>Close roll call</button>}</td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-zinc-500">No roll calls yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog} className="max-w-sm rounded-lg p-5 backdrop:bg-black/50" aria-labelledby="close-title">
        <h2 id="close-title" className="font-semibold">Close this roll call?</h2>
        {closing && (
          <p className="mt-2 text-sm">
            {closing.s.hostel}, {closing.s.date} {closing.s.start}–{closing.s.end}. <strong>{closing.absent} student{closing.absent === 1 ? "" : "s"}</strong> will be marked absent
            {closing.absent > 0 && <>, and <strong>{closing.violations}</strong> missed-attendance violation{closing.violations === 1 ? "" : "s"} will be raised (students on approved leave get none)</>}.
          </p>
        )}
        {closeError && <p className="mt-2 text-sm text-red-600" role="alert">{closeError}</p>}
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button type="button" onClick={() => dialog.current?.close()} className="underline">Cancel</button>
          <button type="button" onClick={confirmClose} disabled={busy} className="rounded bg-red-700 px-3 py-1.5 text-white disabled:opacity-40">{busy ? "Closing…" : "Close roll call"}</button>
        </div>
      </dialog>
    </div>
  );
}
