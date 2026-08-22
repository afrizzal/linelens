// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLive } from "../src/hooks/use-live";

type Listener = (ev?: unknown) => void;

/**
 * Minimal EventSource mock — 03-01-PLAN.md Task 3 <verify> asks for
 * "vitest + jsdom, EventSource mocked", not a real network stream.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, Listener[]> = {};
  closed = false;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    (this.listeners[type] ??= []).push(cb);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, ev?: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

describe("useLive", () => {
  const refetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    refetch.mockClear();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("debounces refetch on a change event (one call, after 300ms)", () => {
    renderHook(() => useLive(refetch));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit("change", {});
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("flips to polling when the source errors, and a successful reconnect stops polling", () => {
    const { result } = renderHook(() => useLive(refetch));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit("open");
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      es.emit("error");
    });
    expect(result.current.connected).toBe(false);
    expect(es.closed).toBe(true);

    refetch.mockClear();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refetch.mock.calls.length).toBeGreaterThan(0); // polling fired while disconnected

    // reconnect timer (backoff, starts at 1s) has fired by now and opened a
    // new EventSource — simulate it succeeding.
    const es2 = MockEventSource.instances.at(-1)!;
    expect(es2).not.toBe(es);
    act(() => {
      es2.emit("open");
    });
    expect(result.current.connected).toBe(true);

    refetch.mockClear();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(refetch).not.toHaveBeenCalled(); // polling stopped after reconnect
  });
});
