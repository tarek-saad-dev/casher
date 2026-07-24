import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import {
  DOMAIN_OWNERSHIP_REGISTRY,
  GO_LIVE_BLOCKER_DOMAINS,
} from '@/lib/branch/domainOwnershipRegistry';
import {
  dedupeTargetRecalcScopes,
  resolveInvoiceTargetRecalculationScope,
} from '@/lib/payroll/employee-target/employee-target-recalc-scope';

const root = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Phase 1L employee financial branch ownership', () => {
  it('migration adds BranchID, plans, views, and GLEEM-only backfill', () => {
    const sql = read('db/migrations/add-employee-financial-branch-ownership.sql');
    expect(sql).toContain('TblEmpBranchPayrollPlan');
    expect(sql).toContain('vw_EmpAttendancePayrollBranchDay');
    expect(sql).toContain('vw_EmpLedgerBranchBalance');
    expect(sql).toContain('vw_EmpLedgerGlobalBalance');
    expect(sql).toContain("BranchCode = N'GLEEM'");
    expect(sql).toMatch(/UX_TblEmpDailyPayroll_Emp_Branch_WorkDate|UNIQUE.*EmpID.*BranchID.*WorkDate/i);
    expect(sql).toMatch(/PH1GTEST/i);
    expect(sql).toContain('TblEmpDailyPayroll');
    expect(sql).toContain('TblEmpLedgerEntry');
    expect(sql).toContain('TblEmpDailyTarget');
    expect(sql).toContain('TblEmpTargetRecalcRequest');
  });

  it('hourly payroll generate requires branchId and uses branch-day view', () => {
    const core = read('src/lib/payroll/dailyPayrollGenerateCore.ts');
    expect(core).toContain('branchId مطلوب لتوليد اليومية');
    expect(core).toContain('vw_EmpAttendancePayrollBranchDay');
    expect(core).toContain('AND v.BranchID = @BranchID');

    const dual = read('src/lib/services/employeeLedgerDualWrite.ts');
    expect(dual).toContain('branchId');
    expect(dual).toContain('BranchID');
  });

  it('generate/auto-generate/nightly reject body BranchID and iterate branches', () => {
    const gen = read('src/app/api/payroll/daily/generate/route.ts');
    expect(gen).toContain('BranchID في الطلب غير مسموح');
    expect(gen).toContain('requireBranchOperationAccess');
    expect(gen).toContain('branchId');

    const auto = read('src/app/api/payroll/daily/auto-generate/route.ts');
    expect(auto).toContain('listActiveBranches');
    expect(auto).toContain('branchId: branch.branchId');

    const nightly = read('src/lib/hr/nightly-close.service.ts');
    expect(nightly).toContain('payrollBranches');
    expect(nightly).toContain('targetBranches');
    expect(nightly).toContain('branchId: branch.branchId');
  });

  it('payout validates branch balance; advance ledger inherits CashMove branch', () => {
    const payout = read('src/lib/services/employeeLedgerPayoutService.ts');
    expect(payout).toContain('getEmployeeBranchBalance');
    expect(payout).toContain('BranchID');

    const dual = read('src/lib/services/employeeLedgerDualWrite.ts');
    expect(dual).toContain('SELECT BranchID FROM dbo.TblCashMove');
  });

  it('target sales/plans/results/recalc are branch-scoped', () => {
    const sales = read('src/lib/payroll/employee-target/employee-target-sales-service.ts');
    expect(sales).toContain('h.BranchID = @branchId');
    expect(sales).toContain('branchId مطلوب لمبيعات التارجت');

    const gen = read('src/lib/payroll/employee-target/employee-daily-target-generation.service.ts');
    expect(gen).toContain('branchId');
    expect(gen).toContain('branchId مطلوب لتوليد التارجت');

    const repo = read('src/lib/payroll/employee-target/employee-daily-target.repository.ts');
    expect(repo).toContain('AND BranchID = @branchId AND WorkDate = @workDate');
    expect(repo).toContain('p.BranchID = @branchId');

    const recalc = read('src/lib/payroll/employee-target/employee-target-recalc.repository.ts');
    expect(recalc).toContain('EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate');
  });

  it('target recalc scope includes invoice BranchID', () => {
    const scopes = resolveInvoiceTargetRecalculationScope({
      beforeSnapshot: {
        header: { invDate: '2026-07-01', BranchID: 1 },
        details: [{ EmpID: 7 }],
      },
      afterSnapshot: {
        header: { invDate: '2026-07-01', BranchID: 2 },
        details: [{ EmpID: 7 }],
      },
      reasons: ['invoice_mutation'],
    });
    expect(scopes.some((s) => s.branchId === 1 && s.empId === 7)).toBe(true);
    expect(scopes.some((s) => s.branchId === 2 && s.empId === 7)).toBe(true);

    const deduped = dedupeTargetRecalcScopes([
      { empId: 7, branchId: 1, workDate: '2026-07-01', reasons: ['a'] },
      { empId: 7, branchId: 1, workDate: '2026-07-01', reasons: ['b'] },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.reasons).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('monthly salary uses branch payroll plan and stamps BranchID', () => {
    const svc = read('src/lib/services/employeeLedgerMonthlySalaryService.ts');
    expect(svc).toContain('TblEmpBranchPayrollPlan');
    expect(svc).toContain('branchId');
    expect(svc).toContain('BranchID, EmpID, EntryDate');

    const route = read('src/app/api/admin/hr/employee-ledger/monthly-salary/post/route.ts');
    expect(route).toContain('BranchID في الطلب غير مسموح');
    expect(route).toContain('requireBranchOperationAccess');
  });

  it('ledger writers stamp BranchID (tip, funding, sync, target)', () => {
    expect(read('src/lib/services/employeeTipService.ts')).toContain('BranchID, EmpID, EntryDate');
    expect(read('src/lib/services/employeeLedgerFundingService.ts')).toContain(
      'BranchID, EmpID, EntryDate',
    );
    expect(read('src/lib/services/employeeLedgerSyncService.ts')).toContain(
      'BranchID, EmpID, EntryDate',
    );
    expect(
      read('src/lib/payroll/employee-target/employee-daily-target-ledger.repository.ts'),
    ).toContain('BranchID, EmpID, EntryDate');
  });

  it('registry: payroll_ledger_targets branch-owned and not a go-live blocker', () => {
    const row = DOMAIN_OWNERSHIP_REGISTRY.find((d) => d.domain === 'payroll_ledger_targets');
    expect(row?.classification).toBe('BRANCH_OWNED_ROOT');
    expect(row?.branchRequiredOnWrite).toBe(true);
    expect(row?.goLiveBlocker).toBe(false);
    expect(GO_LIVE_BLOCKER_DOMAINS).not.toContain('payroll_ledger_targets');
  });

  it('Phase 1L documentation set exists', () => {
    const docs = [
      'docs/branch-phase-1l-employee-financial-dependency-audit.md',
      'docs/branch-phase-1l-branch-account-contract.md',
      'docs/branch-phase-1l-payroll-plan-contract.md',
      'docs/branch-phase-1l-hourly-payroll.md',
      'docs/branch-phase-1l-monthly-salary.md',
      'docs/branch-phase-1l-ledger-contract.md',
      'docs/branch-phase-1l-target-contract.md',
      'docs/branch-phase-1l-nightly-generation.md',
      'docs/branch-phase-1l-migration-and-backfill.md',
      'docs/branch-phase-1l-reconciliation.md',
      'docs/branch-phase-1l-verification.md',
      'docs/branch-phase-1l-closure.md',
    ];
    for (const d of docs) {
      expect(fs.existsSync(path.join(root, d)), d).toBe(true);
    }
  });
});
