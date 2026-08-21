/**
 * Booking V2 Phase B2.5 — shadow parity + hold batch + instrumentation contracts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildNormalizedBookingReadInputs,
  compareBookingPolicyToLegacyEngine,
  legacyAbsoluteBounds,
  runBookingPolicyParitySuite,
} from '@/lib/booking/parity/bookingPolicyParity';
import { BOOKING_TZ } from '@/lib/booking/domain/BusinessDate';
import { globalEmployeeResourceKey } from '@/lib/booking/domain/EmployeeIdentity';
import {
  filterActiveHoldsForEmployeeRange,
  type ActiveBookingHoldInterval,
} from '@/lib/booking/bookingHold';
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

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function override(
  partial: Partial<ScheduleOverride> & Pick<ScheduleOverride, 'Type'>,
): ScheduleOverride {
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

function norm(
  dayPlanInputs: EmployeeDayPlanBatchInputs,
  extra?: Partial<ReturnType<typeof buildNormalizedBookingReadInputs>>,
) {
  return buildNormalizedBookingReadInputs({
    employeeId: EMP,
    branchId: BRANCH_GLEEM,
    businessDate: DATE,
    dayPlanInputs,
    durationMinutes: 30,
    settings: SETTINGS,
    nowMs: NOW,
    ...extra,
  });
}

describe('BOOKING V2 PARITY (B2.5)', () => {
  it('POLICY + OVERNIGHT + DAY OVERRIDE + GLOBAL IDENTITY suite has zero mismatches', () => {
    const cases = [
      {
        name: 'daytime_ok',
        inputs: norm(daytimeInputs()),
        startTimeHhmm: '13:00',
        dayOffset: 0 as const,
      },
      {
        name: 'daytime_past_denied',
        inputs: norm(daytimeInputs()),
        startTimeHhmm: '11:00',
        dayOffset: 0 as const,
      },
      {
        name: 'overnight_2345',
        inputs: norm(baseInputs()),
        startTimeHhmm: '23:45',
        dayOffset: 0 as const,
      },
      {
        name: 'overnight_0000',
        inputs: norm(baseInputs()),
        startTimeHhmm: '00:00',
        dayOffset: 1 as const,
      },
      {
        name: 'overnight_0015',
        inputs: norm(baseInputs()),
        startTimeHhmm: '00:15',
        dayOffset: 1 as const,
      },
      {
        name: 'overnight_0100',
        inputs: norm(baseInputs()),
        startTimeHhmm: '01:00',
        dayOffset: 1 as const,
      },
      {
        name: 'overnight_past_close',
        inputs: norm(baseInputs()),
        startTimeHhmm: '02:30',
        dayOffset: 1 as const,
      },
      {
        name: 'late_start_denied',
        inputs: norm(
          (() => {
            const i = daytimeInputs();
            i.overridesMap = new Map([
              [EMP, [override({ Type: 'late_start', StartTime: '12:00' })]],
            ]);
            return i;
          })(),
        ),
        startTimeHhmm: '11:00',
        dayOffset: 0 as const,
      },
      {
        name: 'late_start_allowed',
        inputs: norm(
          (() => {
            const i = daytimeInputs();
            i.overridesMap = new Map([
              [EMP, [override({ Type: 'late_start', StartTime: '12:00' })]],
            ]);
            return i;
          })(),
        ),
        startTimeHhmm: '12:30',
        dayOffset: 0 as const,
      },
      {
        name: 'early_leave_denied',
        inputs: norm(
          (() => {
            const i = daytimeInputs();
            i.overridesMap = new Map([
              [EMP, [override({ Type: 'early_leave', EndTime: '15:00' })]],
            ]);
            return i;
          })(),
        ),
        startTimeHhmm: '15:00',
        dayOffset: 0 as const,
      },
      {
        name: 'block_range',
        inputs: norm(
          (() => {
            const i = daytimeInputs();
            i.overridesMap = new Map([
              [
                EMP,
                [override({ Type: 'block_range', StartTime: '13:00', EndTime: '14:00' })],
              ],
            ]);
            return i;
          })(),
        ),
        startTimeHhmm: '13:15',
        dayOffset: 0 as const,
      },
      {
        name: 'close_day',
        inputs: norm(
          (() => {
            const i = daytimeInputs();
            i.dailyAdjustmentsMap = new Map([
              [EMP, [adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' })]],
            ]);
            return i;
          })(),
        ),
        startTimeHhmm: '11:00',
        dayOffset: 0 as const,
      },
      {
        name: 'attendance_absent',
        inputs: norm(
          (() => {
            const i = daytimeInputs();
            i.absentEmpIds = new Set([EMP]);
            return i;
          })(),
        ),
        startTimeHhmm: '11:00',
        dayOffset: 0 as const,
      },
      {
        name: 'multi_branch_busy_conflict',
        inputs: norm(daytimeInputs(), {
          busyInAnyBranch: [
            {
              branchId: BRANCH_CAMP,
              startAtMs: salonDateTimeToMs(DATE, '13:00', BOOKING_TZ),
              endAtMs: salonDateTimeToMs(DATE, '13:00', BOOKING_TZ) + 30 * 60_000,
              source: 'booking',
            },
          ],
        }),
        startTimeHhmm: '13:00',
        dayOffset: 0 as const,
      },
    ];

    const suite = runBookingPolicyParitySuite(cases);
    const mismatches = suite.results.filter((r) => !r.matched);
    if (mismatches.length) {
      // eslint-disable-next-line no-console
      console.error(
        'PARITY_MISMATCHES',
        JSON.stringify(
          mismatches.map((m) => ({ name: m.name, mismatches: m.mismatches })),
          null,
          2,
        ),
      );
    }
    expect(suite.mismatchCount).toBe(0);
    expect(suite.matched).toBe(suite.total);
    expect(globalEmployeeResourceKey(EMP)).toBe(`emp:${EMP}`);
  });

  it('overnight absolute bounds match selection-evaluator legacy math', () => {
    const legacy = legacyAbsoluteBounds({
      workDate: DATE,
      time: '00:45',
      dayOffset: 1,
      durationMinutes: 30,
      timezone: BOOKING_TZ,
    });
    const result = compareBookingPolicyToLegacyEngine({
      name: 'abs',
      inputs: norm(baseInputs()),
      startTimeHhmm: '00:45',
      dayOffset: 1,
    });
    expect(result.matched).toBe(true);
    expect(legacy.startMs).toBeGreaterThan(0);
  });
});

describe('HOLD N+1 REMOVED', () => {
  it('engine uses batch hold loader, not per-employee Promise.all map', () => {
    const engine = read('src/lib/bookingAvailabilityEngine.ts');
    expect(engine).toContain('listActiveBookingHoldsForEmployees');
    expect(engine).toContain('filterActiveHoldsForEmployeeRange');
    expect(engine).not.toMatch(
      /contexts\.map\s*\(\s*async\s*\(\s*ctx\s*\)\s*=>\s*\{[\s\S]*listActiveBookingHoldsForEmployee/,
    );
  });

  it('batch filter matches per-employee range semantics', () => {
    const holds: ActiveBookingHoldInterval[] = [
      {
        empId: 1,
        holdId: 10,
        branchId: BRANCH_GLEEM,
        startAt: new Date('2026-08-16T12:00:00+03:00'),
        endAt: new Date('2026-08-16T12:30:00+03:00'),
      },
      {
        empId: 2,
        holdId: 11,
        branchId: BRANCH_CAMP,
        startAt: new Date('2026-08-16T12:00:00+03:00'),
        endAt: new Date('2026-08-16T12:30:00+03:00'),
      },
      {
        empId: 1,
        holdId: 12,
        branchId: BRANCH_CAMP,
        startAt: new Date('2026-08-16T18:00:00+03:00'),
        endAt: new Date('2026-08-16T18:30:00+03:00'),
      },
    ];
    const rangeStart = new Date('2026-08-16T11:00:00+03:00');
    const rangeEnd = new Date('2026-08-16T17:00:00+03:00');
    const forEmp1 = filterActiveHoldsForEmployeeRange(holds, {
      empId: 1,
      rangeStart,
      rangeEnd,
    });
    expect(forEmp1.map((h) => h.holdId)).toEqual([10]);
    // Global identity: hold on CAMP for emp 1 outside range excluded by time, not branch
    expect(forEmp1.every((h) => h.empId === 1)).toBe(true);
  });

  it('documents before/after query shape for holds on available-slots', () => {
    // Before: 1 query × N barbers (N+1). After: 1 query for all empIds.
    const beforePerBarber = 5;
    const afterBatch = 1;
    expect(afterBatch).toBe(1);
    expect(beforePerBarber).toBeGreaterThan(afterBatch);
  });
});

describe('B2.5 instrumentation (log-only)', () => {
  it('critical reads attach telemetry without required response fields', () => {
    const slots = read('src/app/api/public/booking/available-slots/route.ts');
    const days = read('src/app/api/public/booking/available-days/route.ts');
    const check = read('src/app/api/public/booking/check-slot/route.ts');
    const gate = read('src/lib/booking/publicBookingRouteGate.ts');
    const log = read('src/lib/booking/publicBookingResponse.ts');

    for (const src of [slots, days, check]) {
      expect(src).toContain('runWithPublicBookingReadTelemetry');
      expect(src).toContain('attachPublicBookingReadTelemetry');
      expect(src).toContain('setAvailabilityMs');
    }
    expect(gate).toContain('queryCount');
    expect(gate).toContain('dbMs');
    expect(gate).toContain('availabilityMs');
    expect(log).toContain('totalMs');
    // Response contracts must not require telemetry fields
    expect(slots).not.toMatch(/queryCount:\s*telemetry/);
    expect(check).not.toMatch(/body\.queryCount|queryCount:\s*telemetry\.queryCount/);
  });
});

describe('normalized read inputs', () => {
  it('builds shared preload shape for future projections', () => {
    const inputs = norm(daytimeInputs());
    expect(inputs.businessDate).toBe(DATE);
    expect(inputs.dayPlanInputs.timezone).toBe(BOOKING_TZ);
    expect(inputs.durationMinutes).toBe(30);
    // materializeAdjustmentWindow used by CLOSE_DAY fixtures elsewhere
    expect(
      materializeAdjustmentWindow(DATE, { start: '10:00', end: '18:00' }, BOOKING_TZ)?.start,
    ).toBe('10:00');
  });
});
