"use client";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { Notice } from "./Notice";

/**
 * An accessible confirmation dialog built on the native <dialog> element: it traps focus while it
 * is open, closes on Escape, and returns focus to the button that opened it. The caller keeps
 * `open` in state and does the work in `onConfirm`; `error` shows a failure inside the dialog.
 */
export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary", busy = false, error, onConfirm, onCancel }: {
  open: boolean; title: string; children?: React.ReactNode; confirmLabel?: string; cancelLabel?: string;
  tone?: "primary" | "danger"; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const titleId = "confirm-title-" + title.replace(/\W+/g, "-").toLowerCase();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} // Escape
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-border bg-surface p-5 text-fg shadow-xl backdrop:bg-black/50"
    >
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
