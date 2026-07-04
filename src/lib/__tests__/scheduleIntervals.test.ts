import { describe, expect, it } from 'vitest';
import {
  findEarliestAvailableInterval,
  intervalsOverlap,
} from '@/lib/scheduleIntervals';

function at(h: number, m = 0): Date {
  return new Date(`2026-07-04T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
}

describe('intervalsOverlap', () => {
  it('rejects exact partial overlap 10:22-10:52 vs 10:00-10:45', () => {
    expect(intervalsOverlap(at(22, 22), at(22, 52), at(22, 0), at(22, 45))).toBe(true);
  });

  it('allows boundary after 10:45-11:15 vs 10:00-10:45', () => {
    expect(intervalsOverlap(at(22, 45), at(23, 15), at(22, 0), at(22, 45))).toBe(false);
  });

  it('allows boundary before 09:30-10:00 vs 10:00-10:45', () => {
    expect(intervalsOverlap(at(21, 30), at(22, 0), at(22, 0), at(22, 45))).toBe(false);
  });

  it('rejects when new interval surrounds existing', () => {
    expect(intervalsOverlap(at(21, 30), at(23, 0), at(22, 0), at(22, 45))).toBe(true);
  });
});

describe('findEarliestAvailableInterval', () => {
  it('bumps past booking to 10:45 when now is 10:22', () => {
    const busy = [
      {
        id: 1,
        source: 'booking' as const,
        start: at(22, 0),
        end: at(22, 45),
      },
    ];
    const slot = findEarliestAvailableInterval({
      busyIntervals: busy,
      candidateStart: at(22, 22),
      durationMinutes: 30,
    });
    expect(slot?.getTime()).toBe(at(22, 45).getTime());
  });
});
