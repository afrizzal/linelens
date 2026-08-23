import { test, expect } from '@playwright/test';

/**
 * WINDOWS 3 + 4 regression guard.
 *
 * Shifts cover only S1 07:00-15:00 and S2 15:00-23:00, so sim 23:00-07:00 —
 * a THIRD of every sim-day — has no active shift. The OEE and Timeline pages
 * used to fall back to "sim today + S1", which has zero production, so the
 * whole page rendered N/A. The N/A itself is correct (project rule: N/A, never
 * a false 0); landing there BY DEFAULT is the defect.
 *
 * The assertion is deliberately phrased so it holds at ANY sim hour rather
 * than only inside the 8-hour window that used to break: whatever shift the
 * page defaults to, that shift must actually have data. A test that only ran
 * between shifts would pass hollowly two-thirds of the time — the same trap
 * WINDOWS 13 documented for the drill-down money shot.
 */

const WEB_URL = process.env.LINELENS_WEB_URL ?? 'http://localhost:3000';

interface AndonLine {
  lineId: string;
  shiftDate: string | null;
  shiftId: string | null;
  lastShiftDate: string | null;
  lastShiftId: string | null;
}

interface OeeResponse {
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
}

test.describe('dashboard shift defaults', () => {
  test('/api/andon always offers a last-shift-with-data fallback', async ({ request }) => {
    const res = await request.get(`${WEB_URL}/api/andon`);
    expect(res.ok()).toBe(true);
    const lines = (await res.json()) as AndonLine[];
    expect(lines.length, 'plant must have lines').toBeGreaterThan(0);

    for (const line of lines) {
      expect(
        line.lastShiftId,
        `line ${line.lineId} must expose a lastShiftId so the dashboard never has to default to an empty shift`,
      ).not.toBeNull();
      expect(line.lastShiftDate, `line ${line.lineId} must expose a lastShiftDate`).not.toBeNull();
    }
  });

  test('the shift the dashboard defaults to actually has OEE data', async ({ request }) => {
    const andon = (await (await request.get(`${WEB_URL}/api/andon`)).json()) as AndonLine[];
    const active = andon.find((l) => l.shiftDate && l.shiftId);

    for (const line of andon) {
      // Mirrors the page's precedence exactly: active shift -> this line's
      // last shift with data.
      const target = active
        ? { date: active.shiftDate!, id: active.shiftId! }
        : { date: line.lastShiftDate!, id: line.lastShiftId! };

      const oee = (await (
        await request.get(
          `${WEB_URL}/api/oee?lineId=${line.lineId}&shiftDate=${target.date}&shiftId=${target.id}`,
        )
      ).json()) as OeeResponse;

      expect(
        oee.availability,
        `line ${line.lineId} default shift ${target.date}/${target.id} renders N/A — the dashboard would open blank`,
      ).not.toBeNull();
    }
  });

  test('a timeline deep link still overrides the andon default (CR-01)', async ({ page, request }) => {
    const andon = (await (await request.get(`${WEB_URL}/api/andon`)).json()) as AndonLine[];
    const line = andon[0];
    const shiftDate = line.lastShiftDate ?? line.shiftDate;
    expect(shiftDate, 'need some shift with data to build a deep link').not.toBeNull();

    // Deliberately pick the shift the andon default would NOT choose, so a
    // regression that lets the andon effect win is visible.
    const active = andon.find((l) => l.shiftDate && l.shiftId);
    const defaultShift = active?.shiftId ?? line.lastShiftId;
    const deepLinkShift = defaultShift === 'S1' ? 'S2' : 'S1';

    await page.goto(
      `/timeline?lineId=${line.lineId}&shiftDate=${shiftDate}&shiftId=${deepLinkShift}`,
      { waitUntil: 'domcontentloaded' },
    );

    const shiftSelect = page.locator('select[aria-label="Shift"]');
    await expect(shiftSelect).toHaveValue(deepLinkShift);
  });
});
