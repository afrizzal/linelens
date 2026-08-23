/**
 * DDS rule-generated content (04-03-PLAN.md Task 2, DDS-01) — deterministic,
 * pure, no LLM/randomness: top-3 actions from yesterday's loss ledger, and
 * the escalation rules. Isolated from the API route (same "pure-core /
 * route-shell" split as lib/oee-waterfall.ts / lib/timeline-data.ts /
 * lib/loss-pareto.ts) so both are unit-testable without a database.
 *
 * PLACEMENT DECISION (04-03-PLAN.md Task 2 "WHERE actions.ts LIVES"): the
 * plan's literal files_modified named apps/worker/src/dds/actions.ts, but
 * apps/worker is not reachable from apps/web (no package.json `exports`
 * field, no build step, not in apps/web's transpilePackages — verified;
 * Phase 3 hit this exact class of Turbopack workspace-resolution failure
 * twice). OPTION A chosen: this pure function lives in the web app
 * (apps/web/src/lib/dds-actions.ts), matching where 03-02/03-03 already put
 * pure logic the web tier consumes. Nothing in this plan needs the worker
 * to generate DDS actions, so OPTION B (promoting to a shared
 * @linelens/contracts subpath) would widen that package's scope for no
 * present benefit. Rule-2 deviation, recorded in 04-03-SUMMARY.md.
 *
 * Deliberately self-contained (no `@linelens/contracts` import) — same
 * dependency discipline as lib/loss-pareto.ts/lib/timeline-data.ts.
 * reasonLabel/lineName are resolved by the CALLER (the API route joins
 * `reason_code` + `line`, the same pattern order_loss_drilldown() and
 * /api/losses already use).
 */

export interface DdsLossInput {
  reasonCode: string;
  category: string;
  reasonLabel: string;
  lineId: string;
  lineName: string;
  lostTimeSec: number;
}

export interface DdsAction {
  rank: number;
  reasonCode: string;
  category: string;
  lineId: string;
  lineName: string;
  lostTimeSec: number;
  action: string;
  owner: string;
}

/**
 * (1) Specific per-reason-code overrides — verbatim per 04-03-PLAN.md Task 2.
 * SL-SPEED and RJ-STARTUP deliberately do NOT interpolate {line} — the
 * plan's template text for those two omits it.
 */
const SPECIFIC_OVERRIDES: Record<string, { action: (line: string) => string; owner: string }> = {
  "BRK-MECH": { action: (line) => `Schedule mechanical inspection on ${line}`, owner: "Maintenance — Pak Andi" },
  "CO-OVERAGE": { action: (line) => `Run changeover SMED review on ${line}`, owner: "Production — Bu Sari" },
  "SS-MISFEED": { action: (line) => `Check feeder alignment on ${line}`, owner: "Operator lead — Pak Budi" },
  "SL-SPEED": { action: () => `Audit rated-speed settings`, owner: "Engineering — Pak Dwi" },
  "RJ-STARTUP": { action: () => `Review warm-up parameters`, owner: "Quality — Bu Rina" },
};

/**
 * (2) Category fallbacks — covers every reason code without a specific
 * override (BRK-ELEC/BRK-SENSOR/SS-MATERIAL/SS-SENSOR/RJ-DIM/RJ-VISUAL/
 * CO-PRODUCT/CO-CLEAN), so EVERY code in @linelens/contracts's REASON_CODES
 * always resolves to an action+owner (see the test's exhaustive-coverage
 * assertion). PLANNED_STOPS's fallback text is fixed (no {reasonLabel}).
 */
const CATEGORY_FALLBACKS: Record<string, { action: (line: string, reasonLabel: string) => string; owner: string }> = {
  UNPLANNED_STOPS: { action: (line, label) => `Investigate ${label} on ${line}`, owner: "Maintenance — Pak Andi" },
  PLANNED_STOPS: { action: (line) => `Review changeover procedure on ${line}`, owner: "Production — Bu Sari" },
  SMALL_STOPS: { action: (line, label) => `Investigate recurring ${label} on ${line}`, owner: "Operator lead — Pak Budi" },
  SLOW_CYCLES: { action: (line) => `Audit line speed on ${line}`, owner: "Engineering — Pak Dwi" },
  STARTUP_REJECTS: { action: (line, label) => `Review ${label} defects on ${line}`, owner: "Quality — Bu Rina" },
  PRODUCTION_REJECTS: { action: (line, label) => `Review ${label} defects on ${line}`, owner: "Quality — Bu Rina" },
};

/** Two-level template resolution: specific override, else category fallback, else a total-map default (defensive — every SixBigLoss category has a fallback above, so this branch should never actually be reached). */
export function resolveReasonAction(input: {
  reasonCode: string;
  category: string;
  reasonLabel: string;
  lineName: string;
}): { action: string; owner: string } {
  const override = SPECIFIC_OVERRIDES[input.reasonCode];
  if (override) return { action: override.action(input.lineName), owner: override.owner };

  const fallback = CATEGORY_FALLBACKS[input.category];
  if (fallback) return { action: fallback.action(input.lineName, input.reasonLabel), owner: fallback.owner };

  return { action: `Investigate ${input.reasonLabel} on ${input.lineName}`, owner: "Production — Bu Sari" };
}

/**
 * Deterministic top-N (default 3) rule-generated actions. Groups yesterday's
 * loss ledger by (reasonCode, lineId) — a reason can recur on multiple
 * lines, and the action text names a specific line, so each (reason, line)
 * combo is its own candidate — sums lostTimeSec per combo, ranks descending
 * (tie-broken by reasonCode then lineId for determinism), and resolves each
 * of the top N through the template map.
 */
export function generateDdsActions(rows: DdsLossInput[], topN = 3): DdsAction[] {
  const byCombo = new Map<string, DdsLossInput>();
  for (const row of rows) {
    const key = `${row.reasonCode}::${row.lineId}`;
    const existing = byCombo.get(key);
    if (existing) {
      existing.lostTimeSec += row.lostTimeSec;
    } else {
      byCombo.set(key, { ...row });
    }
  }

  const sorted = Array.from(byCombo.values()).sort(
    (a, b) => b.lostTimeSec - a.lostTimeSec || a.reasonCode.localeCompare(b.reasonCode) || a.lineId.localeCompare(b.lineId),
  );

  return sorted.slice(0, topN).map((row, i) => {
    const { action, owner } = resolveReasonAction(row);
    return {
      rank: i + 1,
      reasonCode: row.reasonCode,
      category: row.category,
      lineId: row.lineId,
      lineName: row.lineName,
      lostTimeSec: row.lostTimeSec,
      action,
      owner,
    };
  });
}

export interface DdsEscalationLossInput {
  lineId: string;
  lineName: string;
  reasonCode: string;
  reasonLabel: string;
  /** A SINGLE loss_event row's duration — NOT pre-summed across events (the threshold is "any single loss"). */
  lostTimeSec: number;
}

export interface DdsDifotLineInput {
  lineId: string;
  lineName: string;
  /** 0-1, or null when the line had zero orders due yesterday (N/A, not a false 0%). */
  difotPct: number | null;
}

export interface DdsEscalation {
  lineId: string;
  lineName: string;
  reason: string;
  metric: string;
}

/** 45 sim-minutes, per 04-03-PLAN.md Task 2's escalation rule (docs/00-domain-research.md §8.2: no normative minute threshold exists — this is a project-configured policy number, same discipline as the Six Big Losses reason-code taxonomy, never a hardcoded classification cutoff). */
export const ESCALATION_LOSS_THRESHOLD_SEC = 45 * 60;
export const ESCALATION_DIFOT_THRESHOLD = 0.8;

/**
 * Deterministic escalation list: any SINGLE loss_event >= 45 sim-min, OR any
 * line's yesterday DIFOT% < 80% (v_difot_line) -> an escalation item. Empty
 * array means "No escalations" (rendered by the page, not this function).
 */
export function deriveEscalations(losses: DdsEscalationLossInput[], difotByLine: DdsDifotLineInput[]): DdsEscalation[] {
  const escalations: DdsEscalation[] = [];

  for (const loss of losses) {
    if (loss.lostTimeSec >= ESCALATION_LOSS_THRESHOLD_SEC) {
      const min = Math.round(loss.lostTimeSec / 60);
      escalations.push({
        lineId: loss.lineId,
        lineName: loss.lineName,
        reason: `${loss.reasonLabel} — single loss ${min} min`,
        metric: `${min} min`,
      });
    }
  }

  for (const line of difotByLine) {
    if (line.difotPct != null && line.difotPct < ESCALATION_DIFOT_THRESHOLD) {
      escalations.push({
        lineId: line.lineId,
        lineName: line.lineName,
        reason: "DIFOT below target",
        metric: `${Math.round(line.difotPct * 100)}%`,
      });
    }
  }

  return escalations;
}
