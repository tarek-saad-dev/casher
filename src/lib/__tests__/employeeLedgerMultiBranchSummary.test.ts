/**
 * Employee ledger multi-branch financial summary — contract + formula reuse.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeEmployeeWithdrawalBuckets } from '@/lib/hr/employee-withdrawal-buckets';

vi.mock('server-only', () => ({}));

const root = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('employee ledger multi-branch financial summary', () => {
  it('service aggregates by entry BranchID and exposes per-emp branches map', () => {
    const svc = read('src/lib/services/employeeLedgerService.ts');
    expect(svc).toContain('getEmployeeLedgerBranchFinancialSummary');
    expect(svc).toContain('branchFinancial');
    expect(svc).toContain('overallBalance');
    expect(svc).toContain('mapEmployeeBranchBreakdown');
    expect(svc).toContain('CROSS JOIN dbo.TblBranch');
    expect(svc).toContain('l.BranchID');
    expect(svc).toMatch(
      /salary \+ target \+ funding - payout - revenueWithdrawal - advance - deductions/,
    );
  });

  it('branch balance formula matches ledger credits − debits via withdrawal buckets', () => {
    const salary = 1000;
    const target = 200;
    const funding = 300;
    const advanceDebits = 150;
    const payoutDebits = 400;
    const deductions = 50;
    const { payoutWithinDues, revenueWithdrawal, advanceExcess } =
      computeEmployeeWithdrawalBuckets({
        advanceDebits,
        payoutDebits,
        salaryAndTarget: salary + target,
        revenue: funding,
      });
    const classified =
      salary +
      target +
      funding -
      payoutWithinDues -
      revenueWithdrawal -
      advanceExcess -
      deductions;
    const ledger =
      salary + target + funding - advanceDebits - payoutDebits - deductions;
    expect(classified).toBeCloseTo(ledger, 2);
    expect(payoutWithinDues + revenueWithdrawal + advanceExcess).toBeCloseTo(
      advanceDebits + payoutDebits,
      2,
    );
  });

  it('summary API accepts branchId=all|<id> and returns accessibleBranches', () => {
    const route = read('src/app/api/admin/hr/employee-ledger/summary/route.ts');
    expect(route).toContain("branchParam !== 'all'");
    expect(route).toContain('accessibleBranches');
    expect(route).toContain('accessibleBranchIds');
  });

  it('list API scopes entries by branch filter and returns branch columns', () => {
    const route = read('src/app/api/admin/hr/employee-ledger/route.ts');
    expect(route).toContain('branchId');
    expect(route).toContain('branchIds');
    const svc = read('src/lib/services/employeeLedgerService.ts');
    expect(svc).toContain('b.BranchCode');
    expect(svc).toContain('b.BranchName');
  });

  it('panel renders 2-row grouped table with rowSpan merged cells', () => {
    const panel = read('src/components/hr/EmployeeLedgerPanel.tsx');
    expect(panel).toContain('BranchSummaryCard');
    expect(panel).toContain('branchFilter');
    expect(panel).toContain('الإجمالي العام');
    expect(panel).toContain('رصيد الفرع');
    expect(panel).toContain('الرصيد الإجمالي');
    expect(panel).toContain('rowSpan={2}');
    expect(panel).toContain('EMP_LEDGER_TABLE_BRANCH_CODES');
    expect(panel).toContain('BranchRowBadge');
  });

  it('types include branches map + overallBalance contract', () => {
    const types = read('src/lib/types/employee-ledger.ts');
    expect(types).toContain('EmpLedgerBranchFinancialSummary');
    expect(types).toContain('EmpLedgerEmployeeBranchBreakdown');
    expect(types).toContain('overallBalance');
    expect(types).toContain("Record<EmpLedgerTableBranchCode, EmpLedgerEmployeeBranchBreakdown>");
    expect(types).toContain('accrued');
    expect(types).toContain('transfers');
  });
});
