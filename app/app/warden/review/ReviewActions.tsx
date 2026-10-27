"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/styles";
import { Notice } from "@/components/ui/Notice";

interface Student { student_id: number; roll_no: string; name: string }

export function ReviewActions({ eventId, candidateId, students }: { eventId: number; candidateId: number | null; students: Student[] }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<number | "">(candidateId ?? "");
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "confirm" | "reject") {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/review/${eventId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "confirm" ? { action, student_id: studentId === "" ? undefined : studentId } : { action }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "The decision could not be saved");
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-48 flex-col gap-2">
      <select
        className={inputClasses}
        value={studentId}
        onChange={(e) => setStudentId(e.target.value === "" ? "" : Number(e.target.value))}
        disabled={busy !== null}
        aria-label={`Student for event ${eventId}`}
      >
        {candidateId === null && <option value="">Choose a student…</option>}
        {students.map((s) => <option key={s.student_id} value={s.student_id}>{s.roll_no} · {s.name}</option>)}
      </select>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => decide("confirm")} loading={busy === "confirm"} disabled={busy !== null || studentId === ""}>Confirm</Button>
        <Button variant="secondary" size="sm" onClick={() => decide("reject")} loading={busy === "reject"} disabled={busy !== null}>Reject</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
