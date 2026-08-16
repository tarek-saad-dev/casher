import { describe, expect, it } from 'vitest';
import {
  isTransferDestinationActive,
  isTransferSourceInactive,
  resolveTemporaryTransferPhase,
} from '@/lib/hr/temporaryTransferWindow';

describe('temporaryTransferWindow', () => {
  const workDate = '2026-08-15';

  it('all_day when no start time', () => {
    expect(
      resolveTemporaryTransferPhase({ workDate, startTime: null, endTime: null }),
    ).toBe('all_day');
    expect(
      isTransferDestinationActive({ workDate, startTime: null }),
    ).toBe(true);
    expect(isTransferSourceInactive({ workDate, startTime: null })).toBe(true);
  });

  it('before start keeps employee on source (not visible at destination)', () => {
    // 14:00 Cairo ≈ 11:00 UTC in summer (EEST UTC+3)
    const now = new Date('2026-08-15T11:00:00.000Z');
    expect(
      resolveTemporaryTransferPhase({
        workDate,
        startTime: '17:00',
        endTime: '12:34',
        now,
      }),
    ).toBe('before');
    expect(
      isTransferDestinationActive({
        workDate,
        startTime: '17:00',
        endTime: '12:34',
        now,
      }),
    ).toBe(false);
    expect(
      isTransferSourceInactive({
        workDate,
        startTime: '17:00',
        endTime: '12:34',
        now,
      }),
    ).toBe(false);
  });

  it('during window activates destination and deactivates source', () => {
    const now = new Date('2026-08-15T15:30:00.000Z'); // 18:30 Cairo
    expect(
      resolveTemporaryTransferPhase({
        workDate,
        startTime: '17:00',
        endTime: '12:34',
        now,
      }),
    ).toBe('during');
    expect(
      isTransferDestinationActive({
        workDate,
        startTime: '17:00',
        endTime: '12:34',
        now,
      }),
    ).toBe(true);
    expect(
      isTransferSourceInactive({
        workDate,
        startTime: '17:00',
        endTime: '12:34',
        now,
      }),
    ).toBe(true);
  });

  it('same-day window ends → after', () => {
    const now = new Date('2026-08-15T19:00:00.000Z'); // 22:00 Cairo
    expect(
      resolveTemporaryTransferPhase({
        workDate,
        startTime: '17:00',
        endTime: '21:00',
        now,
      }),
    ).toBe('after');
    expect(
      isTransferDestinationActive({
        workDate,
        startTime: '17:00',
        endTime: '21:00',
        now,
      }),
    ).toBe(false);
  });
});
