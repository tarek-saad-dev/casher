import { describe, expect, it } from 'vitest';
import { calculateBranchLedgerLiquidity } from '@/lib/hr/employee-ledger-liquidity';
import type {
  EmpLedgerEmployeeSummaryRow,
  EmpLedgerTableBranch,
} from '@/lib/types/employee-ledger';

const branches: EmpLedgerTableBranch[] = [
  { branchId: 1, branchCode: 'GLEEM', branchName: 'Gleem', label: 'جليم' },
  { branchId: 3, branchCode: 'CAMP_CAESAR', branchName: 'Camp Caesar', label: 'كامب شيزار' },
];

function employee(
  empId: number,
  balances: Partial<Record<'GLEEM' | 'CAMP_CAESAR', number>>,
): EmpLedgerEmployeeSummaryRow {
  return {
    empId,
    branches: Object.fromEntries(
      branches
        .filter((b) => balances[b.branchCode as keyof typeof balances] !== undefined)
        .map((b) => [
          b.branchCode,
          { branchId: b.branchId, balance: balances[b.branchCode as keyof typeof balances] },
        ]),
    ),
  } as unknown as EmpLedgerEmployeeSummaryRow;
}

describe('branch liquidity card calculations', () => {
  it('adds all positive employee balances per branch without offsetting other employees\' debts', () => {
    const rows = calculateBranchLedgerLiquidity(branches, [
      employee(1, { GLEEM: 1200.25, CAMP_CAESAR: 300 }),
      employee(2, { GLEEM: -200, CAMP_CAESAR: 700.5 }),
      employee(3, { GLEEM: 500.75, CAMP_CAESAR: -50 }),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        branchId: 1, cashRequired: 1701, employeeDebt: 200, netBalance: 1501,
      }),
      expect.objectContaining({
        branchId: 3, cashRequired: 1000.5, employeeDebt: 50, netBalance: 950.5,
      }),
    ]);
    expect(rows.reduce((total, row) => total + row.cashRequired, 0)).toBe(2701.5);
  });

  it('shows zero for a branch with no balances and does not double count a different BranchID', () => {
    const rows = calculateBranchLedgerLiquidity(branches, [
      employee(1, { GLEEM: 10.1 }),
      {
        ...employee(2, {}),
        branches: {
          GLEEM: { branchId: 3, balance: 999 },
        } as EmpLedgerEmployeeSummaryRow['branches'],
      },
    ]);
    expect(rows[0]).toMatchObject({ cashRequired: 10.1, employeeDebt: 0, netBalance: 10.1 });
    expect(rows[1]).toMatchObject({ cashRequired: 0, employeeDebt: 0, netBalance: 0 });
  });

  it('handles missing and invalid branch balances safely', () => {
    const rows = calculateBranchLedgerLiquidity(branches, [
      employee(1, {}),
      employee(2, { GLEEM: Number.NaN, CAMP_CAESAR: -25 }),
    ]);
    expect(rows.map((row) => row.cashRequired)).toEqual([0, 0]);
    expect(rows[1].employeeDebt).toBe(25);
  });
});
