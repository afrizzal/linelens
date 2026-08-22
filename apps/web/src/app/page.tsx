import { redirect } from "next/navigation";

/**
 * Root route (03-02-PLAN.md deviation, Rule 2: without this the dashboard's
 * "first visible screens" would sit behind the unmodified create-next-app
 * placeholder at "/"). Andon is the money view — send viewers straight
 * there.
 */
export default function RootPage() {
  redirect("/andon");
}
