/**
 * Phase 2 — Daily payroll readiness engine (pure rules + contract).
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  buildReadinessFromFacts,
  classifyEmployeeReadiness,
  mapValidationReasonToReadinessBlocker,
  recommendCloseState,
  shortBlockerSummary,
  type ReadinessEmployeeFacts,
} from '@/lib/hr/dailyPayrollReadiness.recommend';

const root = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function baseFacts(over: Partial<ReadinessEmployeeFacts> = {}): ReadinessEmployeeFacts {
  return {
    empId: 1,
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

describe('dailyPayrollReadiness recommend', () => {
  it('maps missing checkout → missing_check_out and recommends NEEDS_REVIEW', () => {
    expect(mapValidationReasonToReadinessBlocker('missing_checkout')).toBe('missing_check_out');
    const { blockers } = classifyEmployeeReadiness(
      baseFacts({
        payrollGenerated: false,
        targetGenerated: false,
        expectsTarget: false,
        validationReason: 'missing_checkout',
        validationIsHardMissing: true,
        hasOpenSession: false,
        expectsPayroll: true,
      }),
    );
    expect(blockers).toContain('missing_check_out');
    expect(
      recommendCloseState({
        persistedState: 'OPEN',
        blockerCount: 1,
        hasActivity: true,
        allRequiredComplete: false,
      }),
    ).toBe('NEEDS_REVIEW');
  });

  it('open attendance session is a blocker', () => {
    const { blockers } = classifyEmployeeReadiness(
      baseFacts({
        hasOpenSession: true,
        payrollGenerated: false,
        targetGenerated: false,
        expectsTarget: false,
      }),
    );
    expect(blockers).toContain('open_attendance_session');
    expect(blockers).not.toContain('payroll_not_generated');
  });

  it('payroll / target / ledger / sync blockers', () => {
    expect(
      classifyEmployeeReadiness(
        baseFacts({ payrollGenerated: false, expectsTarget: false, payrollLedgerPresent: null }),
      ).blockers,
    ).toContain('payroll_not_generated');

    expect(
      classifyEmployeeReadiness(
        baseFacts({ targetGenerated: false, payrollLedgerPresent: true }),
      ).blockers,
    ).toContain('target_not_generated');

    expect(
      classifyEmployeeReadiness(baseFacts({ payrollLedgerPresent: false })).blockers,
    ).toContain('payroll_ledger_missing');

    expect(
      classifyEmployeeReadiness(baseFacts({ targetSyncStatus: 'failed' })).blockers,
    ).toContain('target_sync_failed');

    expect(
      classifyEmployeeReadiness(baseFacts({ targetSyncStatus: 'pending' })).blockers,
    ).toContain('target_sync_pending');
  });

  it('fully valid day → READY_TO_CLOSE', () => {
    const gleem = buildReadinessFromFacts({
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      workDate: '2026-08-11',
      persistedState: 'OPEN',
      isVirtualOpen: true,
      facts: [baseFacts({ empId: 1, empName: 'زياد' })],
      payrollRowCount: 1,
      targetRowCount: 1,
      totalHours: 8,
      totalWage: 200,
      totalTargetAmount: 50,
      elapsedMs: 12,
    });
    expect(gleem.recommendedState).toBe('READY_TO_CLOSE');
    expect(gleem.readyToClose).toBe(true);
    expect(gleem.summary.blockerCount).toBe(0);
  });

  it('GLEEM ready while Camp blocked on same date (independent facts)', () => {
    const workDate = '2026-08-11';
    const gleem = buildReadinessFromFacts({
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      workDate,
      persistedState: 'OPEN',
      isVirtualOpen: true,
      facts: [baseFacts({ empId: 99, empName: 'زياد' })],
      payrollRowCount: 1,
      targetRowCount: 1,
      totalHours: 8,
      totalWage: 200,
      totalTargetAmount: 50,
      elapsedMs: 10,
    });
    const camp = buildReadinessFromFacts({
      branchId: 3,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب شيزار',
      workDate,
      persistedState: 'OPEN',
      isVirtualOpen: true,
      facts: [
        baseFacts({
          empId: 99,
          empName: 'زياد',
          hasOpenSession: true,
          payrollGenerated: false,
          targetGenerated: false,
          expectsTarget: false,
          payrollLedgerPresent: null,
        }),
      ],
      payrollRowCount: 0,
      targetRowCount: 0,
      totalHours: 0,
      totalWage: 0,
      totalTargetAmount: 0,
      elapsedMs: 11,
    });
    expect(gleem.readyToClose).toBe(true);
    expect(camp.recommendedState).toBe('NEEDS_REVIEW');
    expect(camp.blockers.some((b) => b.code === 'open_attendance_session')).toBe(true);
    const campFix = camp.blockers.find((b) => b.code === 'open_attendance_session')?.fix;
    expect(campFix?.type).toBe('attendance_modal');
    expect(campFix?.branchId).toBe(3);
    expect(campFix?.employeeId).toBe(99);
  });

  it('Ziad evaluated independently per branch', () => {
    const g = classifyEmployeeReadiness(
      baseFacts({ empId: 99, payrollGenerated: true, targetGenerated: true }),
    );
    const c = classifyEmployeeReadiness(
      baseFacts({
        empId: 99,
        payrollGenerated: false,
        expectsTarget: false,
        payrollLedgerPresent: null,
      }),
    );
    expect(g.blockers).toHaveLength(0);
    expect(c.blockers).toContain('payroll_not_generated');
  });

  it('persisted CLOSED stays CLOSED; REOPENED keeps readiness recommendation', () => {
    expect(
      recommendCloseState({
        persistedState: 'CLOSED',
        blockerCount: 0,
        hasActivity: true,
        allRequiredComplete: true,
      }),
    ).toBe('CLOSED');

    expect(
      recommendCloseState({
        persistedState: 'REOPENED',
        blockerCount: 2,
        hasActivity: true,
        allRequiredComplete: false,
      }),
    ).toBe('NEEDS_REVIEW');

    expect(
      recommendCloseState({
        persistedState: 'REOPENED',
        blockerCount: 0,
        hasActivity: true,
        allRequiredComplete: true,
      }),
    ).toBe('READY_TO_CLOSE');
  });

  it('invalid_work_hours only for negative net minutes anomaly', () => {
    const { blockers } = classifyEmployeeReadiness(
      baseFacts({ netMinutes: -1, expectsTarget: false }),
    );
    expect(blockers).toContain('invalid_work_hours');
  });

  it('schedule exclusion is warning, not hard blocker alone', () => {
    const { blockers, warnings } = classifyEmployeeReadiness(
      baseFacts({
        expectsPayroll: false,
        payrollGenerated: false,
        expectsTarget: false,
        hasAttendance: false,
        hasAnyCheckIn: false,
        payrollLedgerPresent: null,
        targetSyncStatus: 'none',
        validationReason: 'not_scheduled_working_day',
        validationIsHardMissing: false,
      }),
    );
    expect(blockers).toHaveLength(0);
    expect(warnings.some((w) => w.code === 'not_scheduled_working_day')).toBe(true);
  });

  it('short blocker summary is Arabic', () => {
    const summary = shortBlockerSummary([
      {
        code: 'missing_check_out',
        empId: 1,
        empName: 'أ',
        message: 'ناقص انصراف',
      },
      {
        code: 'missing_check_out',
        empId: 2,
        empName: 'ب',
        message: 'ناقص انصراف',
      },
    ]);
    expect(summary).toContain('ناقص انصراف');
  });
});

describe('dailyPayrollReadiness service contract', () => {
  it('service is read-only against closing table and payroll formulas', () => {
    const svc = read('src/lib/hr/dailyPayrollReadiness.service.ts');
    expect(svc).toContain('evaluateDailyPayrollReadiness');
    expect(svc).toContain('listDailyPayrollOpenDays');
    expect(svc).toContain('getEmpBranchWorkDayCloseState');
    expect(svc).not.toMatch(/transitionEmpBranchWorkDayClose|INSERT INTO dbo\.TblEmpBranchWorkDayClose|UPDATE dbo\.TblEmpBranchWorkDayClose/i);
    expect(svc).not.toMatch(/executeDailyPayrollGenerate|DailyWage\s*=/);
    expect(svc).toContain('WorkDate');
  });

  it('APIs are GET-only readiness/open-days', () => {
    const openDays = read('src/app/api/admin/hr/daily-payroll/open-days/route.ts');
    const readiness = read('src/app/api/admin/hr/daily-payroll/readiness/route.ts');
    const svc = read('src/lib/hr/dailyPayrollReadiness.service.ts');
    expect(openDays).toContain('export async function GET');
    expect(openDays).not.toContain('export async function POST');
    expect(openDays).toContain('scope=current-month');
    expect(readiness).toContain('export async function GET');
    expect(readiness).not.toContain('export async function POST');
    expect(svc).toContain("state !== 'CLOSED'");
    expect(svc).toContain('fromWorkDate');
  });

  it('overnight uses stored WorkDate (no new cutoff invented)', () => {
    const svc = read('src/lib/hr/dailyPayrollReadiness.service.ts');
    expect(svc).not.toMatch(/BUSINESS_DAY_CUTOFF|getBusinessDateStr|5 AM|cutoff/i);
    expect(svc).toContain('validateWorkDateYmd');
  });
});
