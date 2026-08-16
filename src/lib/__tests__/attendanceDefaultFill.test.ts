import { describe, expect, it } from 'vitest';
import {
  applyDefaultTimesToRow,
  applyNowTimesToRow,
  isOvernightShiftTimes,
  shouldDeferOvernightDefaultCheckoutFill,
} from '@/lib/hr/attendance-default-fill';
import { computeGrossHoursFromTimes } from '@/lib/hr/attendance-breaks';

describe('attendance-default-fill', () => {
  it('does not invent times for DayOff / Absent / Excused', () => {
    for (const status of ['DayOff', 'Absent', 'Excused'] as const) {
      const row = {
        CheckInTime: null as string | null,
        CheckOutTime: null as string | null,
        DefaultCheckInTime: '13:00',
        DefaultCheckOutTime: '00:00',
        ScheduledStartTime: '13:00',
        ScheduledEndTime: '00:00',
        Status: status,
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      };
      expect(applyDefaultTimesToRow(row).CheckInTime).toBeNull();
      expect(applyDefaultTimesToRow(row).CheckOutTime).toBeNull();
      expect(applyDefaultTimesToRow(row).Status).toBe(status);
      expect(applyNowTimesToRow(row, '15:00').CheckInTime).toBeNull();
      expect(applyNowTimesToRow(row, '15:00').Status).toBe(status);
    }
  });

  it('fills defaults for Pending and marks Present/Late', () => {
    const row = {
      CheckInTime: null as string | null,
      CheckOutTime: null as string | null,
      DefaultCheckInTime: '10:00',
      DefaultCheckOutTime: '22:00',
      ScheduledStartTime: '10:00',
      ScheduledEndTime: '22:00',
      Status: 'Pending',
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
    };
    const updated = applyDefaultTimesToRow(row);
    expect(updated.CheckInTime).toBe('10:00');
    expect(updated.CheckOutTime).toBe('22:00');
    expect(updated.Status).toBe('Present');
  });

  it('detects overnight shift clocks', () => {
    expect(isOvernightShiftTimes('16:00', '02:00')).toBe(true);
    expect(isOvernightShiftTimes('10:00', '22:00')).toBe(false);
  });

  it('counts overnight OT past scheduled end (15:24 → 04:00 = 12.60h)', () => {
    expect(computeGrossHoursFromTimes('15:24', '04:00')).toBe(12.6);
    expect(computeGrossHoursFromTimes('15:24', '02:00')).toBe(10.6);
  });

  it('defers overnight Default checkout during OT grace (Karim case)', () => {
    // Build a Date whose Africa/Cairo wall clock is 02:40 on 2026-08-14.
    const probe = new Date('2026-08-14T00:00:00.000Z');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(probe);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    // Cairo offset hours from UTC at that instant
    const offsetH = hour; // at 00:00 UTC, Cairo hour = offset
    const nowInsideGrace = new Date(
      Date.UTC(2026, 7, 14, 2 - offsetH, 40, 0),
    );

    expect(
      shouldDeferOvernightDefaultCheckoutFill({
        checkOutTime: null,
        scheduledStart: '16:00',
        scheduledEnd: '02:00',
        defaultCheckIn: '16:00',
        defaultCheckOut: '02:00',
        workDate: '2026-08-13',
        now: nowInsideGrace,
        graceHours: 4,
      }),
    ).toBe(true);

    const nowAfterGrace = new Date(Date.UTC(2026, 7, 14, 6 - offsetH, 0, 0));
    expect(
      shouldDeferOvernightDefaultCheckoutFill({
        checkOutTime: null,
        scheduledStart: '16:00',
        scheduledEnd: '02:00',
        defaultCheckIn: '16:00',
        defaultCheckOut: '02:00',
        workDate: '2026-08-13',
        now: nowAfterGrace,
        graceHours: 4,
      }),
    ).toBe(false);
  });
});
