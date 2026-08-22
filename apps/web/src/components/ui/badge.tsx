import type { ReactNode } from "react";

export type BadgeVariant = "default" | "warning" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "border-white/15 bg-white/5 text-foreground",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  muted: "border-white/10 bg-white/5 text-foreground/50",
};

/**
 * Hand-rolled pill atom. Used for the `ict_misconfigured` "Check Ideal Cycle
 * Time" domain-literacy badge (03-02-PLAN.md Task 3) and any other small
 * status pill — `title` gives a native tooltip without a component library.
 */
export function Badge({
  children,
  variant = "default",
  title,
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
