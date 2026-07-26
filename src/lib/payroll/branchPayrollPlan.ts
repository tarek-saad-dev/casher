/**
 * Phase 1L — branch payroll plan resolution (TblEmpBranchPayrollPlan).
 * Operational rates never fall back to TblEmp or another branch.
 */
import 'server-only';

import { getPool, sql } from '@/lib/db';

export type BranchPayrollPayType = 'hourly' | 'daily' | 'monthly';

export interface BranchPayrollPlanRow {
  planId: number;
  empId: number;
  branchId: number;
  payType: BranchPayrollPayType;
  hourlyRate: number | null;
  dailyRate: number | null;
  monthlySalary: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function mapPlan(row: Record<string, unknown>): BranchPayrollPlanRow {
  return {
    planId: Number(row.PlanID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    payType: String(row.PayType) as BranchPayrollPayType,
    hourlyRate: row.HourlyRate == null ? null : Number(row.HourlyRate),
    dailyRate: row.DailyRate == null ? null : Number(row.DailyRate),
    monthlySalary: row.MonthlySalary == null ? null : Number(row.MonthlySalary),
    effectiveFrom: toDateStr(row.EffectiveFrom),
    effectiveTo: row.EffectiveTo == null ? null : toDateStr(row.EffectiveTo),
    isActive: Boolean(row.IsActive),
  };
}

/**
 * Resolve the effective plan for EmpID + BranchID + WorkDate.
 * Prefer latest EffectiveFrom; no GLEEM / other-branch fallback.
 */
export async function resolveBranchPayrollPlanForDate(params: {
  empId: number;
  branchId: number;
  workDate: string;
  payTypes?: BranchPayrollPayType[];
}): Promise<BranchPayrollPlanRow | null> {
  const payTypes = params.payTypes ?? ['hourly', 'daily', 'monthly'];
  const db = await getPool();
  const request = db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('workDate', sql.Date, params.workDate);

  const typePlaceholders = payTypes.map((t, i) => {
    const name = `pt${i}`;
    request.input(name, sql.NVarChar(20), t);
    return `@${name}`;
  });

  const result = await request.query(`
    SELECT TOP 1
      PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
      EffectiveFrom, EffectiveTo, IsActive
    FROM dbo.TblEmpBranchPayrollPlan
    WHERE EmpID = @empId
      AND BranchID = @branchId
      AND IsActive = 1
      AND EffectiveFrom <= @workDate
      AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
      AND PayType IN (${typePlaceholders.join(',')})
    ORDER BY EffectiveFrom DESC, PlanID DESC
  `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPlan(row) : null;
}

/** Load effective hourly/daily plans for a branch/workDate (map by EmpID). */
export async function loadBranchDayPayrollPlans(
  branchId: number,
  workDate: string,
): Promise<Map<number, BranchPayrollPlanRow>> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT
        PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
        EffectiveFrom, EffectiveTo, IsActive,
        ROW_NUMBER() OVER (
          PARTITION BY EmpID
          ORDER BY EffectiveFrom DESC, PlanID DESC
        ) AS rn
      FROM dbo.TblEmpBranchPayrollPlan
      WHERE BranchID = @branchId
        AND IsActive = 1
        AND EffectiveFrom <= @workDate
        AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
        AND PayType IN (N'hourly', N'daily')
    `);

  const map = new Map<number, BranchPayrollPlanRow>();
  for (const row of result.recordset as Record<string, unknown>[]) {
    if (Number(row.rn) !== 1) continue;
    const plan = mapPlan(row);
    map.set(plan.empId, plan);
  }
  return map;
}

/**
 * Reject overlapping active periods for EmpID + BranchID.
 * Call before insert/update of a plan row.
 */
export async function assertNoOverlappingBranchPayrollPlans(params: {
  empId: number;
  branchId: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  excludePlanId?: number | null;
}): Promise<void> {
  const db = await getPool();
  const req = db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('from', sql.Date, params.effectiveFrom)
    .input('to', sql.Date, params.effectiveTo);

  let excludeSql = '';
  if (params.excludePlanId != null && params.excludePlanId > 0) {
    req.input('excludeId', sql.Int, params.excludePlanId);
    excludeSql = 'AND PlanID <> @excludeId';
  }

  const result = await req.query(`
    SELECT TOP 1 PlanID
    FROM dbo.TblEmpBranchPayrollPlan
    WHERE EmpID = @empId
      AND BranchID = @branchId
      AND IsActive = 1
      ${excludeSql}
      AND EffectiveFrom <= ISNULL(@to, CAST('9999-12-31' AS date))
      AND ISNULL(EffectiveTo, CAST('9999-12-31' AS date)) >= @from
  `);

  if (result.recordset.length > 0) {
    throw new Error(
      'تداخل في فترات خطة راتب الفرع لنفس الموظف — لا يمكن حفظ الخطة',
    );
  }
}
