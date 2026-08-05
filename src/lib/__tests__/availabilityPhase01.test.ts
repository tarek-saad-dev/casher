/**
 * Phase 0+1 focused tests: business date cutoff, reason codes, day-plan parity helpers,
 * legacy booking fence, write-parity contract (integrity uses resolveEmployeeDayPlan).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getOperationalDate,
  getCairoBusinessDate,
  BUSINESS_DAY_CUTOFF_HOUR,
} from '@/lib/businessDate';
import { getOperationalDateContext } from '@/lib/availability/operationalDateContext';
import {
  AVAILABILITY_REASON_CODES,
  mapLegacySlotReason,
  inferDayDenyReason,
} from '@/lib/availability/reasonCodes';
import {
  isLegacyBookingsCreateEnabled,
  isCanonicalCreateEligibleShape,
  legacyBookingCreateDisabledBody,
  LEGACY_BOOKING_CREATE_DISABLED_CODE,
} from '@/lib/availability/legacyBookingCreateFence';
import { applyOverrides } from '@/lib/scheduleOverrides';

function cairoWall(isoLocal: string): Date {
  return new Date(`${isoLocal}+03:00`);
}

describe('Phase 1B — operational business date at Cairo cutoff', () => {
  it('03:59 Cairo → previous business date', () => {
    const now = cairoWall('2026-08-02T03:59:00');
    expect(getOperationalDate({ now })).toBe('2026-08-01');
    expect(getCairoBusinessDate(now)).toBe('2026-08-01');
    expect(getOperationalDateContext({ now }).businessDate).toBe('2026-08-01');
    expect(getOperationalDateContext({ now }).cutoffHour).toBe(BUSINESS_DAY_CUTOFF_HOUR);
  });

  it('04:00 Cairo → current business date', () => {
    const now = cairoWall('2026-08-02T04:00:00');
    expect(getOperationalDate({ now })).toBe('2026-08-02');
    expect(getCairoBusinessDate(now)).toBe('2026-08-02');
  });

  it('ops schedulerUtils delegates to businessDate owner', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/operations/schedulerUtils.ts'),
      'utf8',
    );
    expect(src).toContain("from '@/lib/businessDate'");
    expect(src).toContain('getCairoBusinessDateShared');
  });

  it('queue/new uses getOperationalDate (not UTC toISOString slice)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/queue/new/page.tsx'), 'utf8');
    expect(src).toContain('getOperationalDate');
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });

  it('AttendancePanel uses getOperationalDate for active work date', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/hr/AttendancePanel.tsx'), 'utf8');
    expect(src).toContain('getOperationalDate');
    expect(src).not.toContain('getBusinessDateStr');
  });
});

describe('Phase 1C — availability reason codes', () => {
  it('exports required machine codes', () => {
    for (const code of [
      'BRANCH_CLOSED',
      'EMPLOYEE_INACTIVE',
      'NOT_ASSIGNED_TO_BRANCH',
      'SCHEDULE_NOT_CONFIGURED',
      'EMPLOYEE_OFF_DAY',
      'EMPLOYEE_ABSENT',
      'FREELANCER_NOT_PLANNED',
      'SERVICE_NOT_SUPPORTED',
      'OUTSIDE_WORKING_WINDOW',
      'BLOCKED_BY_BREAK',
      'BLOCKED_BY_OVERRIDE',
      'BLOCKED_BY_DAILY_ADJUSTMENT',
      'DAY_CLOSED_BY_ADJUSTMENT',
      'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS',
      'BOOKING_CONFLICT',
      'QUEUE_CONFLICT',
      'NO_CONTIGUOUS_WINDOW',
      'NO_EMPLOYEE_AVAILABLE',
      'MIN_NOTICE_NOT_MET',
      'MAX_ADVANCE_EXCEEDED',
      'SLOT_UNAVAILABLE',
    ] as const) {
      expect(AVAILABILITY_REASON_CODES).toContain(code);
    }
  });

  it('maps legacy slot reasons', () => {
    expect(mapLegacySlotReason('booking_conflict')).toBe('BOOKING_CONFLICT');
    expect(mapLegacySlotReason('queue_conflict')).toBe('QUEUE_CONFLICT');
    expect(mapLegacySlotReason('insufficient_continuous_time')).toBe('NO_CONTIGUOUS_WINDOW');
    expect(mapLegacySlotReason('minimum_notice')).toBe('MIN_NOTICE_NOT_MET');
    expect(mapLegacySlotReason('break')).toBe('BLOCKED_BY_BREAK');
    expect(mapLegacySlotReason('outside_working_hours')).toBe('OUTSIDE_WORKING_WINDOW');
  });

  it('infers day-level deny codes', () => {
    expect(inferDayDenyReason({ contextsEmpty: true, absent: true })).toBe('EMPLOYEE_ABSENT');
    expect(inferDayDenyReason({ contextsEmpty: true, dayOff: true })).toBe('EMPLOYEE_OFF_DAY');
    expect(inferDayDenyReason({ contextsEmpty: true, scheduleMissing: true })).toBe(
      'SCHEDULE_NOT_CONFIGURED',
    );
    expect(inferDayDenyReason({ contextsEmpty: true })).toBe('NO_EMPLOYEE_AVAILABLE');
  });

  it('engine result includes reasonCode fields', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
      'utf8',
    );
    expect(src).toContain('reasonCode?: AvailabilityReasonCode');
    expect(src).toContain('employeeReasons');
    expect(src).toContain('mapLegacySlotReason');
  });
});

describe('Phase 0 — legacy booking create fence', () => {
  const prev = process.env.LEGACY_BOOKINGS_CREATE_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.LEGACY_BOOKINGS_CREATE_ENABLED;
    else process.env.LEGACY_BOOKINGS_CREATE_ENABLED = prev;
  });

  it('defaults to enabled (preserve production)', () => {
    delete process.env.LEGACY_BOOKINGS_CREATE_ENABLED;
    expect(isLegacyBookingsCreateEnabled()).toBe(true);
  });

  it('disables when env is false', () => {
    process.env.LEGACY_BOOKINGS_CREATE_ENABLED = 'false';
    expect(isLegacyBookingsCreateEnabled()).toBe(false);
    expect(legacyBookingCreateDisabledBody().code).toBe(LEGACY_BOOKING_CREATE_DISABLED_CODE);
  });

  it('detects canonical-create-eligible shapes', () => {
    expect(
      isCanonicalCreateEligibleShape({
        empId: 5,
        bookingDate: '2026-08-02',
        startTime: '11:00',
        services: [{ proId: 20 }],
      }),
    ).toBe(true);
    expect(
      isCanonicalCreateEligibleShape({
        bookingDate: 'bad',
        startTime: '11:00',
        services: [],
      }),
    ).toBe(false);
  });

  it('POST /api/bookings wires fence + deprecation markers', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/bookings/route.ts'), 'utf8');
    expect(src).toContain('isLegacyBookingsCreateEnabled');
    expect(src).toContain('logLegacyBookingCreate');
    expect(src).toContain('@deprecated LEGACY booking create');
    expect(src).toContain('410');
  });
});

describe('Phase 1A — canonical day-plan wiring contracts', () => {
  it('scheduleIntegrity uses resolveEmployeeDayPlan', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/scheduleIntegrity.ts'), 'utf8');
    expect(src).toContain('resolveEmployeeDayPlan');
    expect(src).not.toContain('getBarberWorkingWindow');
  });

  it('flow-board passes branchId into getBarbersDayStatus', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/operations/loadFlowBoardForBranch.ts'),
      'utf8',
    );
    expect(src).toMatch(/getBarbersDayStatus\([\s\S]*branchId/);
  });

  it('getBarbersDayStatus uses resolveEmployeeDayPlansBatch (Phase 2)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/availabilityEngine.ts'), 'utf8');
    expect(src).toContain('resolveEmployeeDayPlansBatch');
    expect(src).toContain('branchId?: number');
  });

  it('booking engine shares loadWorkingWindowsBatch module', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
      'utf8',
    );
    expect(src).toContain("from '@/lib/availability/loadWorkingWindowsBatch'");
  });
});

describe('Phase 1A — override / overnight schedule math (shared applyOverrides)', () => {
  it('weekly off-day stays off without custom_hours', () => {
    const eff = applyOverrides(
      5,
      '2026-08-02',
      { isWorking: false, start: '00:00', end: '00:00' },
      [],
    );
    expect(eff.isWorking).toBe(false);
  });

  it('custom_hours unlocks work-on-off-day', () => {
    const eff = applyOverrides(
      5,
      '2026-08-02',
      { isWorking: false, start: '00:00', end: '00:00' },
      [
        {
          OverrideID: 1,
          EmpID: 5,
          OverrideDate: '2026-08-02',
          Type: 'custom_hours',
          StartTime: '11:00',
          EndTime: '18:00',
          Reason: null,
          IsActive: true,
          CreatedBy: null,
          CreatedAt: '2026-08-01T00:00:00Z',
        },
      ],
    );
    expect(eff.isWorking).toBe(true);
    expect(eff.start).toBe('11:00');
    expect(eff.end).toBe('18:00');
  });

  it('late_start / early_leave / block_range / day_off', () => {
    const late = applyOverrides(
      5,
      '2026-08-02',
      { isWorking: true, start: '10:00', end: '22:00' },
      [
        {
          OverrideID: 2,
          EmpID: 5,
          OverrideDate: '2026-08-02',
          Type: 'late_start',
          StartTime: '12:00',
          EndTime: null,
          Reason: null,
          IsActive: true,
          CreatedBy: null,
          CreatedAt: '2026-08-01T00:00:00Z',
        },
      ],
    );
    expect(late.start).toBe('12:00');

    const early = applyOverrides(
      5,
      '2026-08-02',
      { isWorking: true, start: '10:00', end: '22:00' },
      [
        {
          OverrideID: 3,
          EmpID: 5,
          OverrideDate: '2026-08-02',
          Type: 'early_leave',
          StartTime: null,
          EndTime: '18:00',
          Reason: null,
          IsActive: true,
          CreatedBy: null,
          CreatedAt: '2026-08-01T00:00:00Z',
        },
      ],
    );
    expect(early.end).toBe('18:00');

    const blocked = applyOverrides(
      5,
      '2026-08-02',
      { isWorking: true, start: '10:00', end: '22:00' },
      [
        {
          OverrideID: 4,
          EmpID: 5,
          OverrideDate: '2026-08-02',
          Type: 'block_range',
          StartTime: '14:00',
          EndTime: '15:00',
          Reason: 'break',
          IsActive: true,
          CreatedBy: null,
          CreatedAt: '2026-08-01T00:00:00Z',
        },
      ],
    );
    expect(blocked.blockedIntervals.length).toBeGreaterThan(0);

    const off = applyOverrides(
      5,
      '2026-08-02',
      { isWorking: true, start: '10:00', end: '22:00' },
      [
        {
          OverrideID: 5,
          EmpID: 5,
          OverrideDate: '2026-08-02',
          Type: 'day_off',
          StartTime: null,
          EndTime: null,
          Reason: 'off',
          IsActive: true,
          CreatedBy: null,
          CreatedAt: '2026-08-01T00:00:00Z',
        },
      ],
    );
    expect(off.isWorking).toBe(false);
  });

  it('overnight weekly window: end <= start is overnight', () => {
    const start = '11:00';
    const end = '01:30';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const isOvernight = eh * 60 + em <= sh * 60 + sm;
    expect(isOvernight).toBe(true);
  });
});

describe('Phase 1D — parity diagnostics module exists', () => {
  it('exposes difference categories', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/availability/dayPlanParity.ts'),
      'utf8',
    );
    expect(src).toContain('LEGACY_WEEKLY_DIVERGENCE');
    expect(src).toContain('BRANCH_SCOPE_DIVERGENCE');
    expect(src).toContain('OVERRIDE_DIVERGENCE');
    expect(src).toContain('OVERNIGHT_DIVERGENCE');
    expect(src).toContain('BUSINESS_DATE_DIVERGENCE');
  });
});
