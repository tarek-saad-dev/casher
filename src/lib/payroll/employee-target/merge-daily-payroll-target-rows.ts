export interface PayrollLikeRow {
  EmpID: number;
  EmpName: string;
  DailyWage?: number | null;
  ActualHours?: number | null;
  AttendanceStatus?: string | null;
  Status?: string | null;
}

export interface TargetLikeRow {
  empId: number;
  empName: string;
  persistenceStatus: 'not_generated' | 'generated' | 'recalculated';
  displayStatus: 'no_sales' | 'below_first_tier' | 'earned_target' | null;
  currentNetSalesAfterDiscount: string;
  storedNetSalesAfterDiscount: string | null;
  storedTargetAmount: string | null;
  planSummary: string;
  targetPlanId: number;
  tierCount: number;
  firstDailyStartAmount: string;
  firstRatePercent: string;
  generatedAt: string | null;
  updatedAt: string | null;
  previewTargetAmount: string;
  previewBreakdown: unknown[];
  tiers: unknown[];
  inputBasis: string;
  conversionDays: number;
  planEffectiveFrom: string;
  planEffectiveTo: string | null;
  calculationBreakdownJson: string | null;
  dailyTargetId: number | null;
  syncStatus?: 'up_to_date' | 'pending' | 'processing' | 'failed';
  syncRequestedAt?: string | null;
  syncProcessedAt?: string | null;
  syncAttemptCount?: number;
  syncLastErrorSafe?: string | null;
}

export interface MergedDailyRow {
  empId: number;
  empName: string;
  payroll: PayrollLikeRow | null;
  target: TargetLikeRow | null;
  dailyPay: number | null;
  targetSales: string | null;
  targetAmount: string | null;
  hasTargetPlan: boolean;
  targetSyncStatus: 'up_to_date' | 'pending' | 'processing' | 'failed' | null;
}

/**
 * Union merge by EmpID: payroll-only, target-only, or both.
 * Pure helper for UI / tests — no CombinedPay field.
 */
export function mergeDailyPayrollAndTargetRows(
  payrollRows: PayrollLikeRow[],
  targetRows: TargetLikeRow[],
): MergedDailyRow[] {
  const byEmp = new Map<number, MergedDailyRow>();

  for (const p of payrollRows) {
    byEmp.set(p.EmpID, {
      empId: p.EmpID,
      empName: p.EmpName,
      payroll: p,
      target: null,
      dailyPay: p.DailyWage != null ? Number(p.DailyWage) : null,
      targetSales: null,
      targetAmount: null,
      hasTargetPlan: false,
      targetSyncStatus: null,
    });
  }

  for (const t of targetRows) {
    const existing = byEmp.get(t.empId);
    const targetSales = t.currentNetSalesAfterDiscount;
    const targetAmount =
      t.persistenceStatus === 'not_generated' ? null : t.storedTargetAmount;
    const syncStatus = t.syncStatus ?? 'up_to_date';

    if (existing) {
      existing.target = t;
      existing.hasTargetPlan = true;
      existing.targetSales = targetSales;
      existing.targetAmount = targetAmount;
      existing.targetSyncStatus = syncStatus;
      if (!existing.empName) existing.empName = t.empName;
    } else {
      byEmp.set(t.empId, {
        empId: t.empId,
        empName: t.empName,
        payroll: null,
        target: t,
        dailyPay: null,
        targetSales,
        targetAmount,
        hasTargetPlan: true,
        targetSyncStatus: syncStatus,
      });
    }
  }

  return [...byEmp.values()].sort((a, b) =>
    a.empName.localeCompare(b.empName, 'ar'),
  );
}
