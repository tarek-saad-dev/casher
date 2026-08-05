/**
 * Availability Architecture — Phase 2.5 hardening tests.
 * Multi-window helpers, explain engine, TX propagation contracts, no-duplication.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  iterateEffectiveWindows,
  findContainingWindow,
  findNextWindow,
  selectPrimaryEffectiveWindow,
} from '@/lib/availability/effectiveWindows';
import type { DayPlanWindow } from '@/lib/availability/resolveEmployeeDayPlan';
import {
  buildEmployeeDayPlanFromInputs,
} from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { explainEmployeeDayPlan } from '@/lib/availability/explainAvailability';
import { CANONICAL_AVAILABILITY_EXPORTS } from '@/lib/availability/contracts';

vi.mock('server-only', () => ({}));

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function win(
  start: string,
  end: string,
  startMs: number,
  endMs: number,
  endDayOffset: 0 | 1 = 0,
): DayPlanWindow {
  return { start, end, startMs, endMs, endDayOffset };
}

describe('Phase 2.5 — multi-window helpers', () => {
  const windows = [
    win('14:00', '18:00', 200, 400),
    win('09:00', '12:00', 100, 150),
  ];

  it('iterateEffectiveWindows sorts by startMs', () => {
    const ordered = iterateEffectiveWindows(windows);
    expect(ordered.map((w) => w.start)).toEqual(['09:00', '14:00']);
  });

  it('findContainingWindow / findNextWindow / selectPrimaryEffectiveWindow', () => {
    expect(findContainingWindow(windows, 120)?.start).toBe('09:00');
    expect(findContainingWindow(windows, 500)).toBeNull();
    expect(findNextWindow(windows, 160)?.start).toBe('14:00');
    expect(selectPrimaryEffectiveWindow(windows)?.start).toBe('09:00');
    expect(selectPrimaryEffectiveWindow(windows, { policy: 'containing', pointMs: 250 })?.start).toBe(
      '14:00',
    );
    expect(selectPrimaryEffectiveWindow(windows, { policy: 'next', fromMs: 160 })?.start).toBe(
      '14:00',
    );
  });

  it('production consumers do not index effectiveWindows[0] directly', () => {
    const files = [
      'src/lib/scheduleIntegrity.ts',
      'src/lib/bookingRescheduleCore.ts',
      'src/lib/operationsQueueTimeline.ts',
      'src/lib/queueEstimateEngine.ts',
      'src/lib/availability/mapEmployeeDayPlanToBarberDayStatus.ts',
      'src/lib/availability/dayPlanParity.ts',
      'src/app/api/bookings/estimate/route.ts',
    ];
    for (const f of files) {
      expect(read(f)).not.toContain('effectiveWindows[0]');
    }
    // Display / adapter / parity may still use selectPrimaryEffectiveWindow.
    expect(read('src/lib/availability/mapEmployeeDayPlanToBarberDayStatus.ts')).toContain(
      'selectPrimaryEffectiveWindow',
    );
    expect(read('src/lib/availability/dayPlanParity.ts')).toContain(
      'selectPrimaryEffectiveWindow',
    );
  });
});

describe('Phase 2.5 — explain engine', () => {
  it('explains working and deny plans without re-resolving', () => {
    const working = buildEmployeeDayPlanFromInputs({
      empId: 3,
      branchId: 1,
      businessDate: '2026-08-03',
      inputs: {
        windowsMap: new Map([
          [3, { isWorkingDay: true, startTime: '10:00', endTime: '18:00', source: 'BRANCH_WEEKLY' }],
        ]),
        overridesMap: new Map(),
        freelanceUnlocks: new Map(),
        attendanceMap: new Map(),
        dayOffEmpIds: new Set(),
        absentEmpIds: new Set(),
        timezone: 'Africa/Cairo',
        dailyAdjustmentsMap: new Map(),
      } satisfies EmployeeDayPlanBatchInputs,
    });
    const explained = explainEmployeeDayPlan(working);
    expect(explained.result).toBe('available');
    expect(explained.employeeId).toBe(3);
    expect(explained.businessDate).toBe('2026-08-03');
    expect(explained.branchId).toBe(1);
    expect(explained.windows.length).toBe(1);
    expect(explained.primaryWindow?.start).toBe('10:00');
    expect(explained.evaluationTimeline.length).toBeGreaterThan(0);
    expect(explained.layers.length).toBe(7);
    expect(explained.plan).toBe(working);

    const empty = buildEmployeeDayPlanFromInputs({
      empId: 9,
      branchId: null,
      businessDate: '2026-08-03',
      inputs: {
        windowsMap: new Map(),
        overridesMap: new Map(),
        freelanceUnlocks: new Map(),
        attendanceMap: new Map(),
        dayOffEmpIds: new Set(),
        absentEmpIds: new Set(),
        timezone: 'Africa/Cairo',
        dailyAdjustmentsMap: new Map(),
      },
    });
    const denied = explainEmployeeDayPlan(empty);
    expect(denied.result).toBe('not_configured');
    expect(denied.reasonCode).toBe('SCHEDULE_NOT_CONFIGURED');
  });
});

describe('Phase 2.5 — transaction propagation contracts', () => {
  it('batch loader and freelance unlocks accept transaction', () => {
    const loader = read('src/lib/availability/loadEmployeeDayPlanInputsBatch.ts');
    const freelance = read('src/lib/hr/freelanceBookingUnlock.ts');
    const timing = read('src/lib/publicBookingHelpers.ts');
    const integrity = read('src/lib/scheduleIntegrity.ts');
    const dayStatus = read('src/lib/availabilityEngine.ts');

    expect(loader).toContain('transaction?: Transaction');
    expect(loader).toContain('getGlobalTimingDefaults({ transaction })');
    expect(loader).toContain('loadFreelanceBookingUnlocks');
    expect(loader).toContain('transaction');
    expect(loader).toContain('Sequential');
    expect(freelance).toContain('transaction?: Transaction');
    expect(timing).toContain('transaction?: Transaction');
    expect(integrity).toContain('transaction: args.transaction');
    expect(dayStatus).toContain("transaction?: import('mssql').Transaction");
  });

  it('documents DDL pool exception only', () => {
    const loader = read('src/lib/availability/loadEmployeeDayPlanInputsBatch.ts');
    expect(loader).toContain('ensureEmpBranchWorkScheduleTable');
  });
});

describe('Phase 2.5 — no duplicated window iteration / contracts', () => {
  it('exports canonical contract catalog', () => {
    expect(CANONICAL_AVAILABILITY_EXPORTS).toContain('resolveEmployeeDayPlan');
    expect(CANONICAL_AVAILABILITY_EXPORTS).toContain('selectPrimaryEffectiveWindow');
    expect(CANONICAL_AVAILABILITY_EXPORTS).toContain('explainAvailability');
  });

  it('legacy helpers are marked deprecated', () => {
    expect(read('src/lib/availabilityEngine.ts')).toContain('@deprecated');
    expect(read('src/lib/barberAvailability.ts')).toContain('@deprecated');
    expect(read('src/lib/barberAvailability.ts')).toContain('getBarberWorkingWindow');
  });
});
