"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Student { student_id: number; roll_no: string; name: string }

export function ReviewActions({ eventId, candidateId, students }: { eventId: number; candidateId: number | null; students: Student[] }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<number | "">(candidateId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "confirm" | "reject") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/review/${eventId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "confirm" ? { action, student_id: studentId === "" ? undefined : studentId } : { action }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        className="rounded border border-zinc-300 bg-transparent p-1 dark:border-zinc-700"
        value={studentId}
        onChange={(e) => setStudentId(e.target.value === "" ? "" : Number(e.target.value))}
        disabled={busy}
        aria-label={`Student for event ${eventId}`}
      >
        {students.map((s) => <option key={s.student_id} value={s.student_id}>{s.roll_no} · {s.name}</option>)}
      </select>
      <div className="flex gap-2">
        <button onClick={() => decide("confirm")} disabled={busy || studentId === ""} className="rounded bg-green-700 px-3 py-1 text-white disabled:opacity-40">Confirm</button>
        <button onClick={() => decide("reject")} disabled={busy} className="rounded border border-zinc-400 px-3 py-1 disabled:opacity-40">Reject</button>
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
