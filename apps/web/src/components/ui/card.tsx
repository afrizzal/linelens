import type { ReactNode } from "react";

/**
 * Hand-rolled panel atom (03-02-PLAN.md Task 1: "no component library, keep
 * deps lean"). Every dashboard tile/card wraps this so panel styling
 * (background, border, radius) stays single-sourced.
 */
export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-lg border border-white/10 bg-panel p-4 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
