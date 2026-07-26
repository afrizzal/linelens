import { describe, expect, it } from 'vitest';
import { AlarmEvent, CountsEvent, StateChangeEvent, TelemetryEvent } from '../src/events.js';
import { parseTopic, topicFor, TELEMETRY_SUBSCRIPTION } from '../src/topics.js';

const SIM_TIME = '2026-07-25T07:00:00.000Z';

describe('TelemetryEvent round-trip', () => {
  it('parses a valid STATE_CHANGE event', () => {
    const raw = {
      v: 1,
      machineId: 'M1',
      lineId: 'L1',
      simTime: SIM_TIME,
      seq: 1,
      kind: 'STATE_CHANGE',
      state: 'DOWN',
      reasonCode: 'BRK-MECH',
    };
    const parsed = TelemetryEvent.parse(raw);
    expect(parsed.kind).toBe('STATE_CHANGE');
    if (parsed.kind === 'STATE_CHANGE') {
      expect(parsed.state).toBe('DOWN');
    }
  });

  it('parses a valid COUNTS event', () => {
    const raw = {
      v: 1,
      machineId: 'M1',
      lineId: 'L1',
      simTime: SIM_TIME,
      seq: 2,
      kind: 'COUNTS',
      goodDelta: 10,
      rejectDelta: 0,
      rejectReason: null,
      idealCycleTimeSec: 3.0,
      productId: 'CYC-A',
    };
    const parsed = TelemetryEvent.parse(raw);
    expect(parsed.kind).toBe('COUNTS');
  });

  it('parses a valid ALARM event', () => {
    const raw = {
      v: 1,
      machineId: 'M1',
      lineId: 'L1',
      simTime: SIM_TIME,
      seq: 3,
      kind: 'ALARM',
      alarmType: 'MICROSTOP',
      reasonCode: 'SS-MISFEED',
      durationSec: 12,
    };
    const parsed = TelemetryEvent.parse(raw);
    expect(parsed.kind).toBe('ALARM');
  });

  it('rejects an invalid state on STATE_CHANGE', () => {
    const raw = {
      v: 1,
      machineId: 'M1',
      lineId: 'L1',
      simTime: SIM_TIME,
      seq: 1,
      kind: 'STATE_CHANGE',
      state: 'NOT_A_STATE',
      reasonCode: null,
    };
    expect(() => StateChangeEvent.parse(raw)).toThrow();
  });

  it('rejects negative counts', () => {
    const raw = {
      v: 1,
      machineId: 'M1',
      lineId: 'L1',
      simTime: SIM_TIME,
      seq: 1,
      kind: 'COUNTS',
      goodDelta: -1,
      rejectDelta: 0,
      rejectReason: null,
      idealCycleTimeSec: 3.0,
      productId: 'CYC-A',
    };
    expect(() => CountsEvent.parse(raw)).toThrow();
  });

  it('rejects a non-positive durationSec on ALARM', () => {
    const raw = {
      v: 1,
      machineId: 'M1',
      lineId: 'L1',
      simTime: SIM_TIME,
      seq: 1,
      kind: 'ALARM',
      alarmType: 'MICROSTOP',
      reasonCode: 'SS-MISFEED',
      durationSec: 0,
    };
    expect(() => AlarmEvent.parse(raw)).toThrow();
  });
});

describe('topics', () => {
  it('topicFor/parseTopic are inverses', () => {
    const parts = { lineId: 'L2', machineId: 'M3' };
    const topic = topicFor(parts);
    expect(topic).toBe('spBv1.0/LineLens/DDATA/L2/M3');
    expect(parseTopic(topic)).toEqual(parts);
  });

  it('matches the subscription wildcard shape', () => {
    expect(TELEMETRY_SUBSCRIPTION).toBe('spBv1.0/LineLens/DDATA/+/+');
  });

  it('returns null for a malformed topic', () => {
    expect(parseTopic('spBv1.0/LineLens/DDATA/onlyone')).toBeNull();
    expect(parseTopic('not/a/matching/topic')).toBeNull();
  });
});
