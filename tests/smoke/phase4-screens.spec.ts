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
const LOSS_DAY = '2026-01-05'; // Fully-replayed warm-start day, losses on every line.

interface OrdersResponse {
  day: string;
  difot: { dueDay: string; totalDue: number; onTimeCount: number; difotPct: number | null } | null;
  difotYesterday: unknown;
  byLine: { lineId: string; dueDay: string; totalDue: number; onTimeCount: number; difotPct: number | null }[];
  orders: { orderId: string; status: string }[];
}

const KNOWN_STATUS_LABELS = ['On Time', 'Late', 'At Risk', 'Open'];
const STATUS_LABEL: Record<string, string> = {
  ON_TIME: 'On Time',
  LATE: 'Late',
  AT_RISK: 'At Risk',
  OPEN: 'Open',
};

interface OrderDetailResponse {
  order: { orderId: string; customer: string; productId: string; qtyOrdered: number; allocatedQty: number; status: string };
  allocations: { id: string }[];
  losses: { estLostUnits: number | null; lineId: string; lineName: string; shiftDate: string | null; shiftId: string | null }[];
}

interface LossParetoRowLike {
  reasonCode: string;
  category: string;
  reasonLabel: string;
  shiftId: string;
  lostTimeSec: number;
  lostUnits: number | null;
}

interface LossesResponse {
  lineId: string;
  day: string;
  rows: LossParetoRowLike[];
}

const CATEGORY_LABEL_VOCAB = [
  'Unplanned Stop',
  'Planned Stop',
  'Small Stop',
  'Slow Cycle',
  'Startup Reject',
  'Production Reject',
];

// Due-days a `/api/orders?day=` scan checks for a LATE/AT_RISK order, given
// the fixture invariants (WARM_START_DAY + 2 = 2026-01-07 is the earliest
// possible due-day) and the current sim day at plan time (2026-01-07). This
// window is deliberately small — a full calendar scan is unnecessary and
// would each require its own worker-ingestion wait.
const CANDIDATE_DUE_DAYS = ['2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10'];

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

  test('order drill-down navigates and cross-checks against /api/orders/{id}', async ({ page, request }) => {
    test.slow(); // a completed warm-start order can carry thousands of allocations to render

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/orders', { waitUntil: 'domcontentloaded' });
    const dateInput = page.locator('input[aria-label="Due date"]');
    await expect(dateInput).not.toHaveValue('', { timeout: 15_000 });
    await dateInput.fill(DUE_DAY_WITH_ORDERS);

    const listApi = await request.get(`${WEB_URL}/api/orders?day=${DUE_DAY_WITH_ORDERS}`);
    const listJson = (await listApi.json()) as OrdersResponse;
    expect(listJson.orders.length, 'fixture invariant broken: due-day 2026-01-07 must have orders').toBeGreaterThan(0);
    const target = listJson.orders[0];

    const row = page.locator(`[data-testid="order-row"][data-order-id="${target.orderId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/orders/${target.orderId}$`));

    const detailApi = await request.get(`${WEB_URL}/api/orders/${target.orderId}`);
    expect(detailApi.ok(), `GET /api/orders/${target.orderId} returned ${detailApi.status()}`).toBe(true);
    const detail = (await detailApi.json()) as OrderDetailResponse;

    await expect(page.getByTestId('order-customer')).toHaveText(detail.order.customer);
    await expect(page.getByTestId('order-product')).toHaveText(detail.order.productId);
    await expect(page.getByTestId('order-qty')).toHaveText(`${detail.order.allocatedQty}/${detail.order.qtyOrdered}`);
    await expect(page.getByTestId('order-status')).toContainText(STATUS_LABEL[detail.order.status] ?? detail.order.status);

    const allocationRows = page.getByTestId('allocation-row');
    await expect(allocationRows).toHaveCount(detail.allocations.length);

    if (detail.order.status === 'ON_TIME') {
      // Documented UI rendering rule, not an accident: the ranked loss list
      // is reserved for LATE/AT_RISK orders — assert its absence for ON_TIME.
      await expect(page.getByTestId('order-headline')).toBeVisible();
      await expect(page.getByTestId('loss-list')).toHaveCount(0);
    }

    expect(pageErrors, `client-side errors: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('drill-down money shot: ranked loss list, deep-link to timeline (skips loudly if no LATE/AT_RISK order exists)', async ({
    page,
    request,
  }) => {
    let target: { orderId: string; status: string } | null = null;
    for (const day of CANDIDATE_DUE_DAYS) {
      const res = await request.get(`${WEB_URL}/api/orders?day=${day}`);
      if (!res.ok()) continue;
      const json = (await res.json()) as OrdersResponse;
      const found = json.orders.find((o) => o.status === 'LATE' || o.status === 'AT_RISK');
      if (found) {
        target = found;
        break;
      }
    }

    test.skip(
      target === null,
      `No LATE or AT_RISK order exists on any of ${CANDIDATE_DUE_DAYS.join(', ')} on the live stack right now — ` +
        'the ranked-loss/deep-link path was NOT exercised by this run. WINDOWS entry 9 remains open; this is the ' +
        'honest outcome, not a soft pass.',
    );
    if (!target) return;

    const pageErrors: string[] = [];
    const detailApi = await request.get(`${WEB_URL}/api/orders/${target.orderId}`);
    const detail = (await detailApi.json()) as OrderDetailResponse;
    expect(detail.losses.length, 'a LATE/AT_RISK order must have at least one ranked loss to make this test meaningful').toBeGreaterThan(0);

    await page.goto(`/orders/${target.orderId}`, { waitUntil: 'domcontentloaded' });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await expect(page.getByTestId('order-headline')).toBeVisible();
    const top = detail.losses[0];
    // The headline names the top loss's line — proves the headline is wired
    // to the SAME ranked list the loss-row elements below render.
    await expect(page.getByTestId('order-headline')).toContainText(top.lineName);

    const lossRows = page.getByTestId('loss-row');
    const count = await lossRows.count();
    const estUnits: number[] = [];
    for (let i = 0; i < count; i++) {
      estUnits.push(Number(await lossRows.nth(i).getAttribute('data-est-units')));
    }
    for (let i = 1; i < estUnits.length; i++) {
      expect(estUnits[i], `loss row ${i} (${estUnits[i]}) must not exceed row ${i - 1} (${estUnits[i - 1]})`).toBeLessThanOrEqual(
        estUnits[i - 1],
      );
    }

    const firstHref = await lossRows.first().getAttribute('href');
    expect(firstHref).toContain('lineId=');
    expect(firstHref).toContain('highlightStart=');
    expect(firstHref).toContain('highlightEnd=');

    await lossRows.first().click();
    await expect(page).toHaveURL(/\/timeline\?/);
    const url = page.url();
    expect(url).toContain('lineId=');
    expect(url).toContain('highlightStart=');
    expect(url).toContain('highlightEnd=');

    // Regression guard for 04-REVIEW.md CR-01: the URL containing
    // `shiftId=` is not sufficient — the mount-time /api/andon effect used
    // to silently overwrite an explicit `shiftId=S1` deep link back to
    // whatever shift is "currently active" (S1 collided with its own
    // unset-default sentinel). Assert the rendered shift picker actually
    // converged on the deep-linked shift, not just that the URL carries it.
    // `shiftId` is schema-nullable on loss_event, so only assert convergence
    // when the top-ranked loss actually carries one (deepLinkHref omits the
    // param entirely otherwise, and there is nothing to converge on).
    const linkedShiftId = new URL(url).searchParams.get('shiftId');
    expect(linkedShiftId, 'deep-link href shiftId must round-trip through the URL unchanged').toBe(top.shiftId);
    if (linkedShiftId) {
      const shiftSelect = page.locator('select[aria-label="Shift"]');
      await expect(shiftSelect).toHaveValue(linkedShiftId);
    }

    expect(pageErrors, `client-side errors on /timeline: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('losses pareto renders API-matching buckets, cumulative line, and category toggle', async ({ page, request }) => {
    await page.goto('/losses', { waitUntil: 'domcontentloaded' });

    const lineSelect = page.locator('select[aria-label="Line"]');
    await expect(async () => {
      const optionCount = await lineSelect.locator('option').count();
      expect(optionCount).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    const lineId = await lineSelect.inputValue();
    expect(lineId).not.toBe('');

    const dayInput = page.locator('input[aria-label="Sim day"]');
    await dayInput.fill(LOSS_DAY);

    const apiRes = await request.get(`${WEB_URL}/api/losses?lineId=${lineId}&day=${LOSS_DAY}`);
    expect(apiRes.ok(), `GET /api/losses?lineId=${lineId}&day=${LOSS_DAY} returned ${apiRes.status()}`).toBe(true);
    const api = (await apiRes.json()) as LossesResponse;
    expect(api.rows.length, `fixture invariant broken: line ${lineId} must have losses on ${LOSS_DAY}`).toBeGreaterThan(0);

    await expect(page.getByTestId('losses-empty')).toHaveCount(0);
    const chartCanvas = page.locator('[data-testid="pareto-chart"] canvas');
    await expect(chartCanvas).toBeVisible();
    const box = await chartCanvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);

    const distinctReasons = new Set(api.rows.map((r) => r.reasonCode));
    const paretoRows = page.getByTestId('pareto-row');
    await expect(paretoRows).toHaveCount(distinctReasons.size);

    const rowCount = await paretoRows.count();
    const minutes: number[] = [];
    const cumulative: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      minutes.push(Number(await paretoRows.nth(i).getAttribute('data-minutes')));
      cumulative.push(Number(await paretoRows.nth(i).getAttribute('data-cumulative')));
    }
    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i]).toBeLessThanOrEqual(minutes[i - 1]);
      expect(cumulative[i]).toBeGreaterThanOrEqual(cumulative[i - 1]);
    }
    expect(cumulative[cumulative.length - 1]).toBeGreaterThan(99);
    expect(cumulative[cumulative.length - 1]).toBeLessThanOrEqual(100.5);

    const apiTotalMin = api.rows.reduce((sum, r) => sum + r.lostTimeSec, 0) / 60;
    const tableTotalMin = minutes.reduce((a, b) => a + b, 0);
    expect(Math.abs(tableTotalMin - apiTotalMin)).toBeLessThan(0.5);

    // Toggle to "by category" — must move real data, not just button styling.
    const distinctCategories = new Set(api.rows.map((r) => r.category));
    await page.getByRole('button', { name: 'By category' }).click();
    await expect(paretoRows).toHaveCount(distinctCategories.size, { timeout: 5_000 });

    const categoryRowCount = await paretoRows.count();
    const categoryMinutes: number[] = [];
    for (let i = 0; i < categoryRowCount; i++) {
      const visibleLabel = (await paretoRows.nth(i).locator('td').first().innerText()).trim();
      expect(CATEGORY_LABEL_VOCAB, `row ${i} visible label "${visibleLabel}" not in the six-category vocabulary`).toContain(
        visibleLabel,
      );
      categoryMinutes.push(Number(await paretoRows.nth(i).getAttribute('data-minutes')));
    }
    const categoryTotalMin = categoryMinutes.reduce((a, b) => a + b, 0);
    expect(Math.abs(categoryTotalMin - apiTotalMin)).toBeLessThan(0.5);
  });

  test('dds board resolves yesterday correctly and cross-checks every tile against /api/dds', async ({ page, request }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/dds', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dds-day')).toBeVisible({ timeout: 15_000 });

    let dayText = await page.getByTestId('dds-day').innerText();
    let uiDay = dayText.replace('Yesterday: ', '').trim();

    let apiRes = await request.get(`${WEB_URL}/api/dds`);
    expect(apiRes.ok(), `GET /api/dds returned ${apiRes.status()}`).toBe(true);
    let dds = (await apiRes.json()) as DdsResponse;

    // The board's yesterday rolls over every 24 real minutes (sim day
    // boundary) — a single retry covers the test straddling that boundary
    // between the page load and the API fetch above.
    if (dds.day !== uiDay) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('dds-day')).toBeVisible({ timeout: 15_000 });
      dayText = await page.getByTestId('dds-day').innerText();
      uiDay = dayText.replace('Yesterday: ', '').trim();
      apiRes = await request.get(`${WEB_URL}/api/dds`);
      dds = (await apiRes.json()) as DdsResponse;
    }
    expect(dds.day, 'UI-displayed day and freshly-fetched API day did not converge after one retry').toBe(uiDay);

    // Prove the route's yesterday resolution against an independent read of
    // the sim clock, rather than assuming the route computed it correctly.
    const clockRes = await request.get(`${WEB_URL}/api/sim-clock`);
    const clock = (await clockRes.json()) as { simNow: string };
    const simNow = new Date(clock.simNow);
    const expectedYesterday = new Date(Date.UTC(simNow.getUTCFullYear(), simNow.getUTCMonth(), simNow.getUTCDate() - 1));
    const expectedYesterdayStr = expectedYesterday.toISOString().slice(0, 10);
    expect(dds.day).toBe(expectedYesterdayStr);

    await expect(page.getByTestId('dds-safety-value')).toHaveText(String(dds.safety.daysSinceIncident));

    const qualityPctText = dds.quality.qualityPct == null ? 'N/A' : `${Math.round(dds.quality.qualityPct * 100)}%`;
    await expect(page.getByTestId('dds-quality-value')).toHaveText(qualityPctText);
    await expect(page.getByTestId('dds-quality-sub')).toContainText(
      dds.quality.totalRejects == null ? 'N/A' : String(dds.quality.totalRejects),
    );

    const oeePctText = dds.oee.oee == null ? 'N/A' : `${Math.round(dds.oee.oee * 100)}%`;
    await expect(page.getByTestId('dds-oee-value')).toHaveText(oeePctText);

    if (dds.topLoss) {
      await expect(page.getByTestId('dds-top-loss')).toBeVisible();
      await expect(page.getByTestId('dds-top-loss')).toContainText(dds.topLoss.reasonLabel);
      await expect(page.getByTestId('dds-top-loss')).toContainText(dds.topLoss.lineName);
      await expect(page.getByTestId('dds-top-loss')).toContainText(String(Math.round(dds.topLoss.lostTimeMin)));
    } else {
      await expect(page.getByTestId('dds-top-loss-empty')).toBeVisible();
    }

    const actionRows = page.getByTestId('dds-action-row');
    await expect(actionRows).toHaveCount(dds.actions.length);
    const actionCount = await actionRows.count();
    for (let i = 0; i < actionCount; i++) {
      await expect(actionRows.nth(i)).toContainText(dds.actions[i].owner);
    }

    if (dds.escalations.length > 0) {
      const escalationRows = page.getByTestId('dds-escalation-row');
      await expect(escalationRows).toHaveCount(dds.escalations.length);
    } else {
      await expect(page.getByTestId('dds-no-escalations')).toBeVisible();
    }

    // Delivery is an explicit two-branch assertion. The annotation is what
    // makes a green run auditable — without it nobody can tell from the
    // report which branch was exercised, and a green suite could be
    // mistaken for coverage of the populated-Delivery path when it in fact
    // only ever exercised the empty one (WINDOWS entry 11).
    if (dds.delivery.difotPct == null) {
      await expect(page.getByTestId('dds-delivery-value')).toHaveText('N/A');
      const sub = await page.getByTestId('dds-delivery-sub').innerText();
      expect(sub, 'delivery sub-line must not show a numeric late-order count when difotPct is null').not.toMatch(/\d/);
      testInfo.annotations.push({ type: 'dds-delivery-branch', description: 'empty (difotPct null)' });
    } else {
      const expectedPct = `${Math.round(dds.delivery.difotPct * 100)}%`;
      await expect(page.getByTestId('dds-delivery-value')).toHaveText(expectedPct);
      await expect(page.getByTestId('dds-delivery-sub')).toContainText(String(dds.delivery.lateCount));

      // Independent second read-path over the same underlying view.
      const ordersRes = await request.get(`${WEB_URL}/api/orders?day=${dds.day}`);
      const ordersJson = (await ordersRes.json()) as OrdersResponse;
      expect(ordersJson.difot, `/api/orders?day=${dds.day} must have a populated difot to cross-check /api/dds`).not.toBeNull();
      expect(Math.round((ordersJson.difot!.difotPct ?? 0) * 100)).toBe(Math.round(dds.delivery.difotPct * 100));

      testInfo.annotations.push({ type: 'dds-delivery-branch', description: 'populated (difotPct non-null)' });
    }

    expect(pageErrors, `client-side errors: ${pageErrors.join('; ')}`).toEqual([]);
  });
});

interface DdsResponse {
  day: string;
  safety: { daysSinceIncident: number; synthetic: boolean };
  quality: { qualityPct: number | null; totalRejects: number | null };
  delivery: { difotPct: number | null; onTimeCount: number | null; totalDue: number | null; lateCount: number | null };
  oee: { oee: number | null; delta: number | null };
  topLoss: { lineId: string; lineName: string; category: string; reasonCode: string; reasonLabel: string; lostTimeMin: number } | null;
  actions: { rank: number; reasonCode: string; category: string; lineId: string; lineName: string; lostTimeSec: number; action: string; owner: string }[];
  escalations: { lineId: string; lineName: string; reason: string; metric: string }[];
}
