import { describe, expect, it } from 'vitest';
import { pause, rebase, resume, simNow, type ClockState } from '../src/sim-clock.js';

describe('simNow', () => {
  it('speed 60: 30 real seconds -> 1800 sim seconds', () => {
    const c: ClockState = { epochSimMs: 0, startedAtRealMs: 0, speed: 60, pausedAtRealMs: null };
    const nowRealMs = 30_000; // 30 real seconds
    const elapsedSimMs = simNow(c, nowRealMs) - c.epochSimMs;
    expect(elapsedSimMs).toBe(1_800_000); // 1800 sim seconds
  });

  it('rebase keeps simNow continuous at the rebase point', () => {
    const c: ClockState = { epochSimMs: 0, startedAtRealMs: 0, speed: 60, pausedAtRealMs: null };
    const t = 10_000; // rebase at real 10s
    const before = simNow(c, t);
    const rebased = rebase(c, t, 120);
    const after = simNow(rebased, t);
    expect(after).toBe(before);
  });

  it('rebase changes the slope after the rebase point', () => {
    const c: ClockState = { epochSimMs: 0, startedAtRealMs: 0, speed: 60, pausedAtRealMs: null };
    const t = 10_000;
    const rebased = rebase(c, t, 120);
    const later = t + 5_000;
    const delta = simNow(rebased, later) - simNow(rebased, t);
    expect(delta).toBe(5_000 * 120);
  });

  it('pause freezes simNow', () => {
    const c: ClockState = { epochSimMs: 0, startedAtRealMs: 0, speed: 60, pausedAtRealMs: null };
    const pausedAt = 10_000;
    const paused = pause(c, pausedAt);
    const frozen = simNow(paused, pausedAt);
    expect(simNow(paused, pausedAt + 60_000)).toBe(frozen);
  });

  it('resume continues from the frozen sim-time without a jump', () => {
    const c: ClockState = { epochSimMs: 0, startedAtRealMs: 0, speed: 60, pausedAtRealMs: null };
    const pausedAt = 10_000;
    const paused = pause(c, pausedAt);
    const frozen = simNow(paused, pausedAt + 60_000); // still frozen while paused

    const resumeAt = pausedAt + 60_000;
    const resumed = resume(paused, resumeAt);
    expect(simNow(resumed, resumeAt)).toBe(frozen);

    const laterDelta = simNow(resumed, resumeAt + 1_000) - simNow(resumed, resumeAt);
    expect(laterDelta).toBe(1_000 * 60);
  });
});
