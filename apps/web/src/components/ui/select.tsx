import type { ReactNode } from "react";

/**
 * Hand-rolled native <select> wrapper (line/shift pickers, 03-02-PLAN.md
 * Task 1/3) — no component library, keeps deps lean.
 */
export function Select({
  value,
  onChange,
  children,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-white/15 bg-panel px-3 py-1.5 text-sm text-foreground outline-none focus:border-white/30 ${className}`}
    >
      {children}
    </select>
  );
}
