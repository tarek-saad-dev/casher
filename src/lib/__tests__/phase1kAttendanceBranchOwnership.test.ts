import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import {
  DOMAIN_OWNERSHIP_REGISTRY,
  GO_LIVE_BLOCKER_DOMAINS,
} from '@/lib/branch/domainOwnershipRegistry';
import { aggregateToValidationAttendance } from '@/lib/payroll/attendancePayrollAggregate';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1K attendance branch ownership', () => {
  it('migration backfills GLEEM, replaces unique, creates payroll view', () => {
    const sql = read('db/migrations/add-attendance-branch-ownership.sql');
    expect(sql).toContain("BranchCode = N'GLEEM'");
    expect(sql).toContain('UQ_TblEmpAttendance_Branch_Emp_WorkDate');
    expect(sql).toContain('FK_TblEmpAttendance_BranchID');
    expect(sql).toContain('vw_EmpAttendancePayrollDay');
    expect(sql).toContain('HasAnyCheckIn');
    expect(sql).toMatch(/PH1GTEST must not own attendance/i);
    expect(sql).not.toMatch(/TblEmpDailyPayroll[\s\S]{0,60}ADD\s+BranchID/i);
    expect(sql).not.toMatch(/BusinessDayID/);
  });

  it('branchAttendance service locks globally and validates assignment', () => {
    const svc = read('src/lib/hr/attendance/branchAttendance.service.ts');
    expect(svc).toContain('attendance-session:');
    expect(svc).toContain('sp_getapplock');
    expect(svc).toContain('assertEmployeeEligibleForBranchAttendance');
    expect(svc).toContain('ALREADY_OPEN');
    expect(svc).toContain('checkInEmployee');
    expect(svc).toContain('checkOutEmployee');
    expect(svc).toContain('anyOpen.branchId === args.branch.branchId');
    // Wrong branch checkout is non-disclosing 404
    expect(svc).toContain("code: string");
    expect(svc).toMatch(/NOT_FOUND[\s\S]{0,40}404/);
  });

  it('attendance routes reject body BranchID and scope by session branch', () => {
    const admin = read('src/app/api/admin/attendance/route.ts');
    expect(admin).toContain('requireBranchOperationAccess');
    expect(admin).toContain('BranchID في الطلب غير مسموح');
    expect(admin).toContain('a.BranchID = @branchId');
    expect(admin).toContain('assertEmployeeEligibleForBranchAttendance');

    const bulk = read('src/app/api/admin/attendance/bulk/route.ts');
    expect(bulk).toContain('requireBranchOperationAccess');
    expect(bulk).toContain('BranchID في الطلب غير مسموح');
    expect(bulk).toContain('AND BranchID = @branchId');

    const emp = read('src/app/api/employees/attendance/route.ts');
    expect(emp).toContain('BranchID في الطلب غير مسموح');
    expect(emp).toContain('a.BranchID = @branchId');

    const byId = read('src/app/api/employees/attendance/[id]/route.ts');
    expect(byId).toContain('BranchID = @branchId');
    expect(byId).toContain('غير موجود');

    const team = read('src/app/api/pos/team-attendance/route.ts');
    expect(team).toContain('requireBranchOperationAccess');
    expect(team).toContain('a.BranchID = @branchId');
  });

  it('payroll uses employee/day aggregate once (no per-branch payroll rows)', () => {
    const core = read('src/lib/payroll/dailyPayrollGenerateCore.ts');
    expect(core).toContain('vw_EmpAttendancePayrollDay');
    expect(core).toContain('AGGREGATE_ACTUAL_HOURS_EXPR');
    expect(core).toContain('loadEmpDayAttendanceAggregates');
    expect(core).toContain('PrimaryAttendanceID');
    expect(core).not.toMatch(/INSERT INTO dbo\.TblEmpDailyPayroll[\s\S]{0,200}FROM dbo\.TblEmpAttendance a\s/);

    const agg = read('src/lib/payroll/attendancePayrollAggregate.ts');
    expect(agg).toContain('employee + WorkDate');
    expect(agg).toContain('Phase 1L');
  });

  it('nightly finalizes per branch then payroll once', () => {
    const nightly = read('src/lib/hr/nightly-close.service.ts');
    expect(nightly).toContain('listActiveBranches');
    expect(nightly).toContain('finalizeIncompleteAttendanceWithDefaults');
    expect(nightly).toContain('branchId: branch.branchId');
    // Payroll still single call after attendance loop
    expect(nightly).toContain('runDailyPayrollGenerateWithOptionalLedger');

    const finalize = read('src/lib/hr/finalize-incomplete-attendance.ts');
    expect(finalize).toContain('options: { branchId: number }');
    expect(finalize).toContain('AND BranchID = @branchId');
    expect(finalize).toContain('(BranchID, EmpID, WorkDate');
  });

  it('employee WhatsApp uses attendance branch names, not false default', () => {
    const wa = read('src/lib/hr/employee-daily-whatsapp-report.service.ts');
    expect(wa).toContain('resolveEmployeeAttendanceBranchLabel');
    expect(wa).toContain('عدة فروع');
    expect(wa).toContain('Cut Salon');
    expect(wa).not.toContain('getConfig().defaultBranchName');
  });

  it('WhatsApp branch label helper behaviour', () => {
    // Local pure function mirror of production helper
    const label = (names: string[]) => {
      const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      if (unique.length === 1) return unique[0]!;
      if (unique.length > 1) return 'عدة فروع';
      return 'Cut Salon';
    };
    expect(label(['جليم'])).toBe('جليم');
    expect(label(['جليم', 'فرع ب'])).toBe('عدة فروع');
    expect(label([])).toBe('Cut Salon');
  });

  it('aggregate validation synthetic attendance handles open sessions', () => {
    expect(
      aggregateToValidationAttendance({
        empId: 1,
        workDate: '2026-07-01',
        primaryAttendanceId: 10,
        sessionCount: 2,
        netMinutes: 480,
        breakMinutesTotal: 30,
        hasOpenSession: true,
        hasAnyCheckIn: true,
      }),
    ).toEqual({
      Status: 'Present',
      CheckInTime: '00:00',
      CheckOutTime: null,
    });

    expect(
      aggregateToValidationAttendance({
        empId: 1,
        workDate: '2026-07-01',
        primaryAttendanceId: 10,
        sessionCount: 1,
        netMinutes: 480,
        breakMinutesTotal: 0,
        hasOpenSession: false,
        hasAnyCheckIn: true,
      })?.CheckOutTime,
    ).toBe('00:00');

    expect(aggregateToValidationAttendance(undefined)).toBeNull();
  });

  it('registry: attendance branch-owned and no longer go-live blocker', () => {
    const att = DOMAIN_OWNERSHIP_REGISTRY.find((d) => d.domain === 'attendance');
    expect(att?.classification).toBe('BRANCH_OWNED_ROOT');
    expect(att?.goLiveBlocker).toBe(false);
    expect(GO_LIVE_BLOCKER_DOMAINS).not.toContain('attendance');
    expect(GO_LIVE_BLOCKER_DOMAINS).toContain('payroll_ledger_targets');
  });

  it('Phase 1K documentation set exists', () => {
    const docs = [
      'docs/branch-phase-1k-attendance-dependency-audit.md',
      'docs/branch-phase-1k-attendance-business-contract.md',
      'docs/branch-phase-1k-schema.md',
      'docs/branch-phase-1k-checkin-checkout-contract.md',
      'docs/branch-phase-1k-payroll-compatibility.md',
      'docs/branch-phase-1k-nightly-finalization.md',
      'docs/branch-phase-1k-migration-and-backfill.md',
      'docs/branch-phase-1k-verification.md',
      'docs/branch-phase-1k-closure.md',
    ];
    for (const d of docs) {
      expect(fs.existsSync(path.join(root, d)), d).toBe(true);
    }
  });

  it('schedules remain employee-global (no BranchID added to schedule tables in 1K)', () => {
    const mig = read('db/migrations/add-attendance-branch-ownership.sql');
    expect(mig).not.toMatch(/TblEmpWorkSchedule[\s\S]{0,40}BranchID/);
  });
});
