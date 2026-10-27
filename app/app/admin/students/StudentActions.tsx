"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";

type Dialog = null | "delete" | "signout";

export function StudentActions({ studentId, userId, name, samples }: { studentId: number; userId: number; name: string; samples: number }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState<string | null>(null);

  function openDialog(d: Dialog) {
    setError(null);
    setDialog(d);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (dialog === "delete") {
        const res = await fetch(`/api/admin/students/${studentId}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return setError(json.error ?? "Delete failed");
        setDialog(null);
        router.refresh();
      } else if (dialog === "signout") {
        const res = await fetch(`/api/admin/users/${userId}/signout`, { method: "POST" });
        if (!res.ok) return setError("Could not sign the user out.");
        setDialog(null);
        setSignedOut("Signed out everywhere.");
      }
    } catch {
      setError("The request failed. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link href={`/admin/students/${studentId}/enrol`} className="text-primary underline">{samples > 0 ? "Re-enrol" : "Enrol face"}</Link>
      <Button variant="link" onClick={() => openDialog("signout")}>Sign out everywhere</Button>
      <Button variant="link" className="!text-danger" onClick={() => openDialog("delete")}>Delete</Button>
      {signedOut && <span className="text-xs text-success" role="status">{signedOut}</span>}

      <ConfirmDialog
        open={dialog === "delete"}
        title={`Delete ${name}?`}
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      >
        <p>This removes the student, their login, their stored face samples and any parent login that has no other ward. It is refused if the student has attendance, gate, violation, leave or scan history.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "signout"}
        title={`Sign ${name} out everywhere?`}
        confirmLabel="Sign out everywhere"
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      >
        <p>Every browser this student is signed in on stops working at the next click. They can sign in again with their password.</p>
      </ConfirmDialog>
    </div>
  );
}
