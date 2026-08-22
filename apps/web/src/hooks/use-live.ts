"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useLive (03-01-PLAN.md Task 3) — wraps an SSE `EventSource` subscription
 * to /api/stream with a debounced refetch callback and a poll-based
 * fallback (ARCHITECTURE.md Pattern 3's documented escape hatch) while
 * disconnected. Dependency-free by design: pages hold their own state via
 * plain `fetch` and call this hook only for the "when to refetch" signal.
 */

export interface UseLiveOptions {
  lineId?: string;
}

export interface UseLiveResult {
  connected: boolean;
}

const DEBOUNCE_MS = 300;
const POLL_MS = 5000;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 5000;

export const useLive = (refetch: () => void, opts?: UseLiveOptions): UseLiveResult => {
  const [connected, setConnected] = useState(false);
  // Ref so the effect below never needs `refetch` in its dependency array —
  // callers commonly pass an inline arrow function, which would otherwise
  // tear down and reopen the EventSource on every render.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const lineId = opts?.lineId;

  useEffect(() => {
    let source: EventSource | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = RECONNECT_INITIAL_MS;
    let stopped = false;

    const debouncedRefetch = (): void => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refetchRef.current(), DEBOUNCE_MS);
    };

    const startPolling = (): void => {
      if (pollTimer) return;
      pollTimer = setInterval(() => refetchRef.current(), POLL_MS);
    };

    const stopPolling = (): void => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connect = (): void => {
      if (stopped) return;
      const url = lineId ? `/api/stream?lineId=${encodeURIComponent(lineId)}` : "/api/stream";
      const es = new EventSource(url);
      source = es;

      es.addEventListener("change", () => {
        debouncedRefetch();
      });

      es.addEventListener("open", () => {
        reconnectDelay = RECONNECT_INITIAL_MS;
        setConnected(true);
        stopPolling();
      });

      es.addEventListener("error", () => {
        setConnected(false);
        startPolling();
        es.close();
        if (source === es) source = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
          connect();
        }, reconnectDelay);
      });
    };

    connect();
    // Poll from the start too — covers the window before the first
    // 'open'/'error' fires, so a slow-to-connect stream still degrades
    // gracefully instead of showing nothing.
    startPolling();

    return () => {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [lineId]);

  return { connected };
};
