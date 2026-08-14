export interface PayrollLikeRow {
  EmpID: number;
  EmpName: string;
  /** Working BranchID on the payroll row (required for multi-branch view). */
  BranchID?: number | null;
  BranchCode?: string | null;
  BranchName?: string | null;
  DailyWage?: number | null;
  ActualHours?: number | null;
  AttendanceStatus?: string | null;
  Status?: string | null;
}

export interface TargetLikeRow {
  empId: number;
  empName: string;
  /** Working BranchID for this target (required for multi-branch view). */
  branchId?: number | null;
  branchCode?: string | null;
  branchName?: string | null;
  persistenceStatus: 'not_generated' | 'generated' | 'recalculated';
  displayStatus: 'no_sales' | 'below_first_tier' | 'earned_target' | null;
  currentNetSalesAfterDiscount: string;
  currentMtdSales?: string;
  previewMtdTargetAmount?: string;
  storedNetSalesAfterDiscount: string | null;
  storedTargetAmount: string | null;
  storedMtdSales?: string | null;
  storedMtdTargetAmount?: string | null;
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
  /** Working BranchID — never employee home branch. */
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  payroll: PayrollLikeRow | null;
  target: TargetLikeRow | null;
  dailyPay: number | null;
  targetSales: string | null;
  targetAmount: string | null;
  hasTargetPlan: boolean;
  targetSyncStatus: 'up_to_date' | 'pending' | 'processing' | 'failed' | null;
  /** True when this EmpID also has another BranchID row on the same merge set. */
  sameDayMultiBranch?: boolean;
}

function mergeKey(empId: number, branchId: number | null | undefined): string {
  if (branchId != null && Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    return `${empId}|${Number(branchId)}`;
  }
  // Legacy single-branch payloads without BranchID — EmpID only (pre-multi view).
  return `${empId}|`;
}

/**
 * Union merge by EmpID+BranchID when branch is present.
 * Never collapses two working-branch financial rows into one.
 * Pure helper for UI / tests — no CombinedPay field.
 */
export function mergeDailyPayrollAndTargetRows(
  payrollRows: PayrollLikeRow[],
  targetRows: TargetLikeRow[],
): MergedDailyRow[] {
  const byKey = new Map<string, MergedDailyRow>();

  for (const p of payrollRows) {
    const branchId =
      p.BranchID != null && Number(p.BranchID) > 0 ? Number(p.BranchID) : null;
    const key = mergeKey(p.EmpID, branchId);
    byKey.set(key, {
      empId: p.EmpID,
      empName: p.EmpName,
      branchId,
      branchCode: p.BranchCode != null ? String(p.BranchCode) : null,
      branchName: p.BranchName != null ? String(p.BranchName) : null,
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
    const branchId =
      t.branchId != null && Number(t.branchId) > 0 ? Number(t.branchId) : null;
    const key = mergeKey(t.empId, branchId);
    const existing = byKey.get(key);
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
      if (existing.branchId == null && branchId != null) existing.branchId = branchId;
      if (!existing.branchCode && t.branchCode) existing.branchCode = String(t.branchCode);
      if (!existing.branchName && t.branchName) existing.branchName = String(t.branchName);
    } else {
      byKey.set(key, {
        empId: t.empId,
        empName: t.empName,
        branchId,
        branchCode: t.branchCode != null ? String(t.branchCode) : null,
        branchName: t.branchName != null ? String(t.branchName) : null,
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

  const rows = [...byKey.values()];
  const empBranchCounts = new Map<number, number>();
  for (const r of rows) {
    empBranchCounts.set(r.empId, (empBranchCounts.get(r.empId) ?? 0) + 1);
  }
  for (const r of rows) {
    if ((empBranchCounts.get(r.empId) ?? 0) > 1) r.sameDayMultiBranch = true;
  }

  return rows.sort((a, b) => {
    const bc = String(a.branchCode ?? '').localeCompare(String(b.branchCode ?? ''));
    if (bc !== 0) return bc;
    return a.empName.localeCompare(b.empName, 'ar');
  });
}

export type SameDayMultiBranchFlag = {
  empId: number;
  empName: string;
  branchIds: number[];
};

/** Detect EmpIDs that appear under more than one working BranchID. */
export function detectSameDayMultiBranchEmployees(
  rows: Array<{ empId: number; empName: string; branchId: number | null }>,
): SameDayMultiBranchFlag[] {
  const map = new Map<number, { empName: string; branchIds: Set<number> }>();
  for (const r of rows) {
    if (r.branchId == null || !(r.branchId > 0)) continue;
    const cur = map.get(r.empId) ?? { empName: r.empName, branchIds: new Set<number>() };
    cur.branchIds.add(r.branchId);
    if (!cur.empName) cur.empName = r.empName;
    map.set(r.empId, cur);
  }
  return [...map.entries()]
    .filter(([, v]) => v.branchIds.size > 1)
    .map(([empId, v]) => ({
      empId,
      empName: v.empName,
      branchIds: [...v.branchIds].sort((a, b) => a - b),
    }));
}
