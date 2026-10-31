import type {
  EmpLedgerEmployeeSummaryRow,
  EmpLedgerTableBranch,
} from '@/lib/types/employee-ledger';

/** Cash needed to pay positive employee balances, without netting another employee's debt. */
export interface BranchLedgerLiquidity {
  branchId: number;
  branchCode: string;
  branchName: string;
  label: string;
  cashRequired: number;
  employeeDebt: number;
  netBalance: number;
}

export function calculateBranchLedgerLiquidity(
  branches: EmpLedgerTableBranch[],
  employees: EmpLedgerEmployeeSummaryRow[],
): BranchLedgerLiquidity[] {
  return branches.map((branch) => {
    let cashRequiredCents = 0;
    let employeeDebtCents = 0;

    for (const employee of employees) {
      // The ledger table's BranchID, never the employee's current/home branch.
      const account = employee.branches?.[branch.branchCode];
      if (!account || account.branchId !== branch.branchId) continue;

      const cents = Math.round(Number(account.balance) * 100);
      if (!Number.isFinite(cents)) continue;
      if (cents > 0) cashRequiredCents += cents;
      if (cents < 0) employeeDebtCents -= cents;
    }

    return {
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
      label: branch.label,
      cashRequired: cashRequiredCents / 100,
      employeeDebt: employeeDebtCents / 100,
      netBalance: (cashRequiredCents - employeeDebtCents) / 100,
    };
  });
}
