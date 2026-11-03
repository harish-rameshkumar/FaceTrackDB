"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Sample = { faceProfileId: number; qdrantPointId: string; enrolledAt: string; active: boolean };

// Admin panel: list a student's face samples, deactivate / reactivate one (updates its Qdrant payload)
// or delete one (row and point). Matching ignores deactivated samples.
export function FaceSamples({ studentId, onChanged }: { studentId: number; onChanged: () => void }) {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setError(null);
    const res = await fetch(`/api/admin/students/${studentId}/faces`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error ?? "Could not load the samples");
    setSamples(json.samples);
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }
  async function act(id: number, method: "PATCH" | "DELETE", body?: unknown) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/faces/${id}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "The request failed");
      else {
        await load();
        onChanged();
      }
    } catch {
      setError("The request failed. Check the connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="w-full">
      <Button variant="link" aria-expanded={open} onClick={toggle}>{open ? "Hide face samples" : "Face samples"}</Button>
      {open && (
        <div className="mt-2 rounded-md border border-border p-2 text-xs">
          {error && <p role="alert" className="text-danger">{error}</p>}
          {samples === null ? <p>Loading…</p> : samples.length === 0 ? <p>No face samples.</p> : (
            <ul className="flex flex-col gap-1">
              {samples.map((s) => (
                <li key={s.faceProfileId} className="flex flex-wrap items-center gap-x-3">
                  <span>#{s.faceProfileId} · {s.enrolledAt.slice(0, 16)} · {s.active ? "active" : "deactivated"}</span>
                  <Button variant="link" disabled={busyId === s.faceProfileId} onClick={() => act(s.faceProfileId, "PATCH", { active: !s.active })}>{s.active ? "Deactivate" : "Reactivate"}</Button>
                  <Button variant="link" className="!text-danger" disabled={busyId === s.faceProfileId} onClick={() => act(s.faceProfileId, "DELETE")}>Delete</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
