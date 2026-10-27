"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function StudentActions({ studentId, userId, name, samples }: { studentId: number; userId: number; name: string; samples: number }) {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState<string | null>(null);

  async function signOutEverywhere() {
    if (!window.confirm(`Sign ${name} out everywhere? Every browser they are signed in on stops working at the next click. They can sign in again.`)) return;
    setSignedOut(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/signout`, { method: "POST" });
      setSignedOut(res.ok ? "Signed out everywhere." : "Could not sign the user out.");
    } catch {
      setSignedOut("Could not sign the user out. Check the connection.");
    }
  }
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
      <button type="button" className="underline" onClick={signOutEverywhere}>Sign out everywhere</button>
      {signedOut && <span className="text-xs" role="status">{signedOut}</span>}
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
