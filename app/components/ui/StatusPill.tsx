import { cx } from "./cx";
import { AlertIcon, CheckIcon, ClockIcon, CrossIcon, DotIcon, InfoIcon } from "./icons";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger-text",
  info: "bg-info-bg text-info-text",
  neutral: "bg-neutral-bg text-neutral-text",
};

// status -> [tone, label, icon]. The meaning is always in the label and the icon, never only in the colour.
const STATUS: Record<string, [Tone, string, typeof CheckIcon]> = {
  pending: ["warning", "Pending", ClockIcon],
  approved: ["success", "Approved", CheckIcon],
  rejected: ["danger", "Rejected", CrossIcon],
  open: ["danger", "Open", AlertIcon],
  resolved: ["success", "Resolved", CheckIcon],
  matched: ["success", "Matched", CheckIcon],
  review: ["warning", "Needs review", AlertIcon],
  low_confidence: ["warning", "Needs review", AlertIcon],
  no_match: ["neutral", "No match", CrossIcon],
  present: ["success", "Present", CheckIcon],
  absent: ["danger", "Absent", CrossIcon],
  present_low: ["warning", "Present (low confidence)", AlertIcon],
  inside: ["success", "Inside", CheckIcon],
  outside: ["info", "Outside", InfoIcon],
  upcoming: ["info", "Upcoming", ClockIcon],
  closed: ["neutral", "Closed", CheckIcon],
  ended: ["warning", "Ended", ClockIcon],
};

/** A small coloured label with an icon and text, for pending/approved/rejected, open/resolved, matched/review/no match and similar states. */
export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  const [tone, text, Icon] = STATUS[status] ?? ["neutral", status, DotIcon];
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label ?? text}
    </span>
  );
}
