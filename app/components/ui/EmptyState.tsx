import { InboxIcon } from "./icons";

/** What a list shows when there is nothing to list, with an optional next step. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <InboxIcon className="text-muted" />
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
