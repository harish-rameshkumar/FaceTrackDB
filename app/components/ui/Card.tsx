import { cx } from "./cx";

/** A bordered panel. Pass `title` for a heading inside the card. */
export function Card({ title, description, actions, children, className, as: Tag = "section" }: {
  title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; as?: "section" | "div" | "article" | "li";
}) {
  return (
    <Tag className={cx("rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}
