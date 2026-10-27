"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function StudentActions({ studentId, name, samples }: { studentId: number; name: string; samples: number }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Delete failed");
        return;
      }
      dialog.current?.close();
      router.refresh();
    } catch {
      setError("Delete failed. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/admin/students/${studentId}/enrol`} className="underline">{samples > 0 ? "Re-enrol" : "Enrol face"}</Link>
      <button type="button" className="text-red-700 underline dark:text-red-400" onClick={() => { setError(null); dialog.current?.showModal(); }}>Delete</button>
      <dialog ref={dialog} className="max-w-sm rounded-lg p-5 backdrop:bg-black/50" aria-labelledby={`del-${studentId}`}>
        <h2 id={`del-${studentId}`} className="font-semibold">Delete {name}?</h2>
        <p className="mt-2 text-sm">This removes the student, their login, their stored face samples and any parent login that has no other ward. It is refused if the student has attendance, gate, violation, leave or scan history.</p>
        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button type="button" onClick={() => dialog.current?.close()} className="underline">Cancel</button>
          <button type="button" onClick={remove} disabled={busy} className="rounded bg-red-700 px-3 py-1.5 text-white disabled:opacity-40">{busy ? "Deleting…" : "Delete"}</button>
        </div>
      </dialog>
    </div>
  );
}
