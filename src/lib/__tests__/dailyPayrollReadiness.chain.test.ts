/**
 * Phase 6B — recursive Smart Fix chain (pure).
 */
import { describe, expect, it } from 'vitest';
import {
  applyDiscoveredRootsToParent,
  mapGenerateMissingReasonToBlockerCode,
  mergeDisplayBlockers,
  nestPayrollUnderTargetIfPresent,
  nestRootCause,
  nextAutoContinueBlocker,
  resolutionAttemptKey,
  rootBlockersFromGenerateMissing,
} from '@/lib/hr/dailyPayrollReadiness.chain';
import { buildBlockerFix } from '@/lib/hr/dailyPayrollReadiness.fix';
import type {
  DailyPayrollReadinessBlocker,
  DailyPayrollReadinessResult,
} from '@/lib/hr/dailyPayrollReadiness.types';

function blocker(
  code: DailyPayrollReadinessBlocker['code'],
  empId: number | null,
  branchId = 1,
  workDate = '2026-08-10',
): DailyPayrollReadinessBlocker {
  return {
    code,
    empId,
    empName: empId != null ? `E${empId}` : null,
    message: code,
    fix: buildBlockerFix({ code, branchId, workDate, empId }),
  };
}

describe('mapGenerateMissingReasonToBlockerCode', () => {
  it('maps salary + attendance reasons from backend validate', () => {
    expect(mapGenerateMissingReasonToBlockerCode('no_hourly_rate')).toBe('salary_config_missing');
    expect(mapGenerateMissingReasonToBlockerCode('no_branch_payroll_plan')).toBe(
      'salary_config_missing',
    );
    expect(mapGenerateMissingReasonToBlockerCode('missing_checkout')).toBe('missing_check_out');
    expect(mapGenerateMissingReasonToBlockerCode('missing_checkin')).toBe('missing_check_in');
    expect(mapGenerateMissingReasonToBlockerCode('monthly_excluded')).toBeNull();
  });
});

describe('rootBlockersFromGenerateMissing + nest', () => {
  it('payroll_not_generated → salary_config_missing from missing[]', () => {
    const parent = blocker('payroll_not_generated', 99, 3);
    const roots = rootBlockersFromGenerateMissing({
      missing: [
        { empId: 99, empName: 'زياد', reason: 'no_hourly_rate' },
        { empId: 5, empName: 'أخرى', reason: 'missing_checkout' },
      ],
      branchId: 3,
      workDate: '2026-08-10',
      focusEmpId: 99,
    });
    expect(roots[0].code).toBe('salary_config_missing');
    expect(roots[0].fix.branchId).toBe(3);
    expect(roots[0].fix.employeeId).toBe(99);
    expect(roots[0].fix.type).toBe('payroll_settings');

    const { nested, extras } = applyDiscoveredRootsToParent(parent, roots);
    expect(nested.rootCauseCode).toBe('salary_config_missing');
    expect(nested.causedBy?.code).toBe('salary_config_missing');
    expect(extras.some((e) => e.code === 'missing_check_out')).toBe(true);
  });

  it('payroll_not_generated → missing_checkout nested', () => {
    const parent = blocker('payroll_not_generated', 7);
    const roots = rootBlockersFromGenerateMissing({
      missing: [{ empId: 7, empName: 'م', reason: 'missing_checkout' }],
      branchId: 1,
      workDate: '2026-08-10',
      focusEmpId: 7,
    });
    const { nested } = applyDiscoveredRootsToParent(parent, roots);
    expect(nested.causedBy?.fix.type).toBe('attendance_modal');
  });
});

describe('target → payroll from readiness authority', () => {
  it('nests payroll_not_generated under target when readiness lists it', () => {
    const target = blocker('target_not_generated', 99, 1);
    const readiness = {
      branchId: 1,
      workDate: '2026-08-10',
      blockers: [blocker('payroll_not_generated', 99, 1), target],
    } as DailyPayrollReadinessResult;
    const nested = nestPayrollUnderTargetIfPresent(target, readiness);
    expect(nested.causedBy?.code).toBe('payroll_not_generated');
  });
});

describe('loop prevention + auto-continue', () => {
  it('resolutionAttemptKey is stable', () => {
    const a = resolutionAttemptKey({
      branchId: 1,
      workDate: '2026-08-10',
      empId: 9,
      surfaceCode: 'payroll_not_generated',
      actionType: 'generate_payroll',
      rootCode: 'salary_config_missing',
    });
    const b = resolutionAttemptKey({
      branchId: 1,
      workDate: '2026-08-10',
      empId: 9,
      surfaceCode: 'payroll_not_generated',
      actionType: 'generate_payroll',
      rootCode: 'salary_config_missing',
    });
    expect(a).toBe(b);
  });

  it('nextAutoContinueBlocker skips attempted and prefers generate steps', () => {
    const readiness = {
      persistedState: 'OPEN',
      blockers: [
        blocker('salary_config_missing', 1),
        blocker('payroll_not_generated', 1),
        blocker('target_not_generated', 1),
      ],
    } as DailyPayrollReadinessResult;

    const attempted = new Set<string>();
    const first = nextAutoContinueBlocker(readiness, { preferEmpId: 1, attemptedKeys: attempted });
    expect(first?.code).toBe('payroll_not_generated');

    attempted.add(
      resolutionAttemptKey({
        branchId: 1,
        workDate: '2026-08-10',
        empId: 1,
        surfaceCode: 'payroll_not_generated',
        actionType: 'generate_payroll',
      }),
    );
    const second = nextAutoContinueBlocker(readiness, { preferEmpId: 1, attemptedKeys: attempted });
    expect(second?.code).toBe('target_not_generated');
  });

  it('CLOSED readiness yields no auto-continue', () => {
    const readiness = {
      persistedState: 'CLOSED',
      blockers: [blocker('payroll_not_generated', 1)],
    } as DailyPayrollReadinessResult;
    expect(
      nextAutoContinueBlocker(readiness, { attemptedKeys: new Set() }),
    ).toBeNull();
  });
});

describe('mergeDisplayBlockers', () => {
  it('keeps nested override and adds extras without closing modal list', () => {
    const base = [blocker('payroll_not_generated', 1)];
    const override = nestRootCause(base[0], blocker('salary_config_missing', 1));
    const extras = [blocker('missing_check_out', 2)];
    const merged = mergeDisplayBlockers(base, override, extras);
    expect(merged[0].causedBy?.code).toBe('salary_config_missing');
    expect(merged.some((b) => b.code === 'missing_check_out' && b.empId === 2)).toBe(true);
  });
});
