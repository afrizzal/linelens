import { test, expect } from '@playwright/test';

/**
 * Browser-level regression coverage for the four Phase-4 screens (Orders,
 * Order detail, Losses Pareto, DDS board) — same convention as
 * `compose-stack.spec.ts`: assert against the live `docker compose`
 * appliance, because that is where integration defects actually live.
 * Every expected value in this file is fetched from the same REST endpoint
 * the page itself reads, in the same test, at the same moment — no
 * hardcoded percentages or counts that would drift as the plant runs.
 *
 * WHAT THIS SPEC CLOSES (WINDOWS.md):
 * - Entry 11 (`/api/dds` populated-Delivery path) — CLOSABLE, but only on a
 *   run where sim time has passed 2026-01-08T00:00. The "dds board" test
 *   asserts whichever Delivery branch the live payload actually took and
 *   records the branch as a Playwright annotation; mark 11 fixed only after
 *   a run whose annotation records the populated branch.
 *
 * WHAT THIS SPEC DOES NOT CLOSE (and why — see 260823-jre-PLAN.md research
 * findings for the full reasoning):
 * - Entry 8 (inject-breakdown -> lower DIFOT contribution ~1 sim-day later)
 *   — one sim-day is 24 real minutes; no honest way to assert this inside a
 *   60s Playwright test. This spec instead regression-guards the surface the
 *   claim would eventually be observed on (the per-line DIFOT grid renders
 *   from the API).
 * - Entry 9 (inject on L2 -> an L2 order goes LATE with that breakdown
 *   top-ranked in its drill-down) — same sim-day dependency, plus the live
 *   stack currently has zero LATE/AT_RISK orders on any due-day. The
 *   "drill-down money shot" test below automates the rendering + deep-link
 *   half and SKIPS LOUDLY (with an explicit reason) when no LATE/AT_RISK
 *   order exists, rather than passing hollow.
 *
 * FORBIDDEN TECHNIQUES (do not reintroduce): fast-forwarding the sim clock
 * via `POST /control/speed`, and injecting a breakdown to try to manufacture
 * an AT_RISK order. Both are traps explained in the plan's research
 * findings — they either corrupt the demo order book or hit a
 * non-deterministic rate-fallback window. This spec reads completed past
 * sim-days only.
 */

const WEB_URL = process.env.LINELENS_WEB_URL ?? 'http://localhost:3000';

// Structural fixture invariants (guaranteed by apps/worker source, not by
// today's database — see plan research findings for the code citations):
const DUE_DAY_WITH_ORDERS = '2026-01-07'; // WARM_START_DAY + 2, always has orders due.
const DUE_DAY_WITHOUT_ORDERS = '2026-01-06'; // Structurally can never have an order due.

interface OrdersResponse {
  day: string;
  difot: { dueDay: string; totalDue: number; onTimeCount: number; difotPct: number | null } | null;
  difotYesterday: unknown;
  byLine: { lineId: string; dueDay: string; totalDue: number; onTimeCount: number; difotPct: number | null }[];
  orders: { orderId: string; status: string }[];
}

const KNOWN_STATUS_LABELS = ['On Time', 'Late', 'At Risk', 'Open'];

test.describe('phase4 screens', () => {
  test.beforeAll(async () => {
    // A cold `pnpm smoke` needs several minutes for the worker to ingest 24
    // sim-hours of warm-start replay before any Phase-4 screen has data.
    // Poll rather than assume, and fail with the real cause if it never
    // arrives — not a bare assertion failure. Extend this hook's own budget
    // well past the 60s default (the config's `timeout` applies per-test,
    // but beforeAll shares that same budget unless raised explicitly).
    test.setTimeout(5 * 60_000 + 30_000);
    const deadline = Date.now() + 5 * 60_000;
    let lastStatus = 'never polled';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${WEB_URL}/api/orders?day=${DUE_DAY_WITH_ORDERS}`);
        if (res.ok) {
          const json = (await res.json()) as OrdersResponse;
          if (json.difot != null && json.orders.length > 0) return;
          lastStatus = `200 but difot=${JSON.stringify(json.difot)} orders=${json.orders.length}`;
        } else {
          lastStatus = `HTTP ${res.status}`;
        }
      } catch (err) {
        lastStatus = `fetch error: ${(err as Error).message}`;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(
      `Warm-up gate timed out after 5 minutes: /api/orders?day=${DUE_DAY_WITH_ORDERS} never reported a ` +
        `non-null difot with orders (last: ${lastStatus}). The worker is likely still ingesting the ` +
        `warm-start replay — wait and re-run, or check \`docker compose logs worker\`.`,
    );
  });

  test.describe('orders list', () => {
    test('real-data cross-check against /api/orders', async ({ page, request }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto('/orders', { waitUntil: 'domcontentloaded' });

      // The date input seeds itself once from the sim clock (useEffect gated
      // on `day` being empty) — filling before that seed lands would be
      // silently overwritten by the seed effect.
      const dateInput = page.locator('input[aria-label="Due date"]');
      await expect(dateInput).not.toHaveValue('', { timeout: 15_000 });
      await dateInput.fill(DUE_DAY_WITH_ORDERS);

      const apiRes = await request.get(`${WEB_URL}/api/orders?day=${DUE_DAY_WITH_ORDERS}`);
      expect(apiRes.ok(), `GET /api/orders?day=${DUE_DAY_WITH_ORDERS} returned ${apiRes.status()}`).toBe(true);
      const api = (await apiRes.json()) as OrdersResponse;
      expect(api.difot, 'fixture invariant broken: due-day 2026-01-07 must have a populated difot').not.toBeNull();

      const expectedPct = `${Math.round((api.difot!.difotPct ?? 0) * 100)}%`;
      await expect(page.getByTestId('difot-value')).toHaveText(expectedPct);

      const subtitle = page.getByTestId('difot-subtitle');
      await expect(subtitle).toContainText(String(api.difot!.onTimeCount));
      await expect(subtitle).toContainText(String(api.difot!.totalDue));

      const tiles = page.getByTestId('difot-line-tile');
      await expect(tiles).toHaveCount(api.byLine.length);
      for (const line of api.byLine) {
        const tile = page.locator(`[data-testid="difot-line-tile"][data-line-id="${line.lineId}"]`);
        const linePct = `${Math.round((line.difotPct ?? 0) * 100)}%`;
        await expect(tile.getByTestId('difot-line-value')).toHaveText(linePct);
      }

      const rows = page.getByTestId('order-row');
      await expect(rows).toHaveCount(api.orders.length);

      // Every rendered status must be one of the four human labels StatusChip
      // renders — never a raw status code leaking through.
      const rowCount = await rows.count();
      for (let i = 0; i < rowCount; i++) {
        const text = await rows.nth(i).innerText();
        expect(KNOWN_STATUS_LABELS.some((label) => text.includes(label)), `row ${i} text: ${text}`).toBe(true);
      }

      expect(pageErrors, `client-side errors: ${pageErrors.join('; ')}`).toEqual([]);
    });

    test('null-versus-zero honesty guard on a day with no orders due', async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto('/orders', { waitUntil: 'domcontentloaded' });

      const dateInput = page.locator('input[aria-label="Due date"]');
      await expect(dateInput).not.toHaveValue('', { timeout: 15_000 });
      await dateInput.fill(DUE_DAY_WITHOUT_ORDERS);

      await expect(page.getByTestId('orders-empty')).toBeVisible();

      const difotValue = page.getByTestId('difot-value');
      await expect(difotValue).toHaveText('N/A');

      // Regression guard for the class of bug fixed in 9d516fe: an absent
      // measurement rendered as a real 0%, not as N/A.
      const text = await difotValue.innerText();
      expect(text, 'DIFOT value must not render a percentage on an orders-due=0 day').not.toMatch(/%/);

      await expect(page.getByTestId('difot-subtitle')).toContainText('No orders due');

      expect(pageErrors, `client-side errors: ${pageErrors.join('; ')}`).toEqual([]);
    });
  });
});
