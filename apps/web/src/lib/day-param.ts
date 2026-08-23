/**
 * Calendar-validity parser for the `day` query param on `/api/orders`
 * (T-04, .planning/phases/04-difot-pareto-dds/04-SECURITY.md). Closes two
 * distinct failure classes -- both live-confirmed pre-fix, both satisfying
 * the route's old `^\d{4}-\d{2}-\d{2}$` shape regex alone:
 *
 *   - ROLLOVER class ("2026-02-30"): `new Date(...)` silently rolls
 *     forward to Mar 2 -- reaches SQL, Postgres rejects the `::date` cast
 *     with error 22008.
 *   - INVALID-DATE class ("2026-99-99"): produces an Invalid Date, and
 *     calling `.toISOString()` on it throws `RangeError: Invalid time
 *     value` BEFORE any SQL runs.
 *
 * Pure, DB-free module (no `@/lib/db`, no Prisma, no I/O) -- kept testable
 * by relative import under the existing vitest setup, same "pure-core /
 * component-shell" split as lib/order-headline.ts.
 *
 * Step ordering below is load-bearing: the NaN guard (step 3) MUST run
 * BEFORE the round-trip guard's `toISOString()` call (step 4) -- that
 * ordering is the entire fix for the Invalid-Date class, since calling
 * `toISOString()` on an Invalid Date is exactly what threw `RangeError`
 * pre-fix. Do not reorder.
 *
 * The round-trip check produces no false rejections inside the regex's
 * 4-digit-year domain: `toISOString()` zero-pads years below 1000, so
 * e.g. "0999-01-01" round-trips cleanly.
 */

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedDayParam {
  /** The validated, unchanged input string. */
  day: string;
  /** day - 1 calendar day, derived from the same validated Date instant. */
  yesterday: string;
}

export function parseDayParam(day: string | null): ParsedDayParam | null {
  // 1. Null/shape guard -- identical regex to the one it replaces at
  //    route.ts:51, so the shape contract does not change.
  if (!day || !DAY_SHAPE.test(day)) {
    return null;
  }

  // 2. Parse.
  const parsed = new Date(`${day}T00:00:00.000Z`);

  // 3. NaN guard, BEFORE any toISOString() call -- closes the
  //    Invalid-Date class.
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // 4. Round-trip guard -- closes the silent-rollover class.
  if (parsed.toISOString().slice(0, 10) !== day) {
    return null;
  }

  // 5. Derive yesterday from the SAME validated instant, so `day` and
  //    `yesterday` are structurally incapable of disagreeing.
  const yesterday = new Date(parsed.getTime());
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  return { day, yesterday: yesterday.toISOString().slice(0, 10) };
}
