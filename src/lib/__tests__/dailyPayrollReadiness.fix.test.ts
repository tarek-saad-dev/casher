/**
 * Phase 6 — blocker → fix descriptor mapping (pure).
 */
import { describe, expect, it } from 'vitest';
import {
  attachFixesToBlockers,
  buildBlockerFix,
  fixTypeForBlockerCode,
} from '@/lib/hr/dailyPayrollReadiness.fix';
import {
  buildReadinessFromFacts,
  classifyEmployeeReadiness,
  type ReadinessEmployeeFacts,
} from '@/lib/hr/dailyPayrollReadiness.recommend';
import { DAILY_PAYROLL_READINESS_BLOCKER_CODES } from '@/lib/hr/dailyPayrollReadiness.types';

function baseFacts(over: Partial<ReadinessEmployeeFacts> = {}): ReadinessEmployeeFacts {
  return {
    empId: 99,
    empName: 'زياد',
    hasAttendance: true,
    hasOpenSession: false,
    hasAnyCheckIn: true,
    netMinutes: 480,
    expectsPayroll: true,
    payrollGenerated: true,
    payrollId: 10,
    dailyWage: 200,
    expectsTarget: true,
    targetGenerated: true,
    targetId: 20,
    targetAmount: 50,
    payrollLedgerPresent: true,
    targetSyncStatus: 'up_to_date',
    validationReason: null,
    validationIsHardMissing: false,
    ...over,
  };
}

describe('dailyPayrollReadiness.fix', () => {
  it('maps every blocker code to a fix type', () => {
    for (const code of DAILY_PAYROLL_READINESS_BLOCKER_CODES) {
      expect(fixTypeForBlockerCode(code)).toBeTruthy();
    }
  });

  it('attendance gaps → attendance_modal with emp/branch/date', () => {
    const fix = buildBlockerFix({
      code: 'missing_check_out',
      branchId: 3,
      workDate: '2026-08-10',
      empId: 99,
    });
    expect(fix.type).toBe('attendance_modal');
    expect(fix.branchId).toBe(3);
    expect(fix.workDate).toBe('2026-08-10');
    expect(fix.employeeId).toBe(99);
    expect(fix.targetUrl).toContain('tab=attendance');
    expect(fix.targetUrl).toContain('branchId=3');
  });

  it('salary_config_missing → payroll_settings branch-schedule URL', () => {
    const fix = buildBlockerFix({
      code: 'salary_config_missing',
      branchId: 1,
      workDate: '2026-08-10',
      empId: 42,
    });
    expect(fix.type).toBe('payroll_settings');
    expect(fix.targetUrl).toBe('/admin/hr?tab=employees&empId=42');
  });

  it('payroll / target / sync / ledger fix types', () => {
    expect(buildBlockerFix({ code: 'payroll_not_generated', branchId: 1, workDate: '2026-08-10', empId: 1 }).type).toBe(
      'generate_payroll',
    );
    expect(buildBlockerFix({ code: 'target_not_generated', branchId: 1, workDate: '2026-08-10', empId: 1 }).type).toBe(
      'generate_target',
    );
    expect(buildBlockerFix({ code: 'target_sync_failed', branchId: 1, workDate: '2026-08-10', empId: 1 }).type).toBe(
      'retry_target_sync',
    );
    const ledger = buildBlockerFix({
      code: 'payroll_ledger_missing',
      branchId: 1,
      workDate: '2026-08-10',
      empId: 1,
    });
    expect(ledger.type).toBe('ledger_reconciliation');
    expect(ledger.targetUrl).toContain('employee-ledger-reconciliation');
  });

  it('attachFixesToBlockers fills missing fix', () => {
    const out = attachFixesToBlockers(
      [{ code: 'open_attendance_session', empId: 7, empName: 'أ', message: 'x' }],
      { branchId: 2, workDate: '2026-08-11' },
    );
    expect(out[0].fix.type).toBe('attendance_modal');
    expect(out[0].fix.employeeId).toBe(7);
  });
});

describe('salary_config_missing from existing validate reasons', () => {
  it('no_hourly_rate hard-missing → salary_config_missing (not payroll_not_generated)', () => {
    const { blockers } = classifyEmployeeReadiness(
      baseFacts({
        payrollGenerated: false,
        targetGenerated: false,
        expectsTarget: false,
        validationReason: 'no_hourly_rate',
        validationIsHardMissing: true,
      }),
    );
    expect(blockers).toContain('salary_config_missing');
    expect(blockers).not.toContain('payroll_not_generated');
  });

  it('buildReadinessFromFacts attaches fix for salary_config_missing', () => {
    const r = buildReadinessFromFacts({
      branchId: 3,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب',
      workDate: '2026-08-10',
      persistedState: 'OPEN',
      isVirtualOpen: true,
      facts: [
        baseFacts({
          payrollGenerated: false,
          targetGenerated: false,
          expectsTarget: false,
          validationReason: 'no_branch_payroll_plan',
          validationIsHardMissing: true,
          payrollLedgerPresent: null,
        }),
      ],
      payrollRowCount: 0,
      targetRowCount: 0,
      totalHours: 0,
      totalWage: 0,
      totalTargetAmount: 0,
      elapsedMs: 1,
    });
    const b = r.blockers.find((x) => x.code === 'salary_config_missing');
    expect(b?.fix.type).toBe('payroll_settings');
    expect(b?.fix.branchId).toBe(3);
    expect(b?.fix.employeeId).toBe(99);
    expect(b?.fix.targetUrl).toContain('/admin/hr?tab=employees&empId=99');
  });
});
