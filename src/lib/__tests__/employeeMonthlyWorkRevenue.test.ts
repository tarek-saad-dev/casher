import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  normalizeDailyAttendanceStatus,
  generateMonthDates,
  getMonthDateRange,
} from '@/lib/reports/dailyAttendanceStatus';
import {
  calcShiftDurationMinutes,
  isOvernightShift,
  formatDurationAr,
} from '@/lib/reports/reportFormatters';
import { validateReportParams } from '@/lib/reports/employee-monthly-work-revenue.types';
import { SERVICE_LINE_TOTAL_EXPR, roundMoney as revenueRound } from '@/lib/reports/employeeServicesRevenue';

describe('employeeServicesRevenue formula', () => {
  it('uses SValue - DisVal when SValue > 0', () => {
    expect(SERVICE_LINE_TOTAL_EXPR).toContain('ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)');
  });

  it('uses Qty * SPrice - DisVal fallback', () => {
    expect(SERVICE_LINE_TOTAL_EXPR).toContain('ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)');
  });

  it('rounds money to 2 decimals', () => {
    expect(revenueRound(10.556)).toBe(10.56);
  });
});

describe('shift duration', () => {
  it('calculates same-day shift', () => {
    expect(calcShiftDurationMinutes('09:00', '17:00')).toBe(480);
  });

  it('calculates overnight shift 14:00 → 01:00 as 11 hours', () => {
    expect(calcShiftDurationMinutes('14:00', '01:00')).toBe(660);
    expect(isOvernightShift('14:00', '01:00')).toBe(true);
  });

  it('returns null for missing times', () => {
    expect(calcShiftDurationMinutes(null, '17:00')).toBeNull();
  });
});

describe('daily attendance status', () => {
  it('marks future scheduled day as future_scheduled, not absent', () => {
    const status = normalizeDailyAttendanceStatus({
      isFutureDate: true,
      isScheduledWorkDay: true,
      isDayOff: false,
      checkIn: null,
      checkOut: null,
      attendanceStatus: null,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    });
    expect(status.statusCode).toBe('future_scheduled');
    expect(status.statusLabelAr).toBe('مجدول لاحقًا');
  });

  it('marks missing checkout as incomplete', () => {
    const status = normalizeDailyAttendanceStatus({
      isFutureDate: false,
      isScheduledWorkDay: true,
      isDayOff: false,
      checkIn: '10:00',
      checkOut: null,
      attendanceStatus: 'Present',
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    });
    expect(status.statusCode).toBe('incomplete_checkout');
  });

  it('marks day off correctly', () => {
    const status = normalizeDailyAttendanceStatus({
      isFutureDate: false,
      isScheduledWorkDay: false,
      isDayOff: true,
      checkIn: null,
      checkOut: null,
      attendanceStatus: 'DayOff',
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    });
    expect(status.statusCode).toBe('day_off');
  });

  it('combines late and early leave', () => {
    const status = normalizeDailyAttendanceStatus({
      isFutureDate: false,
      isScheduledWorkDay: true,
      isDayOff: false,
      checkIn: '10:00',
      checkOut: '16:00',
      attendanceStatus: 'Present',
      lateMinutes: 30,
      earlyLeaveMinutes: 15,
    });
    expect(status.statusCode).toBe('late_and_early');
  });
});

describe('calendar generation', () => {
  it('generates 28 days for Feb 2025', () => {
    const { calendarDays } = getMonthDateRange(2025, 2);
    expect(calendarDays).toBe(28);
    expect(generateMonthDates(2025, 2, calendarDays)).toHaveLength(28);
  });

  it('generates 29 days for Feb 2024 leap year', () => {
    const { calendarDays } = getMonthDateRange(2024, 2);
    expect(calendarDays).toBe(29);
  });

  it('generates 31 days for July', () => {
    const { calendarDays } = getMonthDateRange(2026, 7);
    expect(calendarDays).toBe(31);
    expect(generateMonthDates(2026, 7, calendarDays)).toHaveLength(31);
  });

  it('uses half-open month range', () => {
    const range = getMonthDateRange(2026, 6);
    expect(range.startDate).toBe('2026-06-01');
    expect(range.endDateExclusive).toBe('2026-07-01');
    expect(range.endDate).toBe('2026-06-30');
  });
});

describe('validateReportParams', () => {
  it('rejects missing employeeId', () => {
    const result = validateReportParams(null, '2026', '6');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid month', () => {
    const result = validateReportParams('5', '2026', '13');
    expect(result.ok).toBe(false);
  });

  it('accepts valid params', () => {
    const result = validateReportParams('25', '2026', '6');
    expect(result).toEqual({ ok: true, employeeId: 25, year: 2026, month: 6 });
  });
});

describe('formatDurationAr', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationAr(510)).toBe('8 س 30 د');
  });

  it('shows zero as 0', () => {
    expect(formatDurationAr(0)).toBe('0');
  });
});

describe('employee-monthly-work-revenue API route', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () =>
        new Response(JSON.stringify({ error: 'غير مصرح' }), { status: 401 }),
      ),
      isAuthResult: () => false,
    }));

    const { GET } = await import('@/app/api/admin/reports/employee-monthly-work-revenue/route');
    const req = new Request(
      'http://localhost/api/admin/reports/employee-monthly-work-revenue?employeeId=1&year=2026&month=6',
    );
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid month', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () => ({
        ok: true,
        userId: 1,
        userName: 'admin',
        userLevel: 'admin',
        roles: ['admin'],
        isSuperAdmin: false,
      })),
      isAuthResult: () => true,
    }));

    const { GET } = await import('@/app/api/admin/reports/employee-monthly-work-revenue/route');
    const req = new Request(
      'http://localhost/api/admin/reports/employee-monthly-work-revenue?employeeId=1&year=2026&month=0',
    );
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });
});

// Revenue aggregation logic (unit-level, no DB)
describe('revenue per employee attribution', () => {
  function lineTotal(sValue: number, qty: number, sPrice: number, disVal: number): number {
    if (sValue > 0) return sValue - disVal;
    return qty * sPrice - disVal;
  }

  it('does not give full invoice to both employees', () => {
    const invoiceTotal = 500;
    const emp1Lines = [lineTotal(200, 1, 200, 0)];
    const emp2Lines = [lineTotal(300, 1, 300, 0)];
    expect(emp1Lines.reduce((a, b) => a + b, 0) + emp2Lines.reduce((a, b) => a + b, 0)).toBe(invoiceTotal);
    expect(emp1Lines.reduce((a, b) => a + b, 0)).toBe(200);
    expect(emp2Lines.reduce((a, b) => a + b, 0)).toBe(300);
  });

  it('sums multiple lines for one employee', () => {
    const lines = [
      lineTotal(100, 1, 100, 10),
      lineTotal(0, 2, 50, 5),
    ];
    expect(lines.reduce((a, b) => a + b, 0)).toBe(185);
  });
});
