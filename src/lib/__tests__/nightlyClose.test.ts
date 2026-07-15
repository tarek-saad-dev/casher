import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isIncompleteAttendanceReason,
  selectIncompleteAttendanceMissing,
  NIGHTLY_INCOMPLETE_ACTION,
  NIGHTLY_INCOMPLETE_STATUS_CODE,
  planDefaultTimeFill,
  deriveAttendanceStatusAfterFill,
} from '@/lib/hr/finalize-incomplete-attendance';
import {
  resolveNightlyCloseWorkDate,
  shiftYmd,
  isNightlyCloseFireWindow,
  getCairoClockParts,
} from '@/lib/hr/nightly-close-work-date';
import { verifyNightlyWhatsAppDelivery } from '@/lib/hr/nightly-close.service';

describe('finalize-incomplete-attendance helpers', () => {
  it('maps incomplete reasons only', () => {
    expect(isIncompleteAttendanceReason('missing_checkin')).toBe(true);
    expect(isIncompleteAttendanceReason('missing_checkout')).toBe(true);
    expect(isIncompleteAttendanceReason('no_attendance')).toBe(true);
    expect(isIncompleteAttendanceReason('no_hourly_rate')).toBe(false);
  });

  it('selects incomplete missing rows', () => {
    const selected = selectIncompleteAttendanceMissing([
      { empId: 1, empName: 'أ', reason: 'missing_checkout' },
      { empId: 2, empName: 'ب', reason: 'no_hourly_rate' },
      { empId: 3, empName: 'ج', reason: 'no_attendance' },
    ]);
    expect(selected.map((s) => s.empId)).toEqual([1, 3]);
  });

  it('D means DefaultFill action', () => {
    expect(NIGHTLY_INCOMPLETE_STATUS_CODE).toBe('D');
    expect(NIGHTLY_INCOMPLETE_ACTION).toBe('DefaultFill');
  });

  it('fills only missing checkout from default', () => {
    const plan = planDefaultTimeFill({
      checkIn: '10:05',
      checkOut: null,
      defaultCheckIn: '10:00',
      defaultCheckOut: '22:00',
    });
    expect(plan).toEqual({
      checkIn: '10:05',
      checkOut: '22:00',
      filledIn: false,
      filledOut: true,
      canComplete: true,
    });
  });

  it('fills both times when no attendance row', () => {
    const plan = planDefaultTimeFill({
      checkIn: null,
      checkOut: null,
      defaultCheckIn: '11:00',
      defaultCheckOut: '23:00',
    });
    expect(plan.filledIn).toBe(true);
    expect(plan.filledOut).toBe(true);
    expect(plan.checkIn).toBe('11:00');
    expect(plan.checkOut).toBe('23:00');
    expect(plan.canComplete).toBe(true);
  });

  it('cannot complete when default out is missing', () => {
    const plan = planDefaultTimeFill({
      checkIn: '10:00',
      checkOut: null,
      defaultCheckIn: '10:00',
      defaultCheckOut: null,
    });
    expect(plan.canComplete).toBe(false);
    expect(plan.checkOut).toBeNull();
  });

  it('derives Late when check-in after schedule', () => {
    const d = deriveAttendanceStatusAfterFill({
      checkIn: '10:30',
      checkOut: '22:00',
      schedStart: '10:00',
      schedEnd: '22:00',
    });
    expect(d.status).toBe('Late');
    expect(d.lateMinutes).toBe(30);
  });
});

describe('nightly-close-work-date', () => {
  it('shifts ymd across month boundaries', () => {
    expect(shiftYmd('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftYmd('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('uses override workDate when provided', () => {
    expect(resolveNightlyCloseWorkDate('2026-07-14')).toBe('2026-07-14');
  });

  it('resolves Cairo yesterday from a fixed Cairo morning instant', () => {
    const now = new Date('2026-07-14T22:30:00.000Z');
    expect(resolveNightlyCloseWorkDate(null, now)).toBe('2026-07-14');
  });

  it('detects 01:00 Cairo fire window', () => {
    const fire = new Date('2026-07-14T22:00:30.000Z');
    expect(isNightlyCloseFireWindow(fire)).toBe(true);
    const clock = getCairoClockParts(fire);
    expect(clock.hour).toBe(1);
    expect(clock.minute).toBe(0);

    const later = new Date('2026-07-14T22:01:00.000Z');
    expect(isNightlyCloseFireWindow(later)).toBe(false);
  });
});

describe('verifyNightlyWhatsAppDelivery', () => {
  it('passes when all ready employees + owner sent', () => {
    const check = verifyNightlyWhatsAppDelivery({
      whatsappReady: true,
      employeesReady: 3,
      employeesSent: 3,
      employeesFailed: 0,
      ownerSent: true,
      ownerPhone: '01000000000',
    });
    expect(check.ok).toBe(true);
  });

  it('passes when nobody ready but owner sent', () => {
    const check = verifyNightlyWhatsAppDelivery({
      whatsappReady: true,
      employeesReady: 0,
      employeesSent: 0,
      employeesFailed: 0,
      ownerSent: true,
      ownerPhone: '01000000000',
    });
    expect(check.ok).toBe(true);
  });

  it('fails when WhatsApp not ready', () => {
    const check = verifyNightlyWhatsAppDelivery({
      whatsappReady: false,
      employeesReady: 1,
      employeesSent: 1,
      employeesFailed: 0,
      ownerSent: true,
      ownerPhone: '01000000000',
    });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/whatsappReady/i);
  });

  it('fails when employee send shortfall', () => {
    const check = verifyNightlyWhatsAppDelivery({
      whatsappReady: true,
      employeesReady: 4,
      employeesSent: 2,
      employeesFailed: 0,
      ownerSent: true,
      ownerPhone: '01000000000',
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain('2 من 4');
  });

  it('fails when owner not sent', () => {
    const check = verifyNightlyWhatsAppDelivery({
      whatsappReady: true,
      employeesReady: 1,
      employeesSent: 1,
      employeesFailed: 0,
      ownerSent: false,
      ownerPhone: '01000000000',
    });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/المدير/);
  });
});
