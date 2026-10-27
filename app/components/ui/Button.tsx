import Link from "next/link";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "link";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-2",
  danger: "bg-danger text-danger-fg hover:bg-danger-hover border border-transparent",
  ghost: "bg-transparent text-fg border border-transparent hover:bg-surface-2",
  link: "bg-transparent text-primary underline border border-transparent px-0 py-0 min-h-0 hover:text-primary-hover",
};

export function buttonClasses(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    variant !== "link" && (size === "md" ? "min-h-10 px-4 py-2 text-sm" : "min-h-8 px-3 py-1 text-sm"),
    VARIANT[variant],
    extra,
  );
}

type Common = { variant?: Variant; size?: Size; className?: string; children: React.ReactNode };
type AsButton = Common & { href?: undefined; loading?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
type AsLink = Common & { href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">;

/** A button, or a link that looks like one when `href` is given. */
export function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { variant, size, className, children, href, ...rest } = props;
    return <Link href={href} className={buttonClasses(variant, size, className)} {...rest}>{children}</Link>;
  }
  const { variant, size, className, children, loading, disabled, type = "button", ...rest } = props;
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner label="" className="text-current [&>span:last-child]:hidden" />}
      {children}
    </button>
  );
}
