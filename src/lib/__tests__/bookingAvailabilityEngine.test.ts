import { describe, expect, it } from 'vitest';
import {
  evaluateBookingSlotAt,
  findInsufficientGapNotice,
} from '@/lib/bookingAvailabilityEngine';
import { intervalsOverlap } from '@/lib/scheduleIntervals';

function at(h: number, m = 0): Date {
  return new Date(`2026-07-04T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
}

function ms(d: Date): number {
  return d.getTime();
}

/** كريم scenario busy intervals (22:21 queue, 23:30 booking → midnight). */
function karimBusyIntervals() {
  return [
    { start: at(22, 21), end: at(22, 51), source: 'queue' as const },
    { start: at(23, 30), end: at(24, 0), source: 'booking' as const },
  ];
}

describe('كريم booking scenarios — evaluateBookingSlotAt', () => {
  const busy55 = karimBusyIntervals();
  const shiftStart = ms(at(10, 0));
  const shiftEnd = ms(at(26, 0)); // 02:00 next day

  describe('Scenario A — 55 minutes', () => {
    const duration = 55;

    it('rejects 22:45 (overlaps queue W-004)', () => {
      const r = evaluateBookingSlotAt(ms(at(22, 45)), duration, busy55, {
        shiftStartMs: shiftStart,
        shiftEndMs: shiftEnd,
      });
      expect(r.available).toBe(false);
      expect(r.reasonCode).toBe('queue_conflict');
    });

    it('rejects 23:00 (overlaps 23:30 booking)', () => {
      const r = evaluateBookingSlotAt(ms(at(23, 0)), duration, busy55, {
        shiftStartMs: shiftStart,
        shiftEndMs: shiftEnd,
      });
      expect(r.available).toBe(false);
      expect(r.reasonCode).toBe('booking_conflict');
    });

    it('rejects 23:15', () => {
      expect(
        evaluateBookingSlotAt(ms(at(23, 15)), duration, busy55, {
          shiftStartMs: shiftStart,
          shiftEndMs: shiftEnd,
        }).available,
      ).toBe(false);
    });

    it('rejects 23:30', () => {
      expect(
        evaluateBookingSlotAt(ms(at(23, 30)), duration, busy55, {
          shiftStartMs: shiftStart,
          shiftEndMs: shiftEnd,
        }).available,
      ).toBe(false);
    });

    it('rejects 23:45', () => {
      expect(
        evaluateBookingSlotAt(ms(at(23, 45)), duration, busy55, {
          shiftStartMs: shiftStart,
          shiftEndMs: shiftEnd,
        }).available,
      ).toBe(false);
    });

    it('allows 00:00 (after booking ends at midnight)', () => {
      const r = evaluateBookingSlotAt(ms(at(24, 0)), duration, busy55, {
        shiftStartMs: shiftStart,
        shiftEndMs: shiftEnd,
      });
      expect(r.available).toBe(true);
    });
  });

  describe('Scenario B — 30 minutes', () => {
    const duration = 30;
    const busy30 = karimBusyIntervals();

    it('rejects 22:45 (overlaps queue until 22:51)', () => {
      expect(
        evaluateBookingSlotAt(ms(at(22, 45)), duration, busy30, {
          shiftStartMs: shiftStart,
          shiftEndMs: shiftEnd,
        }).available,
      ).toBe(false);
    });

    it('allows 23:00–23:30 (fits in 39-minute gap)', () => {
      const r = evaluateBookingSlotAt(ms(at(23, 0)), duration, busy30, {
        shiftStartMs: shiftStart,
        shiftEndMs: shiftEnd,
      });
      expect(r.available).toBe(true);
      expect(r.slotEndMs).toBe(ms(at(23, 30)));
    });

    it('rejects 23:15 (ends 23:45, overlaps booking)', () => {
      expect(
        evaluateBookingSlotAt(ms(at(23, 15)), duration, busy30, {
          shiftStartMs: shiftStart,
          shiftEndMs: shiftEnd,
        }).available,
      ).toBe(false);
    });

    it('rejects 23:30 (starts at booking start — end 00:00 overlaps)', () => {
      const r = evaluateBookingSlotAt(ms(at(23, 30)), duration, busy30, {
        shiftStartMs: shiftStart,
        shiftEndMs: shiftEnd,
      });
      expect(r.available).toBe(false);
    });
  });

  describe('Scenario C — exact boundary', () => {
    it('allows booking at 23:30 when prior ends at 23:30 (half-open)', () => {
      const priorOnly = [{ start: at(23, 0), end: at(23, 30), source: 'booking' as const }];
      expect(
        intervalsOverlap(at(23, 30), at(24, 0), at(23, 0), at(23, 30)),
      ).toBe(false);
      expect(
        evaluateBookingSlotAt(ms(at(23, 30)), 30, priorOnly, {
          shiftStartMs: shiftStart,
          shiftEndMs: shiftEnd,
        }).available,
      ).toBe(true);
    });
  });
});

describe('findInsufficientGapNotice', () => {
  it('reports 39-minute gap when 55 minutes required (كريم case)', () => {
    const busy = karimBusyIntervals();
    const notice = findInsufficientGapNotice(
      busy,
      55,
      ms(at(22, 0)),
      ms(at(24, 0)),
    );
    expect(notice).not.toBeNull();
    expect(notice!.gapMinutes).toBe(39);
    expect(notice!.requiredMinutes).toBe(55);
    expect(notice!.message).toContain('39');
    expect(notice!.message).toContain('55');
  });

  it('does not report gap notice when 30 minutes fits the 39-minute gap', () => {
    const busy = karimBusyIntervals();
    const notice = findInsufficientGapNotice(
      busy,
      30,
      ms(at(22, 0)),
      ms(at(24, 0)),
    );
    expect(notice).toBeNull();
  });
});

describe('Scenario F — duration change invalidates old slot', () => {
  it('30-min slot at 23:00 becomes invalid at 75 minutes', () => {
    const busy = karimBusyIntervals();
    expect(
      evaluateBookingSlotAt(ms(at(23, 0)), 30, busy, {
        shiftStartMs: ms(at(22, 0)),
        shiftEndMs: ms(at(26, 0)),
      }).available,
    ).toBe(true);
    expect(
      evaluateBookingSlotAt(ms(at(23, 0)), 75, busy, {
        shiftStartMs: ms(at(22, 0)),
        shiftEndMs: ms(at(26, 0)),
      }).available,
    ).toBe(false);
  });
});

describe('Scenario G — minimum notice and working hours', () => {
  it('rejects slot in the past', () => {
    const now = ms(at(22, 0));
    const r = evaluateBookingSlotAt(ms(at(21, 0)), 30, [], {
      shiftStartMs: ms(at(20, 0)),
      shiftEndMs: ms(at(26, 0)),
      nowMs: now,
    });
    expect(r.available).toBe(false);
    expect(r.reasonCode).toBe('past');
  });

  it('rejects slot before minimum notice', () => {
    const now = ms(at(22, 0));
    const minNoticeMs = 30 * 60_000;
    const r = evaluateBookingSlotAt(ms(at(22, 15)), 30, [], {
      shiftStartMs: ms(at(20, 0)),
      shiftEndMs: ms(at(26, 0)),
      nowMs: now,
      minNoticeMs,
    });
    expect(r.available).toBe(false);
    expect(r.reasonCode).toBe('minimum_notice');
  });

  it('rejects slot that exceeds shift end', () => {
    const r = evaluateBookingSlotAt(ms(at(23, 45)), 30, [], {
      shiftStartMs: ms(at(22, 0)),
      shiftEndMs: ms(at(24, 0)),
    });
    expect(r.available).toBe(false);
    expect(r.reasonCode).toBe('insufficient_continuous_time');
  });
});
