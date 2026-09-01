/**
 * Phase 1L — branch payroll plan resolution (TblEmpBranchPayrollPlan).
 *
 * Precedence (Phase 6C — global employee agreement):
 *   1) Explicit branch plan for EmpID + BranchID + WorkDate
 *   2) Primary/global employee agreement (home-branch plan preferred, else any open plan)
 *   3) null → SALARY_CONFIG_MISSING / no_branch_payroll_plan
 *
 * Operational rates never fall back to TblEmp columns.
 * Accounting stays branch-scoped via attendance/payroll BranchID.
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
  /** True when rates came from another branch's agreement (not an explicit override). */
  inheritedFromPrimary?: boolean;
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
    inheritedFromPrimary: Boolean(row.InheritedFromPrimary),
  };
}

/**
 * Pure precedence picker (testable): explicit branch override → primary agreement.
 * Does not invent rates; only selects among provided plan rows.
 */
export function pickEffectivePayrollPlan(args: {
  branchId: number;
  /** Plans already scoped to Emp + covering WorkDate. */
  candidates: BranchPayrollPlanRow[];
  /** Home branch IDs for this emp (optional ranking). */
  homeBranchIds?: Set<number>;
}): BranchPayrollPlanRow | null {
  if (!args.candidates.length) return null;
  const explicit = args.candidates.filter((p) => p.branchId === args.branchId);
  const pool = explicit.length > 0 ? explicit : args.candidates;
  const home = args.homeBranchIds ?? new Set<number>();
  const sorted = [...pool].sort((a, b) => {
    if (explicit.length === 0) {
      const aHome = home.has(a.branchId) ? 0 : 1;
      const bHome = home.has(b.branchId) ? 0 : 1;
      if (aHome !== bHome) return aHome - bHome;
    }
    if (a.effectiveFrom !== b.effectiveFrom) {
      return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    }
    return b.planId - a.planId;
  });
  const chosen = sorted[0];
  if (!chosen) return null;
  if (explicit.length === 0 && chosen.branchId !== args.branchId) {
    return { ...chosen, inheritedFromPrimary: true };
  }
  return { ...chosen, inheritedFromPrimary: false };
}

/**
 * Resolve the effective plan for EmpID + BranchID + WorkDate.
 * Default: branch override → global employee agreement → null.
 */
export async function resolveBranchPayrollPlanForDate(params: {
  empId: number;
  branchId: number;
  workDate: string;
  payTypes?: BranchPayrollPayType[];
  /** @default true */
  inheritPrimaryAgreement?: boolean;
}): Promise<BranchPayrollPlanRow | null> {
  const inherit = params.inheritPrimaryAgreement !== false;
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
      EffectiveFrom, EffectiveTo, IsActive,
      CAST(0 AS bit) AS InheritedFromPrimary
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
  if (row) return mapPlan(row);
  if (!inherit) return null;

  const primaryReq = db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('workDate', sql.Date, params.workDate);
  const primaryTypes = payTypes.map((t, i) => {
    const name = `pt${i}`;
    primaryReq.input(name, sql.NVarChar(20), t);
    return `@${name}`;
  });

  const primary = await primaryReq.query(`
    SELECT TOP 1
      p.PlanID, p.EmpID, p.BranchID, p.PayType, p.HourlyRate, p.DailyRate, p.MonthlySalary,
      p.EffectiveFrom, p.EffectiveTo, p.IsActive,
      CAST(1 AS bit) AS InheritedFromPrimary
    FROM dbo.TblEmpBranchPayrollPlan p
    LEFT JOIN dbo.TblEmpBranchAssignment ea
      ON ea.EmpID = p.EmpID
     AND ea.BranchID = p.BranchID
     AND ea.IsActive = 1
     AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
    WHERE p.EmpID = @empId
      AND p.IsActive = 1
      AND p.EffectiveFrom <= @workDate
      AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @workDate)
      AND p.PayType IN (${primaryTypes.join(',')})
    ORDER BY
      CASE WHEN ISNULL(ea.IsHomeBranch, 0) = 1 THEN 0 ELSE 1 END,
      CASE WHEN p.EffectiveTo IS NULL THEN 0 ELSE 1 END,
      p.EffectiveFrom DESC,
      p.PlanID DESC
  `);

  const prow = primary.recordset[0] as Record<string, unknown> | undefined;
  return prow ? mapPlan(prow) : null;
}

/**
 * Load effective hourly/daily plans for a branch/workDate (map by EmpID).
 * Includes inherited primary agreements when no explicit branch override exists.
 */
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
      WITH ranked AS (
        SELECT
          PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
          EffectiveFrom, EffectiveTo, IsActive,
          CAST(0 AS bit) AS InheritedFromPrimary,
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
      )
      SELECT PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
             EffectiveFrom, EffectiveTo, IsActive, InheritedFromPrimary
      FROM ranked
      WHERE rn = 1
    `);

  const map = new Map<number, BranchPayrollPlanRow>();
  for (const row of result.recordset as Record<string, unknown>[]) {
    const plan = mapPlan(row);
    map.set(plan.empId, plan);
  }

  // Inherit primary/global agreements for employees without an explicit branch override.
  const primary = await db
    .request()
    .input('workDate', sql.Date, workDate)
    .query(`
      WITH ranked AS (
        SELECT
          p.PlanID, p.EmpID, p.BranchID, p.PayType, p.HourlyRate, p.DailyRate, p.MonthlySalary,
          p.EffectiveFrom, p.EffectiveTo, p.IsActive,
          CAST(1 AS bit) AS InheritedFromPrimary,
          ROW_NUMBER() OVER (
            PARTITION BY p.EmpID
            ORDER BY
              CASE WHEN ISNULL(ea.IsHomeBranch, 0) = 1 THEN 0 ELSE 1 END,
              CASE WHEN p.EffectiveTo IS NULL THEN 0 ELSE 1 END,
              p.EffectiveFrom DESC,
              p.PlanID DESC
          ) AS rn
        FROM dbo.TblEmpBranchPayrollPlan p
        LEFT JOIN dbo.TblEmpBranchAssignment ea
          ON ea.EmpID = p.EmpID
         AND ea.BranchID = p.BranchID
         AND ea.IsActive = 1
         AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
        WHERE p.IsActive = 1
          AND p.EffectiveFrom <= @workDate
          AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @workDate)
          AND p.PayType IN (N'hourly', N'daily')
      )
      SELECT PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
             EffectiveFrom, EffectiveTo, IsActive, InheritedFromPrimary
      FROM ranked
      WHERE rn = 1
    `);

  for (const row of primary.recordset as Record<string, unknown>[]) {
    const plan = mapPlan(row);
    if (!map.has(plan.empId)) {
      map.set(plan.empId, plan);
    }
  }

  return map;
}

/** Monthly salary plans for a branch/workDate (map by EmpID). */
export async function loadBranchDayMonthlyPlans(
  branchId: number,
  workDate: string,
): Promise<Map<number, { monthlySalary: number }>> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      WITH ranked AS (
        SELECT
          EmpID,
          MonthlySalary,
          ROW_NUMBER() OVER (
            PARTITION BY EmpID
            ORDER BY EffectiveFrom DESC, PlanID DESC
          ) AS rn
        FROM dbo.TblEmpBranchPayrollPlan
        WHERE BranchID = @branchId
          AND IsActive = 1
          AND PayType = N'monthly'
          AND ISNULL(MonthlySalary, 0) > 0
          AND EffectiveFrom <= @workDate
          AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
      )
      SELECT EmpID, MonthlySalary
      FROM ranked
      WHERE rn = 1
    `);

  const map = new Map<number, { monthlySalary: number }>();
  for (const row of result.recordset as Array<{ EmpID: number; MonthlySalary: number }>) {
    const amount = Math.round(Number(row.MonthlySalary ?? 0) * 100) / 100;
    map.set(Number(row.EmpID), { monthlySalary: amount });
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

export type EmployeeBranchPayrollRateView = {
  hourlyRate: number | null;
  dailyRate: number | null;
  monthlySalary: number | null;
  payType: BranchPayrollPayType | null;
  planId: number | null;
  branchId: number | null;
};

/**
 * Single source of truth for operational rates: TblEmpBranchPayrollPlan.
 * Prefers home-branch active open plan, else any active open plan.
 */
export async function loadPrimaryBranchPayrollRatesForEmployee(
  empId: number,
): Promise<EmployeeBranchPayrollRateView> {
  const map = await loadActiveBranchPayrollRatesByEmpIds([empId]);
  return (
    map.get(empId) ?? {
      hourlyRate: null,
      dailyRate: null,
      monthlySalary: null,
      payType: null,
      planId: null,
      branchId: null,
    }
  );
}

/** Batch: EmpID → rates from preferred active open branch plan. */
export async function loadActiveBranchPayrollRatesByEmpIds(
  empIds: number[],
): Promise<Map<number, EmployeeBranchPayrollRateView>> {
  const out = new Map<number, EmployeeBranchPayrollRateView>();
  const ids = [...new Set(empIds.map((n) => Number(n)).filter((n) => n > 0))];
  if (!ids.length) return out;

  const db = await getPool();
  const req = db.request();
  const placeholders = ids.map((id, i) => {
    const name = `e${i}`;
    req.input(name, sql.Int, id);
    return `@${name}`;
  });

  const result = await req.query(`
    WITH ranked AS (
      SELECT
        p.PlanID, p.EmpID, p.BranchID, p.PayType, p.HourlyRate, p.DailyRate, p.MonthlySalary,
        ROW_NUMBER() OVER (
          PARTITION BY p.EmpID
          ORDER BY
            CASE WHEN ISNULL(ea.IsHomeBranch, 0) = 1 THEN 0 ELSE 1 END,
            p.EffectiveFrom DESC,
            p.PlanID DESC
        ) AS rn
      FROM dbo.TblEmpBranchPayrollPlan p
      LEFT JOIN dbo.TblEmpBranchAssignment ea
        ON ea.EmpID = p.EmpID
       AND ea.BranchID = p.BranchID
       AND ea.IsActive = 1
       AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= CAST(SYSUTCDATETIME() AS date))
      WHERE p.EmpID IN (${placeholders.join(',')})
        AND p.IsActive = 1
        AND p.EffectiveTo IS NULL
    )
    SELECT PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary
    FROM ranked
    WHERE rn = 1
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const plan = mapPlan(row);
    out.set(plan.empId, {
      hourlyRate: plan.hourlyRate,
      dailyRate: plan.dailyRate,
      monthlySalary: plan.monthlySalary,
      payType: plan.payType,
      planId: plan.planId,
      branchId: plan.branchId,
    });
  }
  return out;
}

/**
 * HR rate edits write ONLY to active open branch payroll plans (no TblEmp rate mirror).
 * Updates every active open plan for the employee; creates one primary (home) plan if none exist.
 * That primary plan is the global employee agreement — other branches inherit it at resolve time.
 */
export async function syncHrRatesToActiveBranchPlans(args: {
  empId: number;
  payType: BranchPayrollPayType;
  hourlyRate: number | null;
  dailyRate: number | null;
  monthlySalary: number | null;
  effectiveFrom: string;
  sourceNotes?: string;
}): Promise<{ updatedPlanIds: number[]; createdPlanId: number | null }> {
  const db = await getPool();
  const existing = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .query(`
      SELECT PlanID, BranchID
      FROM dbo.TblEmpBranchPayrollPlan
      WHERE EmpID = @empId
        AND IsActive = 1
        AND EffectiveTo IS NULL
    `);

  const hourly =
    args.payType === 'hourly' && args.hourlyRate != null && args.hourlyRate > 0
      ? args.hourlyRate
      : args.hourlyRate != null && args.hourlyRate > 0
        ? args.hourlyRate
        : null;
  const daily =
    args.payType === 'daily' && args.dailyRate != null && args.dailyRate > 0
      ? args.dailyRate
      : args.dailyRate != null && args.dailyRate > 0
        ? args.dailyRate
        : null;
  const monthly =
    args.payType === 'monthly' && args.monthlySalary != null && args.monthlySalary > 0
      ? args.monthlySalary
      : args.monthlySalary != null && args.monthlySalary > 0
        ? args.monthlySalary
        : null;

  const updatedPlanIds: number[] = [];
  for (const row of existing.recordset as Array<{ PlanID: number }>) {
    const planId = Number(row.PlanID);
    await db
      .request()
      .input('planId', sql.Int, planId)
      .input('payType', sql.NVarChar(20), args.payType)
      .input('hourly', sql.Decimal(18, 4), hourly)
      .input('daily', sql.Decimal(18, 4), daily)
      .input('monthly', sql.Decimal(18, 4), monthly)
      .input('notes', sql.NVarChar(200), args.sourceNotes ?? 'hr_rate_sync')
      .query(`
        UPDATE dbo.TblEmpBranchPayrollPlan
        SET PayType = @payType,
            HourlyRate = @hourly,
            DailyRate = @daily,
            MonthlySalary = @monthly,
            SourceNotes = @notes
        WHERE PlanID = @planId
      `);
    updatedPlanIds.push(planId);
  }

  if (updatedPlanIds.length > 0) {
    return { updatedPlanIds, createdPlanId: null };
  }

  const home = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .query(`
      SELECT TOP 1 BranchID
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId
        AND IsActive = 1
        AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(SYSUTCDATETIME() AS date))
      ORDER BY IsHomeBranch DESC, ID DESC
    `);
  const branchId = home.recordset[0]
    ? Number((home.recordset[0] as { BranchID: number }).BranchID)
    : null;
  if (!branchId) {
    throw new Error(
      'لا توجد خطة راتب فرع ولا تعيين فرع نشط — عيّن الموظف على فرع قبل حفظ سعر الساعة',
    );
  }

  await assertNoOverlappingBranchPayrollPlans({
    empId: args.empId,
    branchId,
    effectiveFrom: args.effectiveFrom,
    effectiveTo: null,
  });

  const ins = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, branchId)
    .input('payType', sql.NVarChar(20), args.payType)
    .input('hourly', sql.Decimal(18, 4), hourly)
    .input('daily', sql.Decimal(18, 4), daily)
    .input('monthly', sql.Decimal(18, 4), monthly)
    .input('from', sql.Date, args.effectiveFrom)
    .input('notes', sql.NVarChar(200), args.sourceNotes ?? 'hr_rate_create')
    .query(`
      INSERT INTO dbo.TblEmpBranchPayrollPlan (
        EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
        EffectiveFrom, EffectiveTo, IsActive, SourceNotes
      )
      OUTPUT INSERTED.PlanID
      VALUES (
        @empId, @branchId, @payType, @hourly, @daily, @monthly,
        @from, NULL, 1, @notes
      )
    `);

  return {
    updatedPlanIds: [],
    createdPlanId: Number(ins.recordset[0]?.PlanID ?? 0) || null,
  };
}

/** Overlay TblEmp rate columns with branch-plan rates for API/UI (plan is sole source). */
export function overlayEmployeeRowWithBranchPlanRates<T extends Record<string, unknown>>(
  row: T,
  rates: EmployeeBranchPayrollRateView | null | undefined,
): T {
  if (!rates) return row;
  return {
    ...row,
    ManualHourlyRate: rates.hourlyRate,
    HourlyRate: rates.hourlyRate,
    DailyRate: rates.dailyRate,
    BaseSalary: rates.monthlySalary ?? row.BaseSalary,
    BranchPayrollPlanID: rates.planId,
    BranchPayrollBranchID: rates.branchId,
    BranchPayrollPayType: rates.payType,
  };
}
