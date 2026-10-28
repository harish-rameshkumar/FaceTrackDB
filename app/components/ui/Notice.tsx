import { cx } from "./cx";
import { AlertIcon, CheckIcon, InfoIcon } from "./icons";

type Tone = "info" | "success" | "warning" | "danger";
const TONE: Record<Tone, string> = {
  info: "border-info bg-info-bg text-info-text",
  success: "border-success bg-success-bg text-success-text",
  warning: "border-warning bg-warning-bg text-warning-text",
  danger: "border-danger bg-danger-bg text-danger-text",
};
const ICON = { info: InfoIcon, success: CheckIcon, warning: AlertIcon, danger: AlertIcon };

/** A message box. Errors are announced at once (role alert); the others politely (role status). */
export function Notice({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: React.ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-md border-l-4 px-3 py-2.5 text-sm", TONE[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
