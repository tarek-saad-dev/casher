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
  /** Operational working BranchID for the day (attendance / payroll). */
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
  /**
   * True when this EmpID also had payroll/target on another BranchID the same day.
   * Display still collapses to a single operational row.
   */
  sameDayMultiBranch?: boolean;
}

function normalizeBranchId(raw: number | null | undefined): number | null {
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return Number(raw);
  }
  return null;
}

function attendanceRank(status: string | null | undefined): number {
  const s = String(status ?? '').toLowerCase();
  if (s === 'present' || s === 'late') return 3;
  if (s === 'halfday' || s === 'half_day') return 2;
  if (s === 'absent' || s === 'dayoff' || s === 'day_off' || s === 'leave') return 1;
  return 0;
}

/**
 * Prefer the operational payroll row for the day: real attendance hours first,
 * then attendance status, then BranchID for stability.
 */
export function pickOperationalPayrollRow(rows: PayrollLikeRow[]): PayrollLikeRow {
  if (rows.length === 1) return rows[0]!;
  return [...rows].sort((a, b) => {
    const hoursA = Number(a.ActualHours ?? 0);
    const hoursB = Number(b.ActualHours ?? 0);
    if (hoursA !== hoursB) return hoursB - hoursA;
    const rankA = attendanceRank(a.AttendanceStatus);
    const rankB = attendanceRank(b.AttendanceStatus);
    if (rankA !== rankB) return rankB - rankA;
    const wageA = Number(a.DailyWage ?? 0);
    const wageB = Number(b.DailyWage ?? 0);
    if (wageA !== wageB) return wageB - wageA;
    return (normalizeBranchId(a.BranchID) ?? 0) - (normalizeBranchId(b.BranchID) ?? 0);
  })[0]!;
}

function targetPersistenceRank(status: TargetLikeRow['persistenceStatus']): number {
  if (status === 'recalculated') return 3;
  if (status === 'generated') return 2;
  return 1;
}

/** When no payroll exists, pick one target plan row for display (never multiple). */
export function pickOperationalTargetRow(rows: TargetLikeRow[]): TargetLikeRow {
  if (rows.length === 1) return rows[0]!;
  return [...rows].sort((a, b) => {
    const pr = targetPersistenceRank(b.persistenceStatus) - targetPersistenceRank(a.persistenceStatus);
    if (pr !== 0) return pr;
    const salesA = Number(a.currentNetSalesAfterDiscount ?? 0);
    const salesB = Number(b.currentNetSalesAfterDiscount ?? 0);
    if (salesA !== salesB) return salesB - salesA;
    return (normalizeBranchId(a.branchId) ?? 0) - (normalizeBranchId(b.branchId) ?? 0);
  })[0]!;
}

function applyTargetFields(row: MergedDailyRow, t: TargetLikeRow): void {
  const targetSales = t.currentNetSalesAfterDiscount;
  const targetAmount =
    t.persistenceStatus === 'not_generated' ? null : t.storedTargetAmount;
  row.target = t;
  row.hasTargetPlan = true;
  row.targetSales = targetSales;
  row.targetAmount = targetAmount;
  row.targetSyncStatus = t.syncStatus ?? 'up_to_date';
  if (!row.empName) row.empName = t.empName;
  if (row.branchId == null) {
    row.branchId = normalizeBranchId(t.branchId);
    if (t.branchCode) row.branchCode = String(t.branchCode);
    if (t.branchName) row.branchName = String(t.branchName);
  }
}

/**
 * One row per EmpID for the selected work day.
 * Branch badge = operational attendance/payroll branch when present;
 * otherwise the chosen target plan branch.
 * Extra branch target/payroll rows are not rendered as duplicates.
 */
export function mergeDailyPayrollAndTargetRows(
  payrollRows: PayrollLikeRow[],
  targetRows: TargetLikeRow[],
): MergedDailyRow[] {
  const payrollByEmp = new Map<number, PayrollLikeRow[]>();
  for (const p of payrollRows) {
    const list = payrollByEmp.get(p.EmpID) ?? [];
    list.push(p);
    payrollByEmp.set(p.EmpID, list);
  }

  const targetsByEmp = new Map<number, TargetLikeRow[]>();
  for (const t of targetRows) {
    const list = targetsByEmp.get(t.empId) ?? [];
    list.push(t);
    targetsByEmp.set(t.empId, list);
  }

  const empIds = new Set<number>([...payrollByEmp.keys(), ...targetsByEmp.keys()]);
  const merged: MergedDailyRow[] = [];

  for (const empId of empIds) {
    const payList = payrollByEmp.get(empId) ?? [];
    const targetList = targetsByEmp.get(empId) ?? [];
    const distinctBranchIds = new Set<number>();
    for (const p of payList) {
      const id = normalizeBranchId(p.BranchID);
      if (id != null) distinctBranchIds.add(id);
    }
    for (const t of targetList) {
      const id = normalizeBranchId(t.branchId);
      if (id != null) distinctBranchIds.add(id);
    }
    const sameDayMultiBranch = distinctBranchIds.size > 1;

    if (payList.length > 0) {
      const payroll = pickOperationalPayrollRow(payList);
      const branchId = normalizeBranchId(payroll.BranchID);
      const matchingTarget =
        branchId != null
          ? targetList.find((t) => normalizeBranchId(t.branchId) === branchId) ?? null
          : targetList.length === 1
            ? targetList[0]!
            : null;

      const row: MergedDailyRow = {
        empId,
        empName: payroll.EmpName,
        branchId,
        branchCode: payroll.BranchCode != null ? String(payroll.BranchCode) : null,
        branchName: payroll.BranchName != null ? String(payroll.BranchName) : null,
        payroll,
        target: null,
        dailyPay: payroll.DailyWage != null ? Number(payroll.DailyWage) : null,
        targetSales: null,
        targetAmount: null,
        hasTargetPlan: false,
        targetSyncStatus: null,
        sameDayMultiBranch: sameDayMultiBranch || undefined,
      };
      if (matchingTarget) applyTargetFields(row, matchingTarget);
      merged.push(row);
      continue;
    }

    // Target-only (no payroll / attendance for the day yet)
    const target = pickOperationalTargetRow(targetList);
    const row: MergedDailyRow = {
      empId,
      empName: target.empName,
      branchId: normalizeBranchId(target.branchId),
      branchCode: target.branchCode != null ? String(target.branchCode) : null,
      branchName: target.branchName != null ? String(target.branchName) : null,
      payroll: null,
      target: null,
      dailyPay: null,
      targetSales: null,
      targetAmount: null,
      hasTargetPlan: false,
      targetSyncStatus: null,
      sameDayMultiBranch: sameDayMultiBranch || undefined,
    };
    applyTargetFields(row, target);
    merged.push(row);
  }

  return merged.sort((a, b) => {
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
