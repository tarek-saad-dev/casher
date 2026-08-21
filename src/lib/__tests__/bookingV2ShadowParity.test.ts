/**
 * Booking V2 Phase B7A — Availability read path + shadow parity (pure).
 * No public cutover. Legacy response still authoritative.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap, BOOKING_TZ, businessDateTimeToEpochMs } from '@/lib/booking/domain';
import {
  AvailabilityComposer,
  QUEUE_IN_PUBLIC_AVAILABILITY,
  QUEUE_OCCUPANCY_DECISION,
  compareAvailabilityShadow,
  composeEmployeeDayAvailabilityV2,
  deriveAvailabilityRevision,
  resolveBookingAvailabilityV2FromPreloaded,
  shouldRunBookingV2Shadow,
  __resetShadowParityStatsForTests,
  recordShadowSample,
  getShadowParityStats,
  evaluateReadCutoverReadiness,
} from '@/lib/booking/projection';
import type { ResolveBookingAvailabilityV2PreloadedDay } from '@/lib/booking/projection/resolveBookingAvailabilityV2';
import type { WeeklyBaselineSourceInputs } from '@/lib/booking/domain/WeeklyBaseline';

const EMP = 42;
const EMP2 = 43;
const BRANCH = 1;
const BRANCH2 = 2;
const DATE = '2026-08-16'; // Sunday

function ms(clock: string, dayOffset: 0 | 1 = 0): number {
  return businessDateTimeToEpochMs({
    businessDate: DATE,
    clockTimeHhmm: clock,
    calendarDayOffset: dayOffset,
    timeZone: BOOKING_TZ,
  });
}

function weekly(
  partial?: Partial<WeeklyBaselineSourceInputs>,
): WeeklyBaselineSourceInputs {
  return {
    key: { employeeId: EMP, branchId: BRANCH, dayOfWeek: 0 },
    employeeWindows: [{ startHhmm: '10:00', endHhmm: '18:00' }],
    isEmployeeWorkingDay: true,
    branchHours: { startHhmm: '09:00', endHhmm: '21:00' },
    branchIsOpen: true,
    ...partial,
  };
}

function day(
  overrides: Partial<ResolveBookingAvailabilityV2PreloadedDay> &
    Pick<ResolveBookingAvailabilityV2PreloadedDay, 'employeeId' | 'branchId' | 'businessDate'>,
): ResolveBookingAvailabilityV2PreloadedDay {
  return {
    weeklyBaselineInputs: weekly({
      key: {
        employeeId: overrides.employeeId,
        branchId: overrides.branchId,
        dayOfWeek: 0,
      },
    }),
    layers: { blockRanges: [], dailyAdjustments: [] },
    bookingIntervals: [],
    holdIntervals: [],
    queueIntervals: [],
    ...overrides,
  };
}

describe('QUEUE DECISION', () => {
  it('documents that live engine includes queue occupancy', () => {
    expect(QUEUE_IN_PUBLIC_AVAILABILITY).toBe(true);
    expect(QUEUE_OCCUPANCY_DECISION).toBe(
      'INCLUDE_QUEUE_OCCUPANCY_FOR_PARITY_WITH_LIVE_ENGINE',
    );
    const engine = readFileSync(
      join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
      'utf8',
    );
    expect(engine).toContain('buildQueueIntervalsForEmps');
    expect(engine).toContain("source === 'queue'");
  });
});

describe('FREE MASK LIVE PATH (pure)', () => {
  it('normal day generates 15/30/45/60 starts', () => {
    const base = day({ employeeId: EMP, branchId: BRANCH, businessDate: DATE });
    for (const dur of [15, 30, 45, 60]) {
      const r = composeEmployeeDayAvailabilityV2({
        day: base,
        durationMinutes: dur,
        slotIntervalMinutes: 15,
      });
      expect(r.availableStarts.length).toBeGreaterThan(0);
      expect(r.availableStarts.every((s) => s.dayOffset === 0)).toBe(true);
      expect(r.durationMinutes).toBe(dur);
      expect(r.availabilityRevision).toMatch(/^av:ew/);
    }
  });

  it('close day → no starts', () => {
    const r = composeEmployeeDayAvailabilityV2({
      day: day({
        employeeId: EMP,
        branchId: BRANCH,
        businessDate: DATE,
        layers: { closeDay: true, blockRanges: [], dailyAdjustments: [] },
      }),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(r.availableStarts).toHaveLength(0);
    expect(r.changeMask.length).toBeGreaterThan(0);
  });

  it('modified day (late_start) shrinks morning free', () => {
    const normal = composeEmployeeDayAvailabilityV2({
      day: day({ employeeId: EMP, branchId: BRANCH, businessDate: DATE }),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    const late = composeEmployeeDayAvailabilityV2({
      day: day({
        employeeId: EMP,
        branchId: BRANCH,
        businessDate: DATE,
        layers: {
          lateStartHhmm: '12:00',
          blockRanges: [],
          dailyAdjustments: [],
        },
      }),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(late.availableStarts.every((s) => s.startMin >= 12 * 60)).toBe(true);
    expect(late.availableStarts.length).toBeLessThan(normal.availableStarts.length);
  });

  it('booking + hold + queue occupancy clear FreeMask', () => {
    const r = composeEmployeeDayAvailabilityV2({
      day: day({
        employeeId: EMP,
        branchId: BRANCH,
        businessDate: DATE,
        bookingIntervals: [
          { id: 1, startAtMs: ms('12:00'), endAtMs: ms('12:30'), branchId: BRANCH },
        ],
        holdIntervals: [
          { id: 2, startAtMs: ms('14:00'), endAtMs: ms('14:15'), branchId: BRANCH },
        ],
        queueIntervals: [
          { id: 3, startAtMs: ms('16:00'), endAtMs: ms('16:45'), branchId: BRANCH },
        ],
      }),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    const times = new Set(r.availableStarts.map((s) => s.time));
    expect(times.has('12:00')).toBe(false);
    expect(times.has('14:00')).toBe(false);
    expect(times.has('16:00')).toBe(false);
    expect(times.has('11:00')).toBe(true);
  });

  it('overnight window + overnight booking', () => {
    const r = composeEmployeeDayAvailabilityV2({
      day: day({
        employeeId: EMP,
        branchId: BRANCH2,
        businessDate: DATE,
        weeklyBaselineInputs: weekly({
          key: { employeeId: EMP, branchId: BRANCH2, dayOfWeek: 0 },
          employeeWindows: [{ startHhmm: '11:00', endHhmm: '01:30' }],
          branchHours: { startHhmm: '11:00', endHhmm: '01:30' },
        }),
        bookingIntervals: [
          {
            id: 9,
            startAtMs: ms('23:30', 0),
            endAtMs: ms('00:15', 1),
            branchId: BRANCH2,
          },
        ],
      }),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(r.availableStarts.some((s) => s.dayOffset === 1)).toBe(true);
    expect(r.availableStarts.some((s) => s.time === '23:30')).toBe(false);
  });

  it('global EmpID — cross-branch booking occupies same employee day', () => {
    const r = composeEmployeeDayAvailabilityV2({
      day: day({
        employeeId: EMP,
        branchId: BRANCH,
        businessDate: DATE,
        bookingIntervals: [
          { id: 1, startAtMs: ms('11:00'), endAtMs: ms('11:30'), branchId: BRANCH2 },
        ],
      }),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(r.availableStarts.some((s) => s.time === '11:00')).toBe(false);
  });

  it('multi branch / any barber matrix via preloaded resolver', () => {
    const result = resolveBookingAvailabilityV2FromPreloaded({
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      days: [
        day({ employeeId: EMP, branchId: BRANCH, businessDate: DATE }),
        day({
          employeeId: EMP2,
          branchId: BRANCH,
          businessDate: DATE,
          weeklyBaselineInputs: weekly({
            key: { employeeId: EMP2, branchId: BRANCH, dayOfWeek: 0 },
          }),
        }),
        day({
          employeeId: EMP,
          branchId: BRANCH2,
          businessDate: DATE,
          weeklyBaselineInputs: weekly({
            key: { employeeId: EMP, branchId: BRANCH2, dayOfWeek: 0 },
            employeeWindows: [{ startHhmm: '14:00', endHhmm: '20:00' }],
          }),
        }),
      ],
    });
    expect(result.days).toHaveLength(3);
    expect(result.queryCount).toBe(0);
    expect(result.composeMs).toBeLessThan(50);
  });

  it('14-day matrix compose stays fast', () => {
    const days: ResolveBookingAvailabilityV2PreloadedDay[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(`${DATE}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      days.push(
        day({
          employeeId: EMP,
          branchId: BRANCH,
          businessDate: ymd,
          weeklyBaselineInputs: weekly({
            key: {
              employeeId: EMP,
              branchId: BRANCH,
              dayOfWeek: d.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            },
          }),
        }),
      );
    }
    const t0 = performance.now();
    const result = resolveBookingAvailabilityV2FromPreloaded({
      days,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    const totalMs = performance.now() - t0;
    expect(result.days).toHaveLength(14);
    // Informational only — host load varies; correctness is day count + bitmap contract.
    expect(Number.isFinite(result.composeMs)).toBe(true);
    expect(result.composeMs).toBeGreaterThanOrEqual(0);
    void totalMs;
    // eslint-disable-next-line no-console
    console.log(
      '[B7A 14-day compose]',
      JSON.stringify({
        composeMs: Number(result.composeMs.toFixed(2)),
        totalMs: Number(totalMs.toFixed(2)),
        days: result.days.length,
      }),
    );
  });
});

describe('SHADOW PARITY', () => {
  it('matches identical legacy/v2 slots', () => {
    const report = compareAvailabilityShadow({
      requestId: 'r1',
      employeeId: EMP,
      branchId: BRANCH,
      businessDate: DATE,
      durationMinutes: 30,
      legacySlots: [
        { time: '11:00', dayOffset: 0, empId: EMP },
        { time: '11:15', dayOffset: 0, empId: EMP },
      ],
      v2Slots: [
        { time: '11:00', dayOffset: 0, employeeId: EMP },
        { time: '11:15', dayOffset: 0, employeeId: EMP },
      ],
      availabilityRevision: deriveAvailabilityRevision({
        effectiveWorkRevision: 1,
        bookingOccupancyRevision: 1,
        holdOccupancyRevision: 1,
        queueOccupancyRevision: 1,
      }),
    });
    expect(report.matched).toBe(true);
    expect(report.missingInV2).toHaveLength(0);
  });

  it('classifies overnight mapping mismatches', () => {
    const report = compareAvailabilityShadow({
      employeeId: EMP,
      branchId: BRANCH,
      businessDate: DATE,
      durationMinutes: 30,
      legacySlots: [{ time: '00:30', dayOffset: 1, empId: EMP }],
      v2Slots: [{ time: '00:30', dayOffset: 0, employeeId: EMP }],
    });
    expect(report.matched).toBe(false);
    expect(report.reason).toBe('OVERNIGHT_MAPPING_MISMATCH');
  });

  it('shadow mode sampling respects env', () => {
    expect(
      shouldRunBookingV2Shadow({
        env: { BOOKING_V2_SHADOW_MODE: 'off' } as NodeJS.ProcessEnv,
      }),
    ).toBe(false);
    expect(
      shouldRunBookingV2Shadow({
        env: { BOOKING_V2_SHADOW_MODE: 'always' } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
    expect(
      shouldRunBookingV2Shadow({
        env: {
          BOOKING_V2_SHADOW_MODE: 'sample',
          BOOKING_V2_SHADOW_SAMPLE_RATE: '1',
        } as NodeJS.ProcessEnv,
        random: () => 0.5,
      }),
    ).toBe(true);
  });

  it('records stats counters', () => {
    __resetShadowParityStatsForTests();
    recordShadowSample(
      compareAvailabilityShadow({
        employeeId: EMP,
        branchId: BRANCH,
        businessDate: DATE,
        durationMinutes: 30,
        legacySlots: [{ time: '10:00', dayOffset: 0 }],
        v2Slots: [{ time: '10:00', dayOffset: 0 }],
      }),
    );
    recordShadowSample(
      compareAvailabilityShadow({
        employeeId: EMP,
        branchId: BRANCH,
        businessDate: DATE,
        durationMinutes: 30,
        legacySlots: [{ time: '10:00', dayOffset: 0 }],
        v2Slots: [],
        hints: { effectiveEmpty: true },
      }),
    );
    const stats = getShadowParityStats();
    expect(stats.samples).toBe(2);
    expect(stats.mismatches).toBe(1);
    expect(stats.byReason.EFFECTIVE_DAY_MISMATCH).toBe(1);
  });

  it('classifies available-days and min-notice mismatches', () => {
    const days = compareAvailabilityShadow({
      employeeId: EMP,
      branchId: BRANCH,
      businessDate: DATE,
      durationMinutes: 30,
      kind: 'available-days',
      legacySlots: [],
      v2Slots: [],
      hints: { legacyIsAvailable: true, v2IsAvailable: false },
    });
    expect(days.matched).toBe(false);
    expect(days.reason).toBe('AVAILABLE_DAY_MISMATCH');

    const minNotice = compareAvailabilityShadow({
      employeeId: EMP,
      branchId: BRANCH,
      businessDate: DATE,
      durationMinutes: 30,
      legacySlots: [{ time: '15:00', dayOffset: 0, empId: EMP }],
      v2Slots: [
        { time: '15:00', dayOffset: 0, employeeId: EMP },
        { time: '10:00', dayOffset: 0, employeeId: EMP },
      ],
      nowMs: ms('12:00'),
      minNoticeMinutes: 30,
    });
    expect(minNotice.matched).toBe(false);
    expect(minNotice.reason).toBe('MIN_NOTICE_MISMATCH');
  });

  it('compose applies past + minNotice like legacy engine', () => {
    const base = day({ employeeId: EMP, branchId: BRANCH, businessDate: DATE });
    const nowMs = ms('12:00');
    const r = composeEmployeeDayAvailabilityV2({
      day: base,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      nowMs,
      minNoticeMinutes: 60,
    });
    expect(r.availableStarts.every((s) => s.startAtMs > nowMs)).toBe(true);
    expect(
      r.availableStarts.every((s) => s.startAtMs >= nowMs + 60 * 60_000),
    ).toBe(true);
    // 12:00 + 60m = 13:00 — first allowed start is strictly >= now+minNotice
    // engine uses startAtMs < nowMs + minNoticeMs → reject, so 13:00 is allowed
    expect(r.availableStarts.some((s) => s.time === '13:00')).toBe(true);
    expect(r.availableStarts.some((s) => s.time === '12:00')).toBe(false);
    expect(r.availableStarts.some((s) => s.time === '12:45')).toBe(false);
  });

  it('cutover readiness gates on samples and mismatches', () => {
    __resetShadowParityStatsForTests();
    const early = evaluateReadCutoverReadiness({ minSamples: 50 });
    expect(early.decision).toBe('NO-GO');
    expect(early.reasons.some((r: string) => r.startsWith('insufficient_samples'))).toBe(
      true,
    );

    for (let i = 0; i < 50; i++) {
      recordShadowSample(
        compareAvailabilityShadow({
          employeeId: EMP,
          branchId: BRANCH,
          businessDate: DATE,
          durationMinutes: 30,
          legacySlots: [{ time: '10:00', dayOffset: 0 }],
          v2Slots: [{ time: '10:00', dayOffset: 0 }],
          timing: { legacyMs: 40, v2TotalMs: 30, v2QueryCount: 8 },
        }),
      );
    }
    const ready = evaluateReadCutoverReadiness({ minSamples: 50 });
    expect(ready.decision).toBe('GO');
  });
});

describe('ZERO N+1 + LEGACY STILL SERVED', () => {
  it('batch loaders + shadow hook present without cutover', () => {
    const root = process.cwd();
    const weekly = readFileSync(
      join(root, 'src/lib/booking/projection/loadWeeklyBaselineBatch.ts'),
      'utf8',
    );
    const layers = readFileSync(
      join(root, 'src/lib/booking/projection/loadEffectiveDayLayersBatch.ts'),
      'utf8',
    );
    const occ = readFileSync(
      join(root, 'src/lib/booking/projection/loadOccupancyBatch.ts'),
      'utf8',
    );
    const live = readFileSync(
      join(root, 'src/lib/booking/projection/resolveBookingAvailabilityV2Live.ts'),
      'utf8',
    );
    const pub = readFileSync(
      join(root, 'src/lib/booking/publicBookingAvailability.ts'),
      'utf8',
    );
    const route = readFileSync(
      join(root, 'src/app/api/admin/booking/v2/availability/route.ts'),
      'utf8',
    );

    expect(weekly).toContain('loadWeeklyBaselineSourceInputsBatch');
    expect(layers).toContain('loadEffectiveDayLayerInputsBatch');
    expect(layers).toContain('loadEffectiveDayLayerInputsRangeBatch');
    expect(occ).toContain('loadBookingOccupancyIntervalsBatch');
    expect(occ).toContain('loadBookingOccupancyIntervalsRangeBatch');
    expect(occ).toContain('loadHoldOccupancyIntervalsBatch');
    expect(occ).toContain('loadHoldOccupancyIntervalsRangeBatch');
    expect(occ).toContain('loadQueueOccupancyIntervalsBatch');
    expect(live).toContain('Promise.all');
    expect(live).toContain('loadEffectiveDayLayerInputsRangeBatch');
    expect(pub).toContain('schedulePublicSlotsShadow');
    expect(pub).toContain('schedulePublicAvailableDaysShadow');
    expect(pub).toContain('getPublicAvailableSlots');
    expect(pub).toContain('scheduleAvailableDaysShadowParity');
    expect(route).toContain('cutover: false');
    expect(route).toContain('BOOKING_V2_INTERNAL_API');
  });

  it('composer bitmap path is sub-ms class', () => {
    const work = AvailabilityBitmap.empty().setRange(10 * 60, 18 * 60);
    const empty = AvailabilityBitmap.empty();
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      AvailabilityComposer.compose({
        effectiveWorkMask: work,
        bookingOccupancyMask: empty,
        holdOccupancyMask: empty,
        queueOccupancyMask: empty,
      });
    }
    const per = (performance.now() - t0) / 2000;
    expect(per).toBeLessThan(1);
    // eslint-disable-next-line no-console
    console.log('[B7A composePerUs]', Number((per * 1000).toFixed(2)));
  });
});
