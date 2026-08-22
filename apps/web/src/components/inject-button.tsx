"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface InjectButtonProps {
  lineId: string;
  lineName?: string;
  compact?: boolean;
  className?: string;
}

const COOLDOWN_MS = 10_000;
const TOAST_MS = 4_000;

/**
 * Inject Breakdown control (03-03-PLAN.md Task 2, SIM-05) — the demo's
 * dramatic beat. Confirm-less but client-side rate-limited (disabled 10s
 * after use, matching the plan's <action>) so a live demo can't hammer the
 * simulator's control endpoint. Mounted on both the andon tile (hover-visible
 * strip) and the timeline page header — same component, two call sites.
 *
 * Posts to /api/control/inject, the web's thin proxy — never talks to the
 * simulator container directly from the browser.
 */
export function InjectButton({ lineId, lineName, compact = false, className = "" }: InjectButtonProps) {
  const [disabled, setDisabled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      setDisabled(true);
      cooldownTimer.current = setTimeout(() => setDisabled(false), COOLDOWN_MS);

      const label = lineName ?? lineId;
      void fetch("/api/control/inject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setToast(`Inject failed: ${body.error ?? res.statusText}`);
            return;
          }
          setToast(`Breakdown injected on ${label} — watch it cascade`);
        })
        .catch(() => setToast("Inject failed: simulator unreachable"))
        .finally(() => {
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
        });
    },
    [disabled, lineId, lineName],
  );

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={`Inject a breakdown on ${lineName ?? lineId}`}
        className={`rounded-md border border-state-down/50 bg-state-down/15 font-medium text-state-down transition-colors hover:bg-state-down/25 disabled:cursor-not-allowed disabled:opacity-40 ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        Inject breakdown
      </button>
      {toast && (
        <div className="absolute top-full right-0 z-10 mt-1 w-56 rounded-md border border-white/15 bg-panel px-2.5 py-1.5 text-xs text-foreground shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
