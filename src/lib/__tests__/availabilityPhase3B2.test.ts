/**
 * Availability Architecture — Phase 3B.2: Layers Inspector.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import { buildEmployeeDayPlanFromInputs } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { explainEmployeeDayPlan } from '@/lib/availability/explainAvailability';
import {
  AVAILABILITY_LAYER_ORDER,
  buildAvailabilityLayers,
  DEFAULT_WORKFORCE_LAYER_PERMISSIONS,
  type WorkforceLayerPermissions,
} from '@/lib/availability/buildAvailabilityLayers';
import {
  materializeAdjustmentWindow,
  type EmployeeDailyAdjustment,
} from '@/lib/availability/dailyAdjustments';
import { SALON_TZ } from '@/lib/businessDate';
import type { ScheduleOverride } from '@/lib/scheduleOverrides';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const DATE = '2026-08-03';
const TZ = SALON_TZ;

function win(start: string, end: string, endDayOffset: 0 | 1 = 0) {
  const m = materializeAdjustmentWindow(DATE, { start, end, endDayOffset }, TZ);
  if (!m) throw new Error('bad window');
  return m;
}

function adj(
  partial: Partial<EmployeeDailyAdjustment> &
    Pick<EmployeeDailyAdjustment, 'adjustmentId' | 'adjustmentType'>,
): EmployeeDailyAdjustment {
  return {
    branchId: 1,
    employeeId: 10,
    businessDate: DATE,
    reasonCode: null,
    reasonText: null,
    source: 'admin',
    windows: [],
    createdBy: 1,
    createdAt: `2026-08-03T10:0${partial.adjustmentId % 10}:00Z`,
    version: 1,
    ...partial,
  };
}

function baseInputs(
  overrides: Partial<EmployeeDayPlanBatchInputs> = {},
): EmployeeDayPlanBatchInputs {
  return {
    windowsMap: new Map([
      [10, { isWorkingDay: true, startTime: '11:00', endTime: '23:00', source: 'BRANCH_WEEKLY' }],
    ]),
    overridesMap: new Map(),
    freelanceUnlocks: new Map(),
    attendanceMap: new Map(),
    dayOffEmpIds: new Set(),
    absentEmpIds: new Set(),
    timezone: TZ,
    dailyAdjustmentsMap: new Map(),
    ...overrides,
  };
}

function buildLayers(
  inputs: EmployeeDayPlanBatchInputs,
  extra?: {
    employmentType?: string;
    permissions?: WorkforceLayerPermissions;
    transfer?: import('@/lib/availability/buildAvailabilityLayers').TransferMeta;
    isActive?: boolean;
  },
) {
  const plan = buildEmployeeDayPlanFromInputs({
    empId: 10,
    branchId: 1,
    businessDate: DATE,
    inputs,
  });
  const explanation = explainEmployeeDayPlan(plan);
  const layers = buildAvailabilityLayers({
    employee: {
      employeeId: 10,
      employeeName: 'أحمد',
      job: 'حلاق',
      isActive: extra?.isActive ?? true,
      employmentType: extra?.employmentType ?? 'full_time',
      assignment: {
        branchId: 1,
        branchName: 'جليم',
        isAssignedToActiveBranch: true,
      },
      transfer: extra?.transfer ?? { direction: 'none' },
    },
    dayPlan: plan,
    explanation,
    activeAdjustments: plan.dailyAdjustments,
    permissions: extra?.permissions ?? DEFAULT_WORKFORCE_LAYER_PERMISSIONS,
    activeBranchId: 1,
    activeBranchName: 'جليم',
  });
  return { plan, explanation, layers };
}

describe('Phase 3B.2 — layer builder order and basics', () => {
  it('emits seven layers in canonical order', () => {
    const { layers } = buildLayers(baseInputs());
    expect(layers.map((l) => l.key)).toEqual(AVAILABILITY_LAYER_ORDER);
    expect(layers.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const layer of layers) {
      expect(layer.actions.some((a) => a.actionType === 'OPEN_LAYER_CONTROL')).toBe(
        true,
      );
    }
  });

  it('displays weekly schedule and employment type', () => {
    const { layers } = buildLayers(baseInputs(), { employmentType: 'freelance' });
    const emp = layers.find((l) => l.key === 'EMPLOYMENT')!;
    const base = layers.find((l) => l.key === 'BASE_SCHEDULE')!;
    expect(emp.summaryAr).toContain('فري لانس');
    // Employment does not open windows — no empty "unavailable" snapshot.
    expect(emp.snapshot == null || emp.snapshot.afterWindows.length === 0).toBe(true);
    expect(emp.snapshot?.effectCode ?? null).toBeNull();
    expect(base.sourceCode).toBe('BRANCH_WEEKLY');
    expect(base.summaryAr).toMatch(/11:00/);
    expect(base.descriptionAr).toContain('كل أسبوع');
    expect(base.snapshot?.afterWindows.length).toBeGreaterThan(0);
  });

  it('employment layer points operators to base schedule for windows', () => {
    const { layers } = buildLayers(baseInputs(), { employmentType: 'full_time' });
    const emp = layers.find((l) => l.key === 'EMPLOYMENT')!;
    expect(emp.status).toBe('APPLIED');
    expect(emp.effectAr).toContain('الجدول الأساسي للفرع');
    expect(emp.snapshot).toBeNull();
  });

  it('weekly off-day decision points to BASE_SCHEDULE with clear Arabic', () => {
    const { layers, plan } = buildLayers(
      baseInputs({
        windowsMap: new Map([
          [10, { isWorkingDay: false, startTime: null, endTime: null, source: 'BRANCH_WEEKLY' }],
        ]),
      }),
    );
    expect(plan.denyReasonCode).toBe('EMPLOYEE_OFF_DAY');
    const base = layers.find((l) => l.key === 'BASE_SCHEDULE')!;
    const final = layers.find((l) => l.key === 'FINAL_RESULT')!;
    expect(base.isDecidingCause).toBe(true);
    expect(base.summaryAr).toContain('إجازة أسبوعية');
    const decision = final.data.decision as {
      decidingLayerKey: string;
      summaryAr: string;
      whyAr: string[];
      outcomeKey: string;
    };
    expect(decision.decidingLayerKey).toBe('BASE_SCHEDULE');
    expect(decision.outcomeKey).toBe('day_off');
    expect(decision.summaryAr).toContain('إجازة');
  });

  it('scheduled elsewhere is not labeled as a true day off', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        windowsMap: new Map([
          [10, { isWorkingDay: false, startTime: null, endTime: null, source: 'BRANCH_WEEKLY' }],
        ]),
      }),
    });
    const explanation = explainEmployeeDayPlan(plan);
    const layers = buildAvailabilityLayers({
      employee: {
        employeeId: 10,
        employeeName: 'زياد',
        job: 'حلاق',
        isActive: true,
        employmentType: 'full_time',
        assignment: {
          branchId: 1,
          branchName: 'جليم',
          isAssignedToActiveBranch: true,
        },
        transfer: { direction: 'none' },
        scheduledElsewhere: {
          branchId: 3,
          branchCode: 'CAMP_CAESAR',
          branchName: 'كامب شيزار',
          startTime: '13:00',
          endTime: '00:00',
        },
      },
      dayPlan: plan,
      explanation,
      activeAdjustments: [],
      permissions: DEFAULT_WORKFORCE_LAYER_PERMISSIONS,
      activeBranchId: 1,
      activeBranchName: 'جليم',
    });
    const base = layers.find((l) => l.key === 'BASE_SCHEDULE')!;
    const final = layers.find((l) => l.key === 'FINAL_RESULT')!;
    const decision = final.data.decision as {
      outcomeKey: string;
      summaryAr: string;
      whyAr: string[];
    };
    expect(base.sourceCode).toBe('SCHEDULED_ELSEWHERE');
    expect(base.summaryAr).toContain('كامب شيزار');
    expect(decision.outcomeKey).toBe('scheduled_elsewhere');
    expect(decision.summaryAr).toContain('كامب شيزار');
    expect(decision.whyAr.join(' ')).toContain('ليس إجازة');
  });

  it('transfer-in / transfer-away / freelance unlock / no data', () => {
    const inL = buildLayers(baseInputs({
      windowsMap: new Map([
        [10, { isWorkingDay: true, startTime: '12:00', endTime: '20:00', source: 'TEMPORARY_TRANSFER' }],
      ]),
    }), { transfer: { direction: 'in', toBranchId: 1, startTime: '12:00', endTime: '20:00' } });
    expect(inL.layers.find((l) => l.key === 'TRANSFER_OR_FREELANCE')!.status).toBe('APPLIED');

    const away = buildLayers(baseInputs(), {
      transfer: { direction: 'away', toBranchId: 2, toBranchName: 'سموحة' },
    });
    expect(away.layers.find((l) => l.key === 'TRANSFER_OR_FREELANCE')!.status).toBe('BLOCKING');

    const free = buildLayers(baseInputs({
      windowsMap: new Map(),
      freelanceUnlocks: new Map([[10, { start: '14:00', end: '22:00' }]]),
    }));
    expect(free.plan.baseScheduleSource).toBe('FREELANCE_UNLOCK');
    expect(free.layers.find((l) => l.key === 'TRANSFER_OR_FREELANCE')!.status).toBe('APPLIED');

    const none = buildLayers(baseInputs());
    expect(none.layers.find((l) => l.key === 'TRANSFER_OR_FREELANCE')!.status).toBe('NO_DATA');
  });
});

describe('Phase 3B.2 — legacy / attendance / daily', () => {
  it('legacy override applied and overridden by daily', () => {
    const override: ScheduleOverride = {
      OverrideID: 1,
      EmpID: 10,
      OverrideDate: DATE,
      Type: 'custom_hours',
      StartTime: '13:00',
      EndTime: '18:00',
      Reason: 'test',
      IsActive: true,
      CreatedAt: '2026-08-03T09:00:00Z',
      CreatedBy: 'admin',
    };
    const applied = buildLayers(baseInputs({
      overridesMap: new Map([[10, [override]]]),
    }));
    expect(applied.layers.find((l) => l.key === 'LEGACY_OVERRIDES')!.status).toBe('APPLIED');

    const overridden = buildLayers(baseInputs({
      overridesMap: new Map([[10, [override]]]),
      dailyAdjustmentsMap: new Map([
        [10, [adj({ adjustmentId: 1, adjustmentType: 'REPLACE_WINDOWS', windows: [win('16:00', '22:00')] })]],
      ]),
    }));
    expect(overridden.layers.find((l) => l.key === 'LEGACY_OVERRIDES')!.status).toBe('OVERRIDDEN');
  });

  it('attendance present informational; absent blocking', () => {
    const present = buildLayers(baseInputs({
      attendanceMap: new Map([[10, { status: 'Present', checkInTime: '11:05', checkOutTime: null }]]),
    }));
    expect(present.layers.find((l) => l.key === 'ATTENDANCE')!.status).toBe('INFORMATIONAL');

    const absent = buildLayers(baseInputs({
      absentEmpIds: new Set([10]),
      attendanceMap: new Map([[10, { status: 'Absent', checkInTime: null, checkOutTime: null }]]),
    }));
    expect(absent.plan.denyReasonCode).toBe('EMPLOYEE_ABSENT');
    expect(absent.layers.find((l) => l.key === 'ATTENDANCE')!.status).toBe('BLOCKING');
    expect(absent.layers.find((l) => l.key === 'FINAL_RESULT')!.status).toBe('BLOCKING');
  });

  it('daily close, reopen via add, replace, block', () => {
    const closed = buildLayers(baseInputs({
      dailyAdjustmentsMap: new Map([
        [10, [adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' })]],
      ]),
    }));
    expect(closed.layers.find((l) => l.key === 'DAILY_ADJUSTMENTS')!.status).toBe('BLOCKING');

    const reopen = buildLayers(baseInputs({
      dailyAdjustmentsMap: new Map([
        [
          10,
          [
            adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY', createdAt: '2026-08-03T10:00:00Z' }),
            adj({
              adjustmentId: 2,
              adjustmentType: 'ADD_WINDOW',
              windows: [win('18:00', '22:00')],
              createdAt: '2026-08-03T11:30:00Z',
            }),
          ],
        ],
      ]),
    }));
    expect(reopen.plan.isWorking).toBe(true);
    expect(reopen.layers.find((l) => l.key === 'DAILY_ADJUSTMENTS')!.data.chronologyAr).toBeTruthy();

    const replaced = buildLayers(baseInputs({
      dailyAdjustmentsMap: new Map([
        [10, [adj({ adjustmentId: 3, adjustmentType: 'REPLACE_WINDOWS', windows: [win('12:00', '16:00')] })]],
      ]),
    }));
    expect(replaced.plan.effectiveWindows[0]?.start).toBe('12:00');

    const blocked = buildLayers(baseInputs({
      dailyAdjustmentsMap: new Map([
        [10, [adj({ adjustmentId: 4, adjustmentType: 'BLOCK_WINDOW', windows: [win('15:00', '16:00')] })]],
      ]),
    }));
    expect(blocked.explanation.blockedIntervals.length).toBeGreaterThan(0);
  });
});

describe('Phase 3B.2 — snapshots and explain layers', () => {
  it('explain layers include snapshots without extra resolver', () => {
    const { explanation, plan } = buildLayers(baseInputs({
      dailyAdjustmentsMap: new Map([
        [10, [adj({ adjustmentId: 1, adjustmentType: 'REPLACE_WINDOWS', windows: [win('14:00', '20:00')] })]],
      ]),
    }));
    expect(explanation.layers).toHaveLength(7);
    const daily = explanation.layers.find((l) => l.key === 'DAILY_ADJUSTMENTS')!;
    expect(daily.snapshot?.beforeWindows.length).toBeGreaterThan(0);
    expect(daily.snapshot?.afterWindows[0]?.start).toBe('14:00');
    expect(explanation.plan).toBe(plan);
    expect(explanation.evaluationTimeline.length).toBeGreaterThan(0);
  });

  it('absence snapshot clears windows', () => {
    const { explanation } = buildLayers(baseInputs({
      absentEmpIds: new Set([10]),
    }));
    const att = explanation.layers.find((l) => l.key === 'ATTENDANCE')!;
    expect(att.snapshot?.availabilityAfter).toBe(false);
    expect(att.effectCode).toBe('EMPLOYEE_ABSENT');
  });
});

describe('Phase 3B.2 — controls and permissions', () => {
  it('disables daily actions without permission; final has no mutation modal', () => {
    const perms: WorkforceLayerPermissions = {
      ...DEFAULT_WORKFORCE_LAYER_PERMISSIONS,
      canEditDailyAdjustments: false,
      canEditWeeklySchedule: false,
      canManageAttendance: false,
      canCancelLegacyOverrides: false,
    };
    const { layers } = buildLayers(baseInputs(), { permissions: perms });
    const daily = layers.find((l) => l.key === 'DAILY_ADJUSTMENTS')!;
    expect(daily.actions.filter((a) => a.key.startsWith('adj_')).every((a) => !a.enabled)).toBe(
      true,
    );
    expect(daily.actions[0]!.disabledReasonAr).toBeTruthy();

    const weekly = layers.find((l) => l.key === 'BASE_SCHEDULE')!;
    const weeklyControl = weekly.actions.find((a) => a.key === 'control_BASE_SCHEDULE')!;
    expect(weeklyControl.enabled).toBe(false);
    expect(weeklyControl.disabledReasonAr).toBeTruthy();
    expect(weekly.actions.find((a) => a.key === 'manage_weekly')).toBeUndefined();

    const final = layers.find((l) => l.key === 'FINAL_RESULT')!;
    expect(final.actions.every((a) => a.actionType !== 'OPEN_MODAL')).toBe(true);

    const legacy = layers.find((l) => l.key === 'LEGACY_OVERRIDES')!;
    expect(legacy.actions.some((a) => a.key === 'legacy_create_disabled' && !a.enabled)).toBe(
      true,
    );
  });
});

describe('Phase 3B.2 — UI contracts', () => {
  it('inspector and layers exist with Arabic-first copy', () => {
    const inspector = read(
      'src/components/admin/workforce/layers/AvailabilityLayersInspector.tsx',
    );
    const drawer = read('src/components/admin/workforce/AvailabilityExplainDrawer.tsx');
    const builder = read('src/lib/availability/buildAvailabilityLayers.ts');
    expect(inspector).toContain('طبقات توافر الموظف');
    expect(inspector).toContain('AvailabilityDayTimeline');
    expect(inspector).toContain('dir="rtl"');
    expect(drawer).toContain('AvailabilityLayersInspector');
    expect(builder).not.toContain('monthlySalary');
    expect(builder).not.toContain('ManualHourlyRate');
    expect(builder).toContain('نظام قديم');
    expect(read('src/lib/availability/workforceDay.ts')).toContain('buildAvailabilityLayers');
    expect(read('src/lib/availability/workforceDay.ts')).toContain('resolveEmployeeDayPlansBatch');
  });

  it('blocking and final auto-expand flags', () => {
    const { layers } = buildLayers(baseInputs({
      absentEmpIds: new Set([10]),
    }));
    expect(layers.find((l) => l.key === 'ATTENDANCE')!.defaultExpanded).toBe(true);
    expect(layers.find((l) => l.key === 'FINAL_RESULT')!.emphasized).toBe(true);
    expect(layers.find((l) => l.key === 'FINAL_RESULT')!.defaultExpanded).toBe(true);
  });
});
