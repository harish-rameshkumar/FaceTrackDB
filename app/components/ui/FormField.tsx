"use client";
import { useId } from "react";
import { cx } from "./cx";

export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** A label, a control, an optional hint and an error message, wired together for screen readers. */
export function FormField({ label, hint, error, children, className }: {
  label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: (control: ControlProps) => React.ReactNode; className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errorId} className="text-xs font-medium text-danger" role="alert">{error}</p>}
    </div>
  );
}
