/**
 * Availability Architecture — Phase 3C: True Multi-Window Runtime.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import type { DayPlanWindow } from '@/lib/availability/resolveEmployeeDayPlan';
import {
  findContainingWindow,
  findEarliestFitInWindows,
  findNextAvailablePointInWindows,
  findNextEffectiveWindow,
  findWindowContainingInterval,
  findWindowContainingPoint,
  getEffectiveWindowsOuterBounds,
  isIntervalInsideAnyEffectiveWindow,
  iterateWindowSlotStarts,
  normalizeEffectiveWindows,
  outerDisplayBounds,
  selectPrimaryEffectiveWindow,
} from '@/lib/availability/effectiveWindows';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';
import {
  explainAvailabilityIntervalFromPlan,
  explainEmployeeDayPlanInterval,
} from '@/lib/availability/explainAvailability';
import { buildEmployeeDayPlanFromInputs } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { applyDailyAdjustments } from '@/lib/availability/applyDailyAdjustments';
import {
  materializeAdjustmentWindow,
  type EmployeeDailyAdjustment,
} from '@/lib/availability/dailyAdjustments';
import { SALON_TZ } from '@/lib/businessDate';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const DATE = '2026-08-03';
const TZ = SALON_TZ;

function win(
  start: string,
  end: string,
  startMs: number,
  endMs: number,
  endDayOffset: 0 | 1 = 0,
): DayPlanWindow {
  return { start, end, startMs, endMs, endDayOffset };
}

function matWin(start: string, end: string, endDayOffset: 0 | 1 = 0): DayPlanWindow {
  const m = materializeAdjustmentWindow(DATE, { start, end, endDayOffset }, TZ);
  if (!m) throw new Error(`bad ${start}-${end}`);
  return {
    start: m.start,
    end: m.end,
    endDayOffset: m.endDayOffset,
    startMs: m.startMs,
    endMs: m.endMs,
  };
}

describe('Phase 3C — multi-window helpers', () => {
  const w1 = win('11:00', '15:00', 1000, 5000);
  const w2 = win('18:00', '22:00', 8000, 12000);
  const windows = [w2, w1];

  it('finds containing window for intervals in first and second windows', () => {
    expect(findWindowContainingInterval({ windows, startMs: 2000, endMs: 3000 })?.start).toBe(
      '11:00',
    );
    expect(findWindowContainingInterval({ windows, startMs: 9000, endMs: 10000 })?.start).toBe(
      '18:00',
    );
    expect(isIntervalInsideAnyEffectiveWindow({ windows, startMs: 2000, endMs: 3000 })).toBe(
      true,
    );
  });

  it('rejects gap and crossing-boundary intervals', () => {
    expect(findWindowContainingInterval({ windows, startMs: 5500, endMs: 6000 })).toBeNull();
    expect(
      findWindowContainingInterval({ windows, startMs: 4000, endMs: 9000 }),
    ).toBeNull();
  });

  it('rejects invalid intervals', () => {
    expect(findWindowContainingInterval({ windows, startMs: 2000, endMs: 2000 })).toBeNull();
    expect(findWindowContainingInterval({ windows, startMs: 3000, endMs: 2000 })).toBeNull();
  });

  it('dedupes overlapping normalized windows and sorts', () => {
    const dup = normalizeEffectiveWindows([w1, { ...w1 }, w2]);
    expect(dup).toHaveLength(2);
    expect(dup[0]!.start).toBe('11:00');
    expect(dup[1]!.start).toBe('18:00');
  });

  it('adjacent normalized windows do not merge for containment', () => {
    const a = win('11:00', '15:00', 1000, 5000);
    const b = win('15:00', '18:00', 5000, 8000);
    expect(findWindowContainingInterval({ windows: [a, b], startMs: 4500, endMs: 5500 })).toBeNull();
  });

  it('supports overnight windows via absolute ms', () => {
    const overnight = matWin('20:00', '02:00', 1);
    const start = overnight.startMs + 60 * 60_000;
    const end = start + 60 * 60_000;
    expect(findWindowContainingInterval({ windows: [overnight], startMs: start, endMs: end })).not.toBeNull();
  });

  it('findNextEffectiveWindow / findNextAvailablePointInWindows', () => {
    expect(findNextEffectiveWindow({ windows, fromMs: 4500 })?.start).toBe('11:00');
    expect(findNextEffectiveWindow({ windows, fromMs: 6000 })?.start).toBe('18:00');
    expect(findNextAvailablePointInWindows({ windows, fromMs: 6000 })).toBe(8000);
    expect(findContainingWindow(windows, 2500)?.start).toBe('11:00');
  });

  it('iterateWindowSlotStarts across two windows without bridging', () => {
    // 11–14 and 18–22, 60m duration, 30m interval
    const a = win('11:00', '14:00', 0, 3 * 60 * 60_000);
    const b = win('18:00', '22:00', 7 * 60 * 60_000, 11 * 60 * 60_000);
    const slots = iterateWindowSlotStarts({
      windows: [a, b],
      durationMinutes: 60,
      intervalMinutes: 30,
    });
    const starts = slots.map((s) => s.startMs);
    // First window: 0, 30m, 60m, 90m, 120m (ends at 180m) — last start 120m
    expect(starts.filter((s) => s < 3 * 60 * 60_000)).toEqual([
      0,
      30 * 60_000,
      60 * 60_000,
      90 * 60_000,
      120 * 60_000,
    ]);
    // No start that would bridge into gap (e.g. 150m = 13:30 ending after 14:00)
    expect(starts).not.toContain(150 * 60_000);
    expect(starts.some((s) => s >= 7 * 60 * 60_000)).toBe(true);
    expect(slots[0]?.window.start).toBe('11:00');
    expect(slots.every((s) => s.endMs === s.startMs + 60 * 60_000)).toBe(true);
  });

  it('notBeforeMs skips early starts; exact end boundary is valid', () => {
    const a = win('11:00', '14:00', 0, 3 * 60 * 60_000);
    const slots = iterateWindowSlotStarts({
      windows: [a],
      durationMinutes: 60,
      intervalMinutes: 30,
      notBeforeMs: 60 * 60_000, // 12:00
    });
    expect(slots[0]?.startMs).toBe(60 * 60_000);
    expect(
      findWindowContainingInterval({
        windows: [a],
        startMs: 2 * 60 * 60_000,
        endMs: 3 * 60 * 60_000, // ends exactly at window end
      }),
    ).not.toBeNull();
  });

  it('findWindowContainingPoint and getEffectiveWindowsOuterBounds', () => {
    const windows = [w1, w2];
    expect(findWindowContainingPoint({ windows, pointMs: 2500 })?.start).toBe('11:00');
    expect(getEffectiveWindowsOuterBounds(windows)?.startMs).toBe(1000);
    expect(getEffectiveWindowsOuterBounds(windows)?.endMs).toBe(12000);
  });

  it('does not mutate input windows array', () => {
    const windows = [w2, w1];
    const copy = windows.map((w) => ({ ...w }));
    iterateWindowSlotStarts({
      windows,
      durationMinutes: 30,
      intervalMinutes: 30,
    });
    findWindowContainingInterval({ windows, startMs: 2000, endMs: 3000 });
    expect(windows).toEqual(copy);
  });

  it('outerDisplayBounds is display-only (covers gap)', () => {
    const outer = outerDisplayBounds([w1, w2])!;
    expect(outer.startMs).toBe(1000);
    expect(outer.endMs).toBe(12000);
    // Gap point is inside outer but not inside any window
    expect(findContainingWindow([w1, w2], 6000)).toBeNull();
  });

  it('selectPrimaryEffectiveWindow remains available for display', () => {
    expect(selectPrimaryEffectiveWindow([w1, w2])?.start).toBe('11:00');
  });

  it('findEarliestFitInWindows skips to next window when current is too short', () => {
    const a = win('11:00', '13:00', 0, 2 * 60 * 60_000);
    const b = win('18:00', '22:00', 7 * 60 * 60_000, 11 * 60 * 60_000);
    // from 12:45 — 30m does not fit in first window
    const fromMs = 1 * 60 * 60_000 + 45 * 60_000;
    const fit = findEarliestFitInWindows({
      windows: [a, b],
      fromMs,
      durationMinutes: 30,
    });
    expect(fit).toBe(7 * 60 * 60_000);
  });
});

describe('Phase 3C — slot evaluation multi-window', () => {
  const a = matWin('11:00', '14:00');
  const b = matWin('18:00', '22:00');
  const windows = [a, b];

  it('accepts slots in either window; rejects gap and bridge', () => {
    const inFirst = salonDateTimeToMs(DATE, '12:00', TZ);
    const inSecond = salonDateTimeToMs(DATE, '19:00', TZ);
    const inGap = salonDateTimeToMs(DATE, '16:00', TZ);
    const bridgeStart = salonDateTimeToMs(DATE, '13:30', TZ);

    expect(
      evaluateBookingSlotAt(inFirst, 60, [], { effectiveWindows: windows }).available,
    ).toBe(true);
    expect(
      evaluateBookingSlotAt(inSecond, 60, [], { effectiveWindows: windows }).available,
    ).toBe(true);
    expect(
      evaluateBookingSlotAt(inGap, 60, [], { effectiveWindows: windows }).reasonCode,
    ).toBe('outside_working_hours');
    expect(
      evaluateBookingSlotAt(bridgeStart, 60, [], { effectiveWindows: windows }).reasonCode,
    ).toBe('insufficient_continuous_time');
  });

  it('duration that only fits second window', () => {
    const shortFirst = [matWin('11:00', '12:00'), matWin('18:00', '22:00')];
    const at11 = salonDateTimeToMs(DATE, '11:00', TZ);
    const at18 = salonDateTimeToMs(DATE, '18:00', TZ);
    expect(
      evaluateBookingSlotAt(at11, 90, [], { effectiveWindows: shortFirst }).available,
    ).toBe(false);
    expect(
      evaluateBookingSlotAt(at18, 90, [], { effectiveWindows: shortFirst }).available,
    ).toBe(true);
  });

  it('booking conflict in first still allows second', () => {
    const busyStart = salonDateTimeToMs(DATE, '12:00', TZ);
    const busy = [
      {
        start: new Date(busyStart),
        end: new Date(busyStart + 60 * 60_000),
        source: 'booking',
      },
    ];
    const at12 = salonDateTimeToMs(DATE, '12:00', TZ);
    const at19 = salonDateTimeToMs(DATE, '19:00', TZ);
    expect(
      evaluateBookingSlotAt(at12, 60, busy, { effectiveWindows: windows }).available,
    ).toBe(false);
    expect(
      evaluateBookingSlotAt(at19, 60, busy, { effectiveWindows: windows }).available,
    ).toBe(true);
  });
});

describe('Phase 3C — explain interval', () => {
  it('reports containing window, gap, cross-boundary, closed', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: {
        windowsMap: new Map([
          [10, { isWorkingDay: true, startTime: '11:00', endTime: '15:00', source: 'BRANCH_WEEKLY' }],
        ]),
        overridesMap: new Map(),
        freelanceUnlocks: new Map(),
        attendanceMap: new Map(),
        dayOffEmpIds: new Set(),
        absentEmpIds: new Set(),
        timezone: TZ,
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              {
                adjustmentId: 1,
                branchId: 1,
                employeeId: 10,
                businessDate: DATE,
                adjustmentType: 'ADD_WINDOW',
                reasonCode: null,
                reasonText: null,
                source: 'admin',
                windows: [matWin('18:00', '22:00')],
                createdBy: 1,
                createdAt: '2026-08-03T10:00:00Z',
                version: 1,
              } satisfies EmployeeDailyAdjustment,
            ],
          ],
        ]),
      } satisfies EmployeeDayPlanBatchInputs,
    });

    const w = plan.effectiveWindows;
    expect(w.length).toBeGreaterThanOrEqual(2);

    const inFirst = salonDateTimeToMs(DATE, '12:00', TZ);
    const gap = salonDateTimeToMs(DATE, '16:00', TZ);
    const bridge = salonDateTimeToMs(DATE, '14:30', TZ);

    const ok = explainAvailabilityIntervalFromPlan({
      plan,
      startMs: inFirst,
      endMs: inFirst + 60 * 60_000,
    });
    expect(ok.result).toBe('AVAILABLE');
    expect(ok.containingWindow).not.toBeNull();

    const gapEx = explainAvailabilityIntervalFromPlan({
      plan,
      startMs: gap,
      endMs: gap + 60 * 60_000,
    });
    expect(gapEx.result).toBe('OUTSIDE_ALL_WINDOWS');

    const cross = explainAvailabilityIntervalFromPlan({
      plan,
      startMs: bridge,
      endMs: bridge + 4 * 60 * 60_000,
    });
    expect(cross.result).toBe('CROSSES_WINDOW_BOUNDARY');

    const alias = explainEmployeeDayPlanInterval({
      plan,
      startMs: inFirst,
      endMs: inFirst + 60 * 60_000,
    });
    expect(alias.result).toBe('AVAILABLE');

    expect(
      explainEmployeeDayPlanInterval({
        plan,
        startMs: inFirst,
        endMs: inFirst,
      }).result,
    ).toBe('INVALID_INTERVAL');
  });

  it('absent / closed precedence', () => {
    const closed = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: {
        windowsMap: new Map([
          [10, { isWorkingDay: true, startTime: '11:00', endTime: '17:00', source: 'BRANCH_WEEKLY' }],
        ]),
        overridesMap: new Map(),
        freelanceUnlocks: new Map(),
        attendanceMap: new Map(),
        dayOffEmpIds: new Set(),
        absentEmpIds: new Set(),
        timezone: TZ,
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              {
                adjustmentId: 2,
                branchId: 1,
                employeeId: 10,
                businessDate: DATE,
                adjustmentType: 'CLOSE_DAY',
                reasonCode: null,
                reasonText: null,
                source: 'admin',
                windows: [],
                createdBy: 1,
                createdAt: '2026-08-03T10:00:00Z',
                version: 1,
              } satisfies EmployeeDailyAdjustment,
            ],
          ],
        ]),
      },
    });
    const start = salonDateTimeToMs(DATE, '12:00', TZ);
    expect(
      explainAvailabilityIntervalFromPlan({
        plan: closed,
        startMs: start,
        endMs: start + 60_000,
      }).result,
    ).toBe('DAY_CLOSED');

    const absent = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: {
        windowsMap: new Map([
          [10, { isWorkingDay: true, startTime: '11:00', endTime: '17:00', source: 'BRANCH_WEEKLY' }],
        ]),
        overridesMap: new Map(),
        freelanceUnlocks: new Map(),
        attendanceMap: new Map(),
        dayOffEmpIds: new Set(),
        absentEmpIds: new Set([10]),
        timezone: TZ,
        dailyAdjustmentsMap: new Map(),
      },
    });
    expect(
      explainAvailabilityIntervalFromPlan({
        plan: absent,
        startMs: start,
        endMs: start + 60_000,
      }).result,
    ).toBe('ABSENT');
  });
});

describe('Phase 3C — available-days continuous duration rule', () => {
  it('combined separate windows do not satisfy continuous duration', () => {
    const windows = [matWin('11:00', '12:00'), matWin('13:00', '14:00')];
    const starts = iterateWindowSlotStarts({
      windows,
      durationMinutes: 120,
      intervalMinutes: 30,
    });
    expect(starts).toHaveLength(0);
    expect(
      isIntervalInsideAnyEffectiveWindow({
        windows,
        startMs: windows[0]!.startMs,
        endMs: windows[0]!.startMs + 120 * 60_000,
      }),
    ).toBe(false);
  });

  it('second window can fit when first is too short', () => {
    const windows = [matWin('11:00', '12:00'), matWin('13:00', '16:00')];
    const starts = iterateWindowSlotStarts({
      windows,
      durationMinutes: 120,
      intervalMinutes: 30,
    });
    expect(starts.length).toBeGreaterThan(0);
    expect(starts[0]?.startMs).toBe(windows[1]!.startMs);
  });
});

describe('Phase 3C — engine must not keep legacy windows when day plan denies', () => {
  it('drops barbers when canonical plan is closed / empty (create parity)', () => {
    const engine = read('src/lib/bookingAvailabilityEngine.ts');
    const attachIdx = engine.indexOf('canonical day plan is authoritative');
    expect(attachIdx).toBeGreaterThan(-1);
    const slice = engine.slice(attachIdx, attachIdx + 1800);
    expect(slice).toContain('deniedEmpIds');
    expect(slice).toContain('!plan.isWorking');
    expect(slice).toMatch(/contexts\s*=\s*contexts\.filter|contexts\.splice/);
  });
});

describe('Phase 3C — contract audit (critical runtime files)', () => {
  const critical = [
    'src/lib/bookingAvailabilityEngine.ts',
    'src/lib/booking/publicBookingAvailability.ts',
    'src/lib/booking/publicBookingCreate.ts',
    'src/lib/scheduleIntegrity.ts',
    'src/lib/bookingRescheduleCore.ts',
    'src/lib/queueEstimateEngine.ts',
    'src/lib/operationsQueueTimeline.ts',
    'src/lib/booking/publicAvailableDaysRange.ts',
  ];

  it('forbids effectiveWindows[0] and selectPrimaryEffectiveWindow in runtime eligibility', () => {
    for (const f of critical) {
      const src = read(f);
      expect(src, f).not.toContain('effectiveWindows[0]');
      expect(src, f).not.toContain('selectPrimaryEffectiveWindow');
    }
  });

  it('display/adapter may still use selectPrimaryEffectiveWindow', () => {
    expect(read('src/lib/availability/mapEmployeeDayPlanToBarberDayStatus.ts')).toContain(
      'selectPrimaryEffectiveWindow',
    );
    expect(read('src/lib/availability/effectiveWindows.ts')).toContain(
      'DISPLAY / LEGACY COMPAT ONLY',
    );
  });

  it('workforce UI shows multi-window runtime success label', () => {
    const tl = read('src/components/admin/workforce/AvailabilityDayTimeline.tsx');
    expect(tl).toContain(
      'جميع فترات العمل المعروضة تُستخدم فعليًا في الحجز والطابور وإعادة الجدولة',
    );
    expect(tl).not.toContain('Multi-Window Runtime');
    expect(read('src/lib/booking/publicBookingCreate.ts')).toContain(
      'assertEmployeeIntervalAvailable',
    );
  });
});

describe('Phase 3C — applyDailyAdjustments ADD_WINDOW feeds runtime windows', () => {
  it('ADD_WINDOW creates second period used by containment', () => {
    const base = [matWin('11:00', '15:00')];
    const added = matWin('18:00', '22:00');
    const adj: EmployeeDailyAdjustment = {
      adjustmentId: 9,
      branchId: 1,
      employeeId: 10,
      businessDate: DATE,
      adjustmentType: 'ADD_WINDOW',
      reasonCode: null,
      reasonText: null,
      source: 'admin',
      windows: [added],
      createdBy: 1,
      createdAt: '2026-08-03T10:00:00Z',
      version: 1,
    };
    const applied = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      timezone: TZ,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [adj],
    });
    expect(applied.effectiveWindows.length).toBe(2);
    const evening = salonDateTimeToMs(DATE, '19:00', TZ);
    expect(
      findWindowContainingInterval({
        windows: applied.effectiveWindows,
        startMs: evening,
        endMs: evening + 60 * 60_000,
      }),
    ).not.toBeNull();
  });
});
