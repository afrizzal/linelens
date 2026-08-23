"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActivityIcon } from "@/components/ui/icons";

interface NavItem {
  href: string;
  label: string;
  disabled?: boolean;
  disabledLabel?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/andon", label: "Andon" },
  { href: "/oee", label: "OEE" },
  { href: "/timeline", label: "Timeline" },
  { href: "/orders", label: "Orders" },
  { href: "/losses", label: "Losses" },
  { href: "/dds", label: "DDS" },
];

/**
 * Left nav (03-02-PLAN.md Task 1). Timeline links to /timeline even though
 * that page is built by the sibling 03-03 plan (parallel_plan_boundary: add
 * the link, do not create the page).
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-white/10 bg-panel p-4">
      <div className="mb-4 flex items-center gap-2 text-foreground">
        <ActivityIcon className="h-5 w-5 text-state-execute" />
        <span className="text-lg font-semibold tracking-tight">LineLens</span>
      </div>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        if (item.disabled) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-foreground/30"
            >
              {item.label}
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {item.disabledLabel}
              </span>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-white/10 font-medium text-foreground"
                : "text-foreground/60 hover:bg-white/5 hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
