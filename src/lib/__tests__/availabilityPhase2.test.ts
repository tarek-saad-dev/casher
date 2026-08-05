/**
 * Availability Architecture — Phase 2 focused contract + parity tests.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyOverrides, type ScheduleOverride } from '@/lib/scheduleOverrides';
import { buildEmployeeDayPlanFromInputs } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { mapEmployeeDayPlanToBarberDayStatus } from '@/lib/availability/mapEmployeeDayPlanToBarberDayStatus';
import {
  isLegacyBookingsCreateEnabled,
  LEGACY_BOOKING_CREATE_DISABLED_CODE,
} from '@/lib/availability/legacyBookingCreateFence';
import { inferDayDenyReason } from '@/lib/availability/reasonCodes';

vi.mock('server-only', () => ({}));

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name === '__tests__') continue;
      walkTsFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

describe('Phase 2 — create migration (bookings/new)', () => {
  const page = read('src/app/bookings/new/page.tsx');
  const createSvc = read('src/lib/booking/publicBookingCreate.ts');
  const createRoute = read('src/app/api/public/booking/create/route.ts');
  const legacyRoute = read('src/app/api/bookings/route.ts');

  it('bookings/new does not POST to /api/bookings', () => {
    expect(page).not.toMatch(/fetch\(\s*['"`]\/api\/bookings['"`]\s*,\s*\{[^}]*method:\s*['"]POST['"]/);
    expect(page).not.toMatch(/method:\s*['"]POST['"][\s\S]{0,80}\/api\/bookings/);
  });

  it('POSTs to canonical /api/public/booking/create', () => {
    expect(page).toContain("fetch('/api/public/booking/create'");
    expect(page).toContain("method: 'POST'");
  });

  it('payload includes customer, serviceIds, date, time, empId, mode, source, leadSource', () => {
    expect(page).toContain('customer:');
    expect(page).toContain('serviceIds:');
    expect(page).toContain('date: bookingDate');
    expect(page).toContain('time: startTime');
    expect(page).toContain('empId: selectedBarber.EmpID');
    expect(page).toContain("mode: 'specific'");
    expect(page).toContain("source: 'admin'");
    expect(page).toContain('leadSource: source');
  });

  it('does not send client price, duration, total, or end time in create payload', () => {
    const submit = page.slice(page.indexOf('handleSubmit'));
    const bodyStart = submit.indexOf('JSON.stringify({');
    const bodyChunk = submit.slice(bodyStart, bodyStart + 700);
    expect(bodyChunk).not.toMatch(/\bendTime\b/);
    expect(bodyChunk).not.toMatch(/\btotalPrice\b|\bTotalPrice\b|\bdurationMinutes\b|\bUnitPrice\b|\bprice\b/);
  });

  it('reads success from booking.id and booking.code', () => {
    expect(page).toContain('data?.booking?.id');
    expect(page).toContain('data?.booking?.code');
  });

  it('canonical response exposes booking.id', () => {
    expect(createSvc).toContain('id: args.bookingId');
    expect(createSvc).toContain('code: args.bookingCode');
  });

  it('legacy create remains available behind LEGACY_BOOKINGS_CREATE_ENABLED (default true)', () => {
    expect(isLegacyBookingsCreateEnabled()).toBe(true);
    expect(legacyRoute).toContain('isLegacyBookingsCreateEnabled');
    expect(legacyRoute).toContain(LEGACY_BOOKING_CREATE_DISABLED_CODE);
    expect(legacyRoute).toContain('export async function POST');
  });

  it('leadSource only applied for internal admin/ops sources', () => {
    expect(createSvc).toContain('resolvePersistedBookingSource');
    expect(createSvc).toContain('INTERNAL_LEAD_SOURCES');
    expect(createSvc).toContain("'phone'");
    expect(createSvc).toContain("'walk_in'");
    expect(createRoute).toContain('leadSource');
    // Public callers must not override via leadSource alone
    expect(createRoute).toMatch(/leadSource[\s\S]{0,200}admin|operations/);
  });

  it('no internal production create callers use fetch POST /api/bookings', () => {
    const roots = [join(process.cwd(), 'src/app'), join(process.cwd(), 'src/lib'), join(process.cwd(), 'src/components')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkTsFiles(root)) {
        const src = readFileSync(file, 'utf8');
        if (/fetch\(\s*['"`]\/api\/bookings['"`]\s*,\s*\{[\s\S]*?method:\s*['"]POST['"]/.test(src)) {
          offenders.push(file);
        }
        if (/method:\s*['"]POST['"][\s\S]{0,120}fetch\(\s*['"`]\/api\/bookings['"`]/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Phase 2 — batch day-plan inputs', () => {
  it('shared loader + pure builder exist with expected contract', () => {
    const loader = read('src/lib/availability/loadEmployeeDayPlanInputsBatch.ts');
    const resolver = read('src/lib/availability/resolveEmployeeDayPlan.ts');
    expect(loader).toContain('loadEmployeeDayPlanInputsBatch');
    expect(loader).toContain('loadWorkingWindowsBatch');
    expect(loader).toContain('loadBookingOverridesForDate');
    expect(loader).toContain('dayOffEmpIds');
    expect(loader).toContain('absentEmpIds');
    expect(loader).toContain('ensureEmpBranchWorkScheduleTable');
    expect(loader).toContain('transaction');
    expect(resolver).toContain('buildEmployeeDayPlanFromInputs');
    expect(resolver).toContain('loadEmployeeDayPlanInputsBatch');
    expect(resolver).toContain('transaction?:');
  });

  it('batch resolver calls shared loader once (source contract)', () => {
    const resolver = read('src/lib/availability/resolveEmployeeDayPlan.ts');
    const batchFn = resolver.slice(resolver.indexOf('export async function resolveEmployeeDayPlansBatch'));
    const loaderCalls = batchFn.match(/loadEmployeeDayPlanInputsBatch\(/g) ?? [];
    expect(loaderCalls.length).toBe(1);
  });

  it('one-by-one and pure builder parity for day_off / absent / custom hours', () => {
    const baseInputs = (overrides: ScheduleOverride[]): EmployeeDayPlanBatchInputs => ({
      windowsMap: new Map([
        [1, { isWorkingDay: true, startTime: '10:00', endTime: '18:00', source: 'BRANCH_WEEKLY' }],
      ]),
      overridesMap: new Map([[1, overrides]]),
      freelanceUnlocks: new Map(),
      attendanceMap: new Map(),
      dayOffEmpIds: new Set(),
      absentEmpIds: new Set(),
      timezone: 'Africa/Cairo',
      dailyAdjustmentsMap: new Map(),
    });

    const dayOff = buildEmployeeDayPlanFromInputs({
      empId: 1,
      branchId: 7,
      businessDate: '2026-08-03',
      inputs: baseInputs([
        {
          OverrideID: 1,
          EmpID: 1,
          OverrideDate: '2026-08-03',
          Type: 'day_off',
          StartTime: null,
          EndTime: null,
          Reason: 'إجازة',
          IsActive: true,
          CreatedAt: '2026-08-01T00:00:00Z',
          CreatedBy: 'test',
        },
      ]),
    });
    expect(dayOff.isWorking).toBe(false);
    expect(dayOff.denyReasonCode).toBe('EMPLOYEE_OFF_DAY');

    const absentInputs = baseInputs([]);
    absentInputs.absentEmpIds.add(1);
    absentInputs.attendanceMap.set(1, { status: 'Absent', checkInTime: null, checkOutTime: null });
    const absent = buildEmployeeDayPlanFromInputs({
      empId: 1,
      branchId: 7,
      businessDate: '2026-08-03',
      inputs: absentInputs,
    });
    expect(absent.isWorking).toBe(false);
    expect(absent.denyReasonCode).toBe('EMPLOYEE_ABSENT');

    const late = buildEmployeeDayPlanFromInputs({
      empId: 1,
      branchId: 7,
      businessDate: '2026-08-03',
      inputs: baseInputs([
        {
          OverrideID: 2,
          EmpID: 1,
          OverrideDate: '2026-08-03',
          Type: 'late_start',
          StartTime: '12:00',
          EndTime: null,
          Reason: null,
          IsActive: true,
          CreatedAt: '2026-08-01T00:00:00Z',
          CreatedBy: 'test',
        },
      ]),
    });
    expect(late.isWorking).toBe(true);
    expect(late.effSched?.start).toBe('12:00');
    expect(late.effSched?.end).toBe('18:00');
  });

  it('empty schedule → SCHEDULE_NOT_CONFIGURED', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 9,
      branchId: 1,
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
    expect(plan.denyReasonCode).toBe('SCHEDULE_NOT_CONFIGURED');
    expect(inferDayDenyReason({ contextsEmpty: true, scheduleMissing: true })).toBe(
      'SCHEDULE_NOT_CONFIGURED',
    );
  });
});

describe('Phase 2 — day status mapper parity', () => {
  it('maps day_off / absent / overnight / block_range flags', () => {
    const workingInputs: EmployeeDayPlanBatchInputs = {
      windowsMap: new Map([
        [1, { isWorkingDay: true, startTime: '15:00', endTime: '02:00', source: 'BRANCH_WEEKLY' }],
      ]),
      overridesMap: new Map([
        [
          1,
          [
            {
              OverrideID: 3,
              EmpID: 1,
              OverrideDate: '2026-08-03',
              Type: 'block_range',
              StartTime: '16:00',
              EndTime: '17:00',
              Reason: 'استراحة',
              IsActive: true,
              CreatedAt: '2026-08-01T00:00:00Z',
              CreatedBy: 'test',
            },
          ],
        ],
      ]),
      freelanceUnlocks: new Map(),
      attendanceMap: new Map(),
      dayOffEmpIds: new Set(),
      absentEmpIds: new Set(),
      timezone: 'Africa/Cairo',
      dailyAdjustmentsMap: new Map(),
    };
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 1,
      branchId: 2,
      businessDate: '2026-08-03',
      inputs: workingInputs,
    });
    expect(plan.isOvernight).toBe(true);
    expect(plan.effSched?.blockedIntervals.length).toBeGreaterThan(0);

    const status = mapEmployeeDayPlanToBarberDayStatus({ plan, isToday: false });
    expect(status.isWorkingDay).toBe(true);
    expect(status.effectiveStart).toBe('15:00');
    expect(status.effectiveEnd).toBe('02:00');
    expect(status.effectiveSchedule.blockedIntervals.length).toBeGreaterThan(0);
  });

  it('getBarberDayStatus / batch use resolveEmployeeDayPlan(s)', () => {
    const eng = read('src/lib/availabilityEngine.ts');
    expect(eng).toContain('resolveEmployeeDayPlan');
    expect(eng).toContain('resolveEmployeeDayPlansBatch');
    expect(eng).toContain('mapEmployeeDayPlanToBarberDayStatus');
    expect(eng).toContain('branchId?: number');
  });
});

describe('Phase 2 — queue/timeline/reschedule readers', () => {
  it('timeline and estimate use resolveEmployeeDayPlan', () => {
    const timeline = read('src/lib/operationsQueueTimeline.ts');
    const estimate = read('src/lib/queueEstimateEngine.ts');
    expect(timeline).toContain('resolveEmployeeDayPlan');
    expect(timeline).not.toContain('getBarberWorkingWindow');
    expect(estimate).toContain('resolveEmployeeDayPlan');
    expect(estimate).toContain('blockedIntervals');
    const hasAny = estimate.slice(estimate.indexOf('hasAnyAvailableSlotForBarberOnDay'));
    expect(hasAny).not.toContain('getBarberWorkingWindow');
  });

  it('reschedule uses day plan; local applyOverrides path removed', () => {
    const core = read('src/lib/bookingRescheduleCore.ts');
    expect(core).toContain('resolveEmployeeDayPlan');
    expect(core).toContain('branchId: booking.branchId');
    expect(core).toContain('excludeBookingId: bookingId');
    expect(core).toContain('assertEmployeeIntervalAvailable');
    expect(core).not.toContain('applyOverrides(');
    expect(core).not.toContain('getBarberWorkingWindow');
    expect(core).not.toMatch(/FROM\s+\[dbo\]\.\[TblEmpWorkSchedule\]/);
    expect(core).toContain('dayPlanDenyToMoveCode');
  });

  it('empty-slot reasons use resolveEmployeeDayPlansBatch', () => {
    const eng = read('src/lib/bookingAvailabilityEngine.ts');
    expect(eng).toContain('resolveEmployeeDayPlansBatch');
    expect(eng).toContain('candidateEmpIds');
    expect(eng).toContain('denyReasonCode');
  });
});

describe('Phase 2 — applyOverrides still used for day-plan builder (not duplicated in reschedule)', () => {
  it('late_start + early_leave compose like applyOverrides', () => {
    const base = { isWorking: true, start: '10:00', end: '18:00' };
    const overrides: ScheduleOverride[] = [
      {
        OverrideID: 1,
        EmpID: 1,
        OverrideDate: '2026-08-03',
        Type: 'late_start',
        StartTime: '11:00',
        EndTime: null,
        Reason: null,
        IsActive: true,
        CreatedAt: '2026-08-01T00:00:00Z',
        CreatedBy: 'test',
      },
      {
        OverrideID: 2,
        EmpID: 1,
        OverrideDate: '2026-08-03',
        Type: 'early_leave',
        StartTime: null,
        EndTime: '16:00',
        Reason: null,
        IsActive: true,
        CreatedAt: '2026-08-01T00:00:00Z',
        CreatedBy: 'test',
      },
    ];
    const eff = applyOverrides(1, '2026-08-03', base, overrides);
    expect(eff.start).toBe('11:00');
    expect(eff.end).toBe('16:00');
  });
});
