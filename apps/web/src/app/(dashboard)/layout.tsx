import type { ReactNode } from "react";
import { Nav } from "@/components/ui/nav";
import { TopBar } from "@/components/ui/top-bar";

/**
 * Dashboard shell (03-02-PLAN.md Task 1) — left nav + top bar wrap every
 * page under the (dashboard) route group (andon, oee, and 03-03's timeline).
 * Route group segment is not part of the URL: /andon, /oee, /timeline.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Nav />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
