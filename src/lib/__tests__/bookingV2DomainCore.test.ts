/**
 * Booking V2 Domain Core — acceptance tests.
 * Pure / in-memory only. No route, UI, or DB behavior changes.
 */
import { describe, expect, it } from 'vitest';

import {
  BOOKING_TZ,
  bookingIntervalFromBusinessClock,
  bookingIntervalFromLegacyDayOffset,
  bookingIntervalToIso,
  bookingIntervalToLegacySlot,
  BookingPolicy,
  BOOKING_POLICY_RULE_CATALOG,
  businessDateTimeToEpochMs,
  formatCairoOffsetIso,
  globalEmployeeResourceKey,
  parseBusinessDate,
} from '@/lib/booking/domain';
import { BookingCommandService } from '@/lib/booking/services';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import type { ScheduleOverride } from '@/lib/scheduleOverrides';
import {
  materializeAdjustmentWindow,
  type EmployeeDailyAdjustment,
} from '@/lib/availability/dailyAdjustments';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';

const DATE = '2026-08-16';
const EMP = 42;
const BRANCH_GLEEM = 1;
const BRANCH_CAMP = 2;
const NOW = new Date(`${DATE}T12:00:00+03:00`).getTime();

const SETTINGS = {
  minNoticeMinutes: 0,
  maxBookingDaysAhead: 30,
  timeZone: BOOKING_TZ,
};

function override(partial: Partial<ScheduleOverride> & Pick<ScheduleOverride, 'Type'>): ScheduleOverride {
  return {
    OverrideID: partial.OverrideID ?? 1,
    EmpID: EMP,
    OverrideDate: DATE,
    Type: partial.Type,
    StartTime: partial.StartTime ?? null,
    EndTime: partial.EndTime ?? null,
    Reason: partial.Reason ?? null,
    IsActive: partial.IsActive ?? true,
    CreatedAt: '2026-08-16T10:00:00Z',
    CreatedBy: partial.CreatedBy ?? 'ops',
  };
}

function adj(
  partial: Partial<EmployeeDailyAdjustment> &
    Pick<EmployeeDailyAdjustment, 'adjustmentId' | 'adjustmentType'>,
): EmployeeDailyAdjustment {
  return {
    branchId: BRANCH_GLEEM,
    employeeId: EMP,
    businessDate: DATE,
    reasonCode: null,
    reasonText: null,
    source: 'admin',
    windows: [],
    createdBy: 1,
    createdAt: `2026-08-16T10:00:0${partial.adjustmentId % 10}Z`,
    version: 1,
    ...partial,
  };
}

function win(start: string, end: string, endDayOffset?: 0 | 1) {
  const mat = materializeAdjustmentWindow(
    DATE,
    { start, end, endDayOffset },
    BOOKING_TZ,
  );
  if (!mat) throw new Error(`bad window ${start}-${end}`);
  return mat;
}

function baseInputs(
  overrides: Partial<EmployeeDayPlanBatchInputs> = {},
): EmployeeDayPlanBatchInputs {
  return {
    windowsMap: new Map([
      [
        EMP,
        {
          isWorkingDay: true,
          startTime: '14:00',
          endTime: '02:00',
          source: 'BRANCH_WEEKLY',
        },
      ],
    ]),
    overridesMap: new Map(),
    freelanceUnlocks: new Map(),
    attendanceMap: new Map(),
    dayOffEmpIds: new Set(),
    absentEmpIds: new Set(),
    timezone: BOOKING_TZ,
    dailyAdjustmentsMap: new Map(),
    ...overrides,
  };
}

function daytimeInputs(): EmployeeDayPlanBatchInputs {
  return baseInputs({
    windowsMap: new Map([
      [
        EMP,
        {
          isWorkingDay: true,
          startTime: '10:00',
          endTime: '18:00',
          source: 'BRANCH_WEEKLY',
        },
      ],
    ]),
  });
}

describe('BOOKING V2 DOMAIN CORE', () => {
  it('exposes one BookingPolicy rule catalog', () => {
    expect(BookingPolicy.ruleCatalog).toEqual(BOOKING_POLICY_RULE_CATALOG);
    expect(BOOKING_POLICY_RULE_CATALOG).toContain('late_start');
    expect(BOOKING_POLICY_RULE_CATALOG).toContain('business_date_absolute_interval');
    expect(BOOKING_POLICY_RULE_CATALOG).toContain('global_employee_identity');
  });

  describe('BusinessDate absolute model', () => {
    it('keeps 00:45 after midnight on BusinessDate 2026-08-16 as next calendar absolute', () => {
      const businessDate = parseBusinessDate(DATE);
      const startMs = businessDateTimeToEpochMs({
        businessDate,
        clockTimeHhmm: '00:45',
        calendarDayOffset: 1,
      });
      const iso = formatCairoOffsetIso(startMs);
      expect(iso.startsWith('2026-08-17T00:45:00')).toBe(true);
      expect(iso.endsWith('+03:00') || iso.includes('+03:00')).toBe(true);

      const interval = bookingIntervalFromBusinessClock({
        businessDate,
        startTimeHhmm: '00:45',
        durationMinutes: 30,
        calendarDayOffset: 1,
      });
      const wire = bookingIntervalToIso(interval);
      expect(wire.businessDate).toBe(DATE);
      expect(wire.startAt.startsWith('2026-08-17T00:45:00')).toBe(true);
      expect(wire.legacyDayOffset).toBe(1);
      expect(bookingIntervalToLegacySlot(interval)).toEqual({
        date: DATE,
        time: '00:45',
        dayOffset: 1,
      });
    });

    it('legacy dayOffset bridge matches absolute BusinessDate model (single application)', () => {
      const viaLegacy = bookingIntervalFromLegacyDayOffset({
        businessDate: DATE,
        timeHhmm: '01:00',
        dayOffset: 1,
        durationMinutes: 30,
      });
      const viaAbsolute = bookingIntervalFromBusinessClock({
        businessDate: DATE,
        startTimeHhmm: '01:00',
        durationMinutes: 30,
        calendarDayOffset: 1,
      });
      expect(viaLegacy.startAtMs).toBe(viaAbsolute.startAtMs);
      expect(viaLegacy.businessDate).toBe(DATE);
      // Must NOT double-shift: calendar is Aug 17, not Aug 18
      expect(bookingIntervalToIso(viaLegacy).startAt.startsWith('2026-08-17T01:00:00')).toBe(
        true,
      );
    });
  });

  describe('overnight / daytime slots via BookingPolicy', () => {
    it('normal daytime', () => {
      const result = BookingCommandService.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '13:00',
        calendarDayOffset: 0,
        services: [{ serviceId: 1, serviceDefaultMinutes: 30 }],
        inputs: daytimeInputs(),
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.interval.legacyDayOffset).toBe(0);
        expect(result.interval.businessDate).toBe(DATE);
      }
    });

    it.each([
      ['23:45', 0],
      ['00:00', 1],
      ['00:15', 1],
      ['01:00', 1],
    ] as const)('overnight clock %s (calendarDayOffset=%s)', (time, offset) => {
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: time,
        calendarDayOffset: offset,
        durationMinutes: 30,
        inputs: baseInputs(),
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.interval.businessDate).toBe(DATE);
        expect(result.interval.legacyDayOffset).toBe(offset);
        const iso = bookingIntervalToIso(result.interval);
        if (offset === 1) {
          expect(iso.startAt.startsWith('2026-08-17T')).toBe(true);
        } else {
          expect(iso.startAt.startsWith('2026-08-16T')).toBe(true);
        }
      }
    });

    it('end after midnight — duration crossing calendar midnight stays on BusinessDate', () => {
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '01:30',
        calendarDayOffset: 1,
        durationMinutes: 30, // ends 02:00
        inputs: baseInputs(),
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.interval.endAtMs).toBe(
          businessDateTimeToEpochMs({
            businessDate: DATE,
            clockTimeHhmm: '02:00',
            calendarDayOffset: 1,
          }),
        );
      }
    });

    it('branch closes after midnight — slot past window end denied', () => {
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '02:00',
        calendarDayOffset: 1,
        durationMinutes: 30,
        inputs: baseInputs(),
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('OUTSIDE_WORKING_WINDOW');
    });
  });

  describe('schedule adjustments via single policy', () => {
    it('late_start denies earlier clocks', () => {
      const inputs = daytimeInputs();
      inputs.overridesMap = new Map([
        [EMP, [override({ Type: 'late_start', StartTime: '12:00' })]],
      ]);
      const denied = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '11:00',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(denied.ok).toBe(false);

      const allowed = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '12:30',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(allowed.ok).toBe(true);
    });

    it('early_leave denies late clocks', () => {
      const inputs = daytimeInputs();
      inputs.overridesMap = new Map([
        [EMP, [override({ Type: 'early_leave', EndTime: '15:00' })]],
      ]);
      const denied = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '15:00',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(denied.ok).toBe(false);

      const allowed = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '14:00',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(allowed.ok).toBe(true);
    });

    it('block_range denies overlapping interval', () => {
      const inputs = daytimeInputs();
      inputs.overridesMap = new Map([
        [
          EMP,
          [override({ Type: 'block_range', StartTime: '13:00', EndTime: '14:00' })],
        ],
      ]);
      const denied = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '13:15',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.code).toBe('BLOCKED_BY_RANGE');

      const allowed = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '14:00',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(allowed.ok).toBe(true);
    });

    it('close_day (CLOSE_DAY adjustment) denies all slots', () => {
      const inputs = daytimeInputs();
      inputs.dailyAdjustmentsMap = new Map([
        [EMP, [adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' })]],
      ]);
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '13:00',
        durationMinutes: 30,
        inputs,
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('DAY_CLOSED');
    });
  });

  describe('multi-branch global employee identity', () => {
    it('same EmpID is one resource across GLEEM and CAMP_CAESAR', () => {
      expect(globalEmployeeResourceKey(EMP)).toBe(`emp:${EMP}`);

      const startMs = salonDateTimeToMs(DATE, '13:00', BOOKING_TZ);
      const endMs = startMs + 30 * 60_000;
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '13:00',
        durationMinutes: 30,
        inputs: daytimeInputs(),
        settings: SETTINGS,
        nowMs: NOW,
        busyInAnyBranch: [
          {
            branchId: BRANCH_CAMP,
            startAtMs: startMs,
            endAtMs: endMs,
          },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('MULTI_BRANCH_RESOURCE_CONFLICT');
        expect(result.meta?.conflictBranchId).toBe(BRANCH_CAMP);
        expect(result.meta?.employeeResourceKey).toBe(`emp:${EMP}`);
      }
    });
  });

  describe('employee service duration override', () => {
    it('prefers employee override over service default', () => {
      const duration = BookingPolicy.resolveServiceDurations({
        services: [
          {
            serviceId: 9,
            serviceDefaultMinutes: 45,
            employeeOverrideMinutes: 60,
          },
        ],
        systemDefaultMinutes: 30,
      });
      expect(duration.totalDurationMinutes).toBe(60);
      expect(duration.durationSource).toBe('EMP_SERVICE_OVERRIDE');

      const viaCmd = BookingCommandService.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '13:00',
        services: [
          {
            serviceId: 9,
            serviceDefaultMinutes: 45,
            employeeOverrideMinutes: 90,
          },
        ],
        inputs: daytimeInputs(),
        settings: SETTINGS,
        nowMs: NOW,
      });
      expect(viaCmd.ok).toBe(true);
      if (viaCmd.ok) {
        expect(viaCmd.interval.endAtMs - viaCmd.interval.startAtMs).toBe(90 * 60_000);
      }
    });
  });

  describe('minNotice / maxAhead', () => {
    it('enforces minNotice', () => {
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: DATE,
        startTimeHhmm: '11:00',
        durationMinutes: 30,
        inputs: daytimeInputs(),
        settings: { ...SETTINGS, minNoticeMinutes: 120 },
        nowMs: salonDateTimeToMs(DATE, '10:30', BOOKING_TZ),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MIN_NOTICE_NOT_MET');
    });

    it('enforces maxAhead', () => {
      const result = BookingPolicy.evaluateSlot({
        employeeId: EMP,
        branchId: BRANCH_GLEEM,
        businessDate: '2026-10-01',
        startTimeHhmm: '11:00',
        durationMinutes: 30,
        inputs: daytimeInputs(),
        settings: { ...SETTINGS, maxBookingDaysAhead: 7 },
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MAX_ADVANCE_EXCEEDED');
    });
  });

  it('command service is evaluate-only (no write API surface)', () => {
    expect(Object.keys(BookingCommandService).sort()).toEqual([
      'evaluateNormalizedSlot',
      'evaluateSlot',
      'workPlan',
    ]);
  });
});
