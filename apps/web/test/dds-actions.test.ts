import { describe, expect, it } from "vitest";
import {
  deriveEscalations,
  ESCALATION_DIFOT_THRESHOLD,
  ESCALATION_LOSS_THRESHOLD_SEC,
  generateDdsActions,
  resolveReasonAction,
  type DdsDifotLineInput,
  type DdsEscalationLossInput,
  type DdsLossInput,
} from "../src/lib/dds-actions";

/**
 * Verbatim copy of packages/contracts/src/reasons.ts's REASON_CODES
 * (code + category only — this test deliberately does NOT import
 * @linelens/contracts, matching lib/dds-actions.ts's own self-contained
 * discipline, same reasoning as lib/timeline-data.ts). Kept in sync by
 * hand; if a reason code is ever added/removed there, mirror it here.
 */
const ALL_REASON_CODES: Array<{ code: string; category: string }> = [
  { code: "BRK-MECH", category: "UNPLANNED_STOPS" },
  { code: "BRK-ELEC", category: "UNPLANNED_STOPS" },
  { code: "BRK-SENSOR", category: "UNPLANNED_STOPS" },
  { code: "CO-OVERAGE", category: "UNPLANNED_STOPS" },
  { code: "CO-PRODUCT", category: "PLANNED_STOPS" },
  { code: "CO-CLEAN", category: "PLANNED_STOPS" },
  { code: "SS-MISFEED", category: "SMALL_STOPS" },
  { code: "SS-MATERIAL", category: "SMALL_STOPS" },
  { code: "SS-SENSOR", category: "SMALL_STOPS" },
  { code: "SL-SPEED", category: "SLOW_CYCLES" },
  { code: "RJ-STARTUP", category: "STARTUP_REJECTS" },
  { code: "RJ-DIM", category: "PRODUCTION_REJECTS" },
  { code: "RJ-VISUAL", category: "PRODUCTION_REJECTS" },
];

describe("resolveReasonAction", () => {
  it("resolves EVERY reason code in the contracts taxonomy to a non-empty action + owner", () => {
    for (const { code, category } of ALL_REASON_CODES) {
      const { action, owner } = resolveReasonAction({
        reasonCode: code,
        category,
        reasonLabel: `${code} label`,
        lineName: "Line 2",
      });
      expect(action.length).toBeGreaterThan(0);
      expect(owner.length).toBeGreaterThan(0);
    }
  });

  it("uses the SPECIFIC override for BRK-MECH, not the UNPLANNED_STOPS category fallback", () => {
    const { action, owner } = resolveReasonAction({
      reasonCode: "BRK-MECH",
      category: "UNPLANNED_STOPS",
      reasonLabel: "Mechanical jam",
      lineName: "Line 2",
    });
    expect(action).toBe("Schedule mechanical inspection on Line 2");
    expect(owner).toBe("Maintenance — Pak Andi");
  });

  it("falls back to the category template for a reason code with no specific override (BRK-ELEC)", () => {
    const { action, owner } = resolveReasonAction({
      reasonCode: "BRK-ELEC",
      category: "UNPLANNED_STOPS",
      reasonLabel: "Electrical fault",
      lineName: "Line 3",
    });
    expect(action).toBe("Investigate Electrical fault on Line 3");
    expect(owner).toBe("Maintenance — Pak Andi");
  });

  it("SL-SPEED and RJ-STARTUP overrides omit the {line} suffix, per the verbatim plan template", () => {
    expect(
      resolveReasonAction({ reasonCode: "SL-SPEED", category: "SLOW_CYCLES", reasonLabel: "x", lineName: "Line 1" })
        .action,
    ).toBe("Audit rated-speed settings");
    expect(
      resolveReasonAction({ reasonCode: "RJ-STARTUP", category: "STARTUP_REJECTS", reasonLabel: "x", lineName: "Line 1" })
        .action,
    ).toBe("Review warm-up parameters");
  });
});

describe("generateDdsActions", () => {
  const FIXTURE: DdsLossInput[] = [
    { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", lineId: "L2", lineName: "Line 2", lostTimeSec: 3600 },
    { reasonCode: "CO-PRODUCT", category: "PLANNED_STOPS", reasonLabel: "Product changeover", lineId: "L1", lineName: "Line 1", lostTimeSec: 1800 },
    { reasonCode: "RJ-DIM", category: "PRODUCTION_REJECTS", reasonLabel: "Dimensional defect", lineId: "L3", lineName: "Line 3", lostTimeSec: 1200 },
    { reasonCode: "SL-SPEED", category: "SLOW_CYCLES", reasonLabel: "Running below rated speed", lineId: "L1", lineName: "Line 1", lostTimeSec: 600 },
  ];

  it("returns exactly 3 actions in descending lost-time order with mapped owners", () => {
    const actions = generateDdsActions(FIXTURE, 3);
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.reasonCode)).toEqual(["BRK-MECH", "CO-PRODUCT", "RJ-DIM"]);
    expect(actions.map((a) => a.rank)).toEqual([1, 2, 3]);
    expect(actions[0]).toMatchObject({
      action: "Schedule mechanical inspection on Line 2",
      owner: "Maintenance — Pak Andi",
    });
    expect(actions[1]).toMatchObject({
      action: "Review changeover procedure on Line 1",
      owner: "Production — Bu Sari",
    });
    expect(actions[2]).toMatchObject({
      action: "Review Dimensional defect defects on Line 3",
      owner: "Quality — Bu Rina",
    });
  });

  it("sums lostTimeSec across duplicate (reasonCode, lineId) rows (e.g. two shifts) before ranking", () => {
    const rows: DdsLossInput[] = [
      // Two rows for the same (reasonCode, lineId) combo simulate S1 + S2 rows from v_loss_pareto.
      { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", lineId: "L2", lineName: "Line 2", lostTimeSec: 900 },
      { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", lineId: "L2", lineName: "Line 2", lostTimeSec: 800 },
      { reasonCode: "CO-PRODUCT", category: "PLANNED_STOPS", reasonLabel: "Product changeover", lineId: "L1", lineName: "Line 1", lostTimeSec: 1000 },
    ];
    const actions = generateDdsActions(rows, 3);
    const brkMech = actions.find((a) => a.reasonCode === "BRK-MECH")!;
    expect(brkMech.lostTimeSec).toBe(1700); // 900 + 800, summed before ranking above CO-PRODUCT's 1000
    expect(actions[0].reasonCode).toBe("BRK-MECH");
  });

  it("the SAME (reasonCode, lineId) combo on two different lines produces two independent actions", () => {
    const rows: DdsLossInput[] = [
      { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", lineId: "L2", lineName: "Line 2", lostTimeSec: 2000 },
      { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", lineId: "L3", lineName: "Line 3", lostTimeSec: 1500 },
    ];
    const actions = generateDdsActions(rows, 3);
    expect(actions).toHaveLength(2);
    expect(actions[0].lineName).toBe("Line 2");
    expect(actions[1].lineName).toBe("Line 3");
  });

  it("is deterministic — two runs on the same input produce identical output", () => {
    const run1 = generateDdsActions(FIXTURE, 3);
    const run2 = generateDdsActions(FIXTURE, 3);
    expect(run1).toEqual(run2);
  });

  it("returns fewer than N actions when fewer than N distinct combos exist", () => {
    const actions = generateDdsActions(FIXTURE.slice(0, 1), 3);
    expect(actions).toHaveLength(1);
  });
});

describe("deriveEscalations", () => {
  it("escalates a single loss at or above the 45-min threshold, and not below it", () => {
    const losses: DdsEscalationLossInput[] = [
      { lineId: "L2", lineName: "Line 2", reasonCode: "BRK-MECH", reasonLabel: "Mechanical jam", lostTimeSec: ESCALATION_LOSS_THRESHOLD_SEC },
      { lineId: "L1", lineName: "Line 1", reasonCode: "SS-MISFEED", reasonLabel: "Misfeed", lostTimeSec: ESCALATION_LOSS_THRESHOLD_SEC - 1 },
    ];
    const escalations = deriveEscalations(losses, []);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].lineId).toBe("L2");
    expect(escalations[0].metric).toBe("45 min");
  });

  it("escalates a line at or below the 80% DIFOT threshold, ignores N/A (null) DIFOT, and ignores lines above threshold", () => {
    const difotByLine: DdsDifotLineInput[] = [
      { lineId: "L1", lineName: "Line 1", difotPct: ESCALATION_DIFOT_THRESHOLD - 0.01 },
      { lineId: "L2", lineName: "Line 2", difotPct: ESCALATION_DIFOT_THRESHOLD + 0.05 },
      { lineId: "L3", lineName: "Line 3", difotPct: null },
    ];
    const escalations = deriveEscalations([], difotByLine);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].lineId).toBe("L1");
    expect(escalations[0].metric).toBe("79%");
  });

  it("returns an empty array (renders as 'No escalations') when nothing crosses either threshold", () => {
    const escalations = deriveEscalations(
      [{ lineId: "L1", lineName: "Line 1", reasonCode: "BRK-MECH", reasonLabel: "x", lostTimeSec: 60 }],
      [{ lineId: "L1", lineName: "Line 1", difotPct: 0.95 }],
    );
    expect(escalations).toEqual([]);
  });

  it("is deterministic — two runs on the same input produce identical output", () => {
    const losses: DdsEscalationLossInput[] = [
      { lineId: "L2", lineName: "Line 2", reasonCode: "BRK-MECH", reasonLabel: "Mechanical jam", lostTimeSec: 3000 },
    ];
    const difotByLine: DdsDifotLineInput[] = [{ lineId: "L1", lineName: "Line 1", difotPct: 0.5 }];
    expect(deriveEscalations(losses, difotByLine)).toEqual(deriveEscalations(losses, difotByLine));
  });
});
