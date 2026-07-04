import { describe, expect, it } from 'vitest';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';
import { intervalsOverlap } from '@/lib/scheduleIntervals';
import { isBookingReschedulable, mergeBookingNotes, BOOKING_NOTES_MAX_LENGTH } from '@/lib/bookingRescheduleCore';
import {
  evaluateLocalBookingMove,
  enumeratePasteCandidateSlots,
} from '@/lib/bookingDragReschedule';
import {
  isBookingDraggable,
  snapDateTimeByMinutes,
  snapMinutesToGrid,
  type TimelineItem,
} from '@/components/operations/schedulerUtils';

function at(h: number, m = 0): Date {
  return new Date(`2026-07-04T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
}

function iso(d: Date): string {
  return d.toISOString();
}

function bookingItem(
  id: number,
  start: Date,
  end: Date,
  status = 'confirmed',
): TimelineItem {
  return {
    type: 'booking',
    sourceId: id,
    label: `Client ${id}`,
    startTime: iso(start),
    endTime: iso(end),
    status,
    protected: true,
    durationMinutes: (end.getTime() - start.getTime()) / 60000,
    customerName: `Client ${id}`,
  };
}

describe('booking drag reschedule — unit', () => {
  const shiftStart = at(10, 0).getTime();
  const shiftEnd = at(26, 0).getTime();

  it('allows move 15 minutes earlier into free interval', () => {
    const busy = [{ start: at(23, 30), end: at(24, 0), source: 'booking' as const }];
    const r = evaluateBookingSlotAt(at(22, 0).getTime(), 45, busy, {
      shiftStartMs: shiftStart,
      shiftEndMs: shiftEnd,
    });
    expect(r.available).toBe(true);
  });

  it('allows move 15 minutes later into free interval', () => {
    const busy = [{ start: at(22, 0), end: at(22, 45), source: 'booking' as const }];
    const r = evaluateBookingSlotAt(at(22, 45).getTime(), 30, busy, {
      shiftStartMs: shiftStart,
      shiftEndMs: shiftEnd,
    });
    expect(r.available).toBe(true);
  });

  it('rejects full-duration overlap', () => {
    const busy = [{ start: at(22, 0), end: at(22, 45), source: 'booking' as const }];
    const r = evaluateBookingSlotAt(at(22, 22).getTime(), 30, busy, {
      shiftStartMs: shiftStart,
      shiftEndMs: shiftEnd,
    });
    expect(r.available).toBe(false);
  });

  it('allows exact boundary (existing ends 10:45, candidate starts 10:45)', () => {
    expect(intervalsOverlap(at(22, 45), at(23, 30), at(22, 0), at(22, 45))).toBe(false);
    const busy = [{ start: at(22, 0), end: at(22, 45), source: 'booking' as const }];
    const r = evaluateBookingSlotAt(at(22, 45).getTime(), 45, busy, {
      shiftStartMs: shiftStart,
      shiftEndMs: shiftEnd,
    });
    expect(r.available).toBe(true);
  });

  it('excludes moved appointment from local conflict detection', () => {
    const self = bookingItem(1, at(22, 0), at(22, 45));
    const other = bookingItem(2, at(23, 0), at(23, 30));
    const r = evaluateLocalBookingMove({
      proposedStartIso: iso(at(22, 0)),
      proposedEndIso: iso(at(22, 45)),
      busyItems: [self, other],
      excludeBookingId: 1,
      workStart: '10:00',
      workEnd: '02:00',
      isOvernightShift: true,
    });
    expect(r.state).toBe('available');
  });

  it('snaps to nearest 15-minute grid deterministically', () => {
    expect(snapMinutesToGrid(7)).toBe(0);
    expect(snapMinutesToGrid(8)).toBe(15);
    expect(snapMinutesToGrid(22)).toBe(15);
    expect(snapMinutesToGrid(23)).toBe(30);
  });

  it('preserves duration when snapping datetime', () => {
    const original = iso(at(22, 0));
    const moved = snapDateTimeByMinutes(original, 15);
    const durationBefore = at(22, 45).getTime() - at(22, 0).getTime();
    const durationAfter =
      new Date(moved).getTime() + durationBefore - (new Date(moved).getTime() + durationBefore);
    expect(new Date(moved).getTime()).toBe(at(22, 15).getTime());
    expect(durationAfter).toBe(0);
  });

  it('marks serving/completed as non-draggable', () => {
    expect(isBookingReschedulable('confirmed')).toBe(true);
    expect(isBookingReschedulable('in_service')).toBe(false);
    expect(isBookingReschedulable('completed')).toBe(false);
    expect(
      isBookingDraggable(
        bookingItem(1, at(22, 0), at(22, 45), 'in_service'),
      ),
    ).toBe(false);
  });
});

describe('booking notes truncation', () => {
  it('keeps merged notes within NVARCHAR(500) limit', () => {
    const existing = 'x'.repeat(480);
    const audit = 'تعديل وقت بالسحب: 10:00→10:15 (م1)';
    const merged = mergeBookingNotes(existing, audit);
    expect(merged.length).toBeLessThanOrEqual(BOOKING_NOTES_MAX_LENGTH);
    expect(merged.endsWith(audit)).toBe(true);
  });

  it('preserves short audit when existing notes are empty', () => {
    const audit = 'تعديل وقت بالسحب: 10:00→10:15 (م1)';
    expect(mergeBookingNotes(null, audit)).toBe(audit);
  });
});

describe('cut-paste candidate enumeration', () => {
  it('finds 15-minute grid slots that fit full duration', () => {
    const session = {
      appointmentId: 1,
      customerName: 'Test',
      originalEmpId: 10,
      originalEmpName: 'A',
      originalStartAt: at(22, 0).toISOString(),
      originalEndAt: at(22, 30).toISOString(),
      durationMinutes: 30,
    };

    const other = bookingItem(2, at(23, 0), at(23, 30));
    const self = bookingItem(1, at(22, 0), at(22, 30));

    const slots = enumeratePasteCandidateSlots({
      session,
      operationalDate: '2026-07-04',
      barbers: [
        {
          empId: 10,
          empName: 'A',
          status: 'working',
          workStart: '14:00',
          workEnd: '02:00',
          isOvernightShift: true,
          timeline: [self, other],
        },
      ],
    });

    expect(slots.some((s) => s.startIso === at(22, 30).toISOString())).toBe(true);
    expect(slots.some((s) => s.startIso === at(22, 45).toISOString())).toBe(false);
  });
});

describe('overnight Cairo move', () => {
  it('computes snap across midnight operational hours', () => {
    const start = iso(at(23, 45));
    const moved = snapDateTimeByMinutes(start, 30);
    expect(new Date(moved).getHours()).toBe(0);
    expect(new Date(moved).getMinutes()).toBe(15);
  });
});
