import { cx } from "./cx";

/**
 * A label wrapped around one control, for forms rendered by SERVER components (the filter forms).
 * The label is tied to the control by nesting, so no id is needed, and nothing here is a client
 * component or takes a function as a child (that cannot cross the server/client boundary).
 * Forms in client components use FormField, which also supports hints and error messages.
 */
export function Field({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
