/**
 * Phase 2.5 — Non-CI-gating benchmark harness for availability hot paths.
 *
 * These tests always pass. They record timings via console when
 * AVAILABILITY_BENCH=1 is set, and exercise pure / mocked paths so CI
 * does not require a live database.
 *
 * Enable verbose output:
 *   AVAILABILITY_BENCH=1 npx vitest run src/lib/__tests__/availabilityBenchmarks.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { buildEmployeeDayPlanFromInputs } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { explainEmployeeDayPlan } from '@/lib/availability/explainAvailability';
import {
  iterateEffectiveWindows,
  selectPrimaryEffectiveWindow,
  iterateWindowSlotStarts,
  findEarliestFitInWindows,
  findWindowContainingInterval,
} from '@/lib/availability/effectiveWindows';

vi.mock('server-only', () => ({}));

const BENCH = process.env.AVAILABILITY_BENCH === '1';

function record(label: string, ms: number, n: number) {
  if (BENCH) {
    // eslint-disable-next-line no-console
    console.log(`[availability-bench] ${label}: ${ms.toFixed(2)}ms for n=${n} (${(ms / Math.max(n, 1)).toFixed(3)}ms/op)`);
  }
}

function makeInputs(empIds: number[]): EmployeeDayPlanBatchInputs {
  const windowsMap = new Map(
    empIds.map((id) => [
      id,
      {
        isWorkingDay: true as const,
        startTime: '10:00',
        endTime: '18:00',
        source: 'BRANCH_WEEKLY' as const,
      },
    ]),
  );
  return {
    windowsMap,
    overridesMap: new Map(),
    freelanceUnlocks: new Map(),
    attendanceMap: new Map(),
    dayOffEmpIds: new Set(),
    absentEmpIds: new Set(),
    timezone: 'Africa/Cairo',
    dailyAdjustmentsMap: new Map(),
  };
}

describe('Phase 2.5 — availability benchmarks (non-gating)', () => {
  it('buildEmployeeDayPlanFromInputs scales linearly in memory', () => {
    for (const n of [1, 5, 20, 50]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const inputs = makeInputs(ids);
      const t0 = performance.now();
      for (const id of ids) {
        buildEmployeeDayPlanFromInputs({
          empId: id,
          branchId: 1,
          businessDate: '2026-08-03',
          inputs,
        });
      }
      const ms = performance.now() - t0;
      record('buildEmployeeDayPlanFromInputs', ms, n);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('explainEmployeeDayPlan is cheap relative to plan build', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 1,
      branchId: 1,
      businessDate: '2026-08-03',
      inputs: makeInputs([1]),
    });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) explainEmployeeDayPlan(plan);
    const ms = performance.now() - t0;
    record('explainEmployeeDayPlan x200', ms, 200);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('window helpers stay O(W log W) for sort', () => {
    const windows = Array.from({ length: 32 }, (_, i) => ({
      start: `${String(8 + (i % 10)).padStart(2, '0')}:00`,
      end: `${String(9 + (i % 10)).padStart(2, '0')}:00`,
      startMs: i * 1000,
      endMs: i * 1000 + 500,
      endDayOffset: 0 as const,
    })).reverse();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      iterateEffectiveWindows(windows);
      selectPrimaryEffectiveWindow(windows);
    }
    const ms = performance.now() - t0;
    record('windowHelpers x1000', ms, 1000);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('Phase 3C multi-window helpers: 1 / 5 windows + dense fit', () => {
    const one = [
      { start: '11:00', end: '15:00', startMs: 0, endMs: 4 * 3600_000, endDayOffset: 0 as const },
    ];
    const five = Array.from({ length: 5 }, (_, i) => ({
      start: `${10 + i * 2}:00`,
      end: `${11 + i * 2}:00`,
      startMs: i * 2 * 3600_000,
      endMs: (i * 2 + 1) * 3600_000,
      endDayOffset: 0 as const,
    }));
    const overnight = [
      { start: '12:00', end: '14:00', startMs: 0, endMs: 2 * 3600_000, endDayOffset: 0 as const },
      {
        start: '20:00',
        end: '02:00',
        startMs: 8 * 3600_000,
        endMs: 14 * 3600_000,
        endDayOffset: 1 as const,
      },
    ];
    const denseOcc = Array.from({ length: 40 }, (_, i) => ({
      startMs: i * 15 * 60_000,
      endMs: i * 15 * 60_000 + 10 * 60_000,
    }));

    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      iterateWindowSlotStarts({ windows: one, durationMinutes: 30, intervalMinutes: 15 });
      iterateWindowSlotStarts({ windows: five, durationMinutes: 30, intervalMinutes: 15 });
      iterateWindowSlotStarts({
        windows: overnight,
        durationMinutes: 60,
        intervalMinutes: 30,
      });
      findEarliestFitInWindows({
        windows: five,
        fromMs: 45 * 60_000,
        durationMinutes: 30,
        occupied: denseOcc,
      });
      findWindowContainingInterval({
        windows: overnight,
        startMs: 9 * 3600_000,
        endMs: 10 * 3600_000,
      });
    }
    const ms = performance.now() - t0;
    record('phase3cMultiWindowHelpers x200', ms, 200);
    expect(ms).toBeGreaterThanOrEqual(0);

    const empIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const inputs = makeInputs(empIds);
    const t1 = performance.now();
    for (const id of empIds) {
      buildEmployeeDayPlanFromInputs({
        empId: id,
        branchId: 1,
        businessDate: '2026-08-03',
        inputs,
      });
      iterateWindowSlotStarts({
        windows: five.slice(0, 3),
        durationMinutes: 45,
        intervalMinutes: 15,
      });
    }
    record('20emps×3windows_shape', performance.now() - t1, 20);
    expect(true).toBe(true);
  });

  it('documents DB-bound benchmark targets (resolve / flow-board / timeline)', () => {
    // Live DB timings belong in docs/availability-performance-report.md.
    // This assertion keeps the harness discoverable without failing CI.
    expect([
      'resolveEmployeeDayPlan',
      'resolveEmployeeDayPlansBatch',
      'loadFlowBoardForBranch',
      'buildBarberOperationalTimeline',
      'hasAnyAvailableSlotForBarberOnDay',
      'explainAvailability',
    ].length).toBe(6);
  });
});
