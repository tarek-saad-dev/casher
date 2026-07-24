import 'server-only';

import { getPool, sql } from '@/lib/db';
import type { TargetInputBasis } from './target.types';

export interface EffectiveTargetPlanRow {
  planId: number;
  empId: number;
  branchId: number;
  empName: string;
  isEnabled: boolean;
  inputBasis: TargetInputBasis;
  conversionDays: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface TargetTierDbRow {
  id: number;
  targetPlanId: number;
  inputStartAmount: number;
  dailyStartAmount: number;
  ratePercent: number;
  sortOrder: number;
}

export interface DailyTargetRow {
  id: number;
  empId: number;
  branchId: number;
  workDate: string;
  targetPlanId: number;
  netSalesAfterDiscount: number;
  targetAmount: number;
  calculationBreakdownJson: string | null;
  calculationVersion: string;
  status: 'generated' | 'recalculated' | 'voided';
  generatedByUserId: number | null;
  generatedAt: string;
  updatedAt: string | null;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function mapPlan(row: Record<string, unknown>): EffectiveTargetPlanRow {
  return {
    planId: Number(row.PlanID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    empName: String(row.EmpName ?? ''),
    isEnabled: Boolean(row.IsEnabled),
    inputBasis: row.InputBasis as TargetInputBasis,
    conversionDays: Number(row.ConversionDays),
    effectiveFrom: toDateStr(row.EffectiveFrom),
    effectiveTo: row.EffectiveTo == null ? null : toDateStr(row.EffectiveTo),
  };
}

function mapTier(row: Record<string, unknown>): TargetTierDbRow {
  return {
    id: Number(row.ID),
    targetPlanId: Number(row.TargetPlanID),
    inputStartAmount: Number(row.InputStartAmount),
    dailyStartAmount: Number(row.DailyStartAmount),
    ratePercent: Number(row.RatePercent),
    sortOrder: Number(row.SortOrder),
  };
}

function mapDaily(row: Record<string, unknown>): DailyTargetRow {
  return {
    id: Number(row.ID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    workDate: toDateStr(row.WorkDate),
    targetPlanId: Number(row.TargetPlanID),
    netSalesAfterDiscount: Number(row.NetSalesAfterDiscount),
    targetAmount: Number(row.TargetAmount),
    calculationBreakdownJson:
      row.CalculationBreakdownJson == null ? null : String(row.CalculationBreakdownJson),
    calculationVersion: String(row.CalculationVersion ?? 'v1'),
    status: String(row.Status) as DailyTargetRow['status'],
    generatedByUserId: row.GeneratedByUserID == null ? null : Number(row.GeneratedByUserID),
    generatedAt: String(row.GeneratedAt ?? ''),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  };
}

/**
 * All enabled plans whose window covers workDate for one branch.
 * Caller must detect >1 plan per EmpID within the branch (domain conflict).
 */
export async function listEnabledPlansCoveringDate(
  workDate: string,
  empIds?: number[] | null,
  branchId?: number,
): Promise<EffectiveTargetPlanRow[]> {
  if (branchId == null || !Number.isInteger(branchId) || branchId <= 0) {
    throw new Error('branchId مطلوب لخطط التارجت (Phase 1L)');
  }

  const db = await getPool();
  const request = db
    .request()
    .input('workDate', sql.Date, workDate)
    .input('branchId', sql.Int, branchId);

  let empFilter = '';
  if (empIds != null && empIds.length > 0) {
    const parts = empIds.map((id, i) => {
      const name = `e${i}`;
      request.input(name, sql.Int, id);
      return `@${name}`;
    });
    empFilter = ` AND p.EmpID IN (${parts.join(',')})`;
  }

  const result = await request.query(`
    SELECT
      p.ID AS PlanID,
      p.EmpID,
      p.BranchID,
      e.EmpName,
      p.IsEnabled,
      p.InputBasis,
      p.ConversionDays,
      p.EffectiveFrom,
      p.EffectiveTo
    FROM dbo.TblEmpTargetPlan p
    INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    WHERE p.IsEnabled = 1
      AND p.BranchID = @branchId
      AND p.EffectiveFrom <= @workDate
      AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @workDate)
      ${empFilter}
    ORDER BY p.EmpID, p.EffectiveFrom DESC, p.ID DESC
  `);

  return (result.recordset as Record<string, unknown>[]).map(mapPlan);
}

export async function listTiersForPlanIds(planIds: number[]): Promise<TargetTierDbRow[]> {
  if (planIds.length === 0) return [];
  const db = await getPool();
  const request = db.request();
  const parts = planIds.map((id, i) => {
    const name = `p${i}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });
  const result = await request.query(`
    SELECT ID, TargetPlanID, InputStartAmount, DailyStartAmount, RatePercent, SortOrder
    FROM dbo.TblEmpTargetTier
    WHERE TargetPlanID IN (${parts.join(',')})
    ORDER BY TargetPlanID, SortOrder ASC, ID ASC
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapTier);
}

export async function listDailyTargetsByWorkDate(
  workDate: string,
  empIds?: number[] | null,
): Promise<DailyTargetRow[]> {
  const db = await getPool();
  const request = db.request().input('workDate', sql.Date, workDate);
  let empFilter = '';
  if (empIds != null && empIds.length > 0) {
    const parts = empIds.map((id, i) => {
      const name = `e${i}`;
      request.input(name, sql.Int, id);
      return `@${name}`;
    });
    empFilter = ` AND EmpID IN (${parts.join(',')})`;
  }
  const result = await request.query(`
    SELECT
      ID, EmpID, BranchID, WorkDate, TargetPlanID,
      NetSalesAfterDiscount, TargetAmount,
      CalculationBreakdownJson, CalculationVersion, Status,
      GeneratedByUserID, GeneratedAt, UpdatedAt
    FROM dbo.TblEmpDailyTarget
    WHERE WorkDate = @workDate
      ${empFilter}
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapDaily);
}

export function isUniqueConstraintError(err: unknown): boolean {
  const e = err as { number?: number; originalError?: { info?: { number?: number } } };
  const number = e?.number ?? e?.originalError?.info?.number;
  return number === 2627 || number === 2601;
}

export interface UpsertDailyTargetParams {
  empId: number;
  branchId: number;
  workDate: string;
  targetPlanId: number;
  netSalesAfterDiscount: number;
  targetAmount: number;
  calculationBreakdownJson: string;
  calculationVersion: string;
  generatedByUserId: number | null;
}

export interface UpsertDailyTargetResult {
  id: number;
  persistenceStatus: 'generated' | 'recalculated';
  generatedAt: string;
  updatedAt: string | null;
}

/**
 * Safe upsert with UPDLOCK/HOLDLOCK — no MERGE.
 * Unique (EmpID, BranchID, WorkDate) is the final duplicate barrier (Phase 1L).
 */
export async function upsertDailyTargetInTransaction(
  transaction: sql.Transaction,
  params: UpsertDailyTargetParams,
): Promise<UpsertDailyTargetResult> {
  if (!Number.isInteger(params.branchId) || params.branchId <= 0) {
    throw new Error('branchId مطلوب لتارجت يومي (Phase 1L)');
  }

  const select = await new sql.Request(transaction)
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('workDate', sql.Date, params.workDate)
    .query(`
      SELECT ID, GeneratedAt
      FROM dbo.TblEmpDailyTarget WITH (UPDLOCK, HOLDLOCK)
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);

  const existing = select.recordset[0] as { ID: number; GeneratedAt: unknown } | undefined;

  if (!existing) {
    try {
      const inserted = await new sql.Request(transaction)
        .input('empId', sql.Int, params.empId)
        .input('branchId', sql.Int, params.branchId)
        .input('workDate', sql.Date, params.workDate)
        .input('planId', sql.Int, params.targetPlanId)
        .input('netSales', sql.Decimal(18, 2), params.netSalesAfterDiscount)
        .input('targetAmount', sql.Decimal(18, 2), params.targetAmount)
        .input('breakdown', sql.NVarChar(sql.MAX), params.calculationBreakdownJson)
        .input('version', sql.NVarChar(20), params.calculationVersion)
        .input('userId', sql.Int, params.generatedByUserId)
        .query(`
          INSERT INTO dbo.TblEmpDailyTarget (
            EmpID, BranchID, WorkDate, TargetPlanID,
            NetSalesAfterDiscount, TargetAmount,
            CalculationBreakdownJson, CalculationVersion,
            Status, GeneratedByUserID, GeneratedAt, UpdatedAt
          )
          OUTPUT INSERTED.ID, INSERTED.GeneratedAt, INSERTED.UpdatedAt
          VALUES (
            @empId, @branchId, @workDate, @planId,
            @netSales, @targetAmount,
            @breakdown, @version,
            N'generated', @userId, SYSDATETIME(), NULL
          )
        `);
      const row = inserted.recordset[0] as {
        ID: number;
        GeneratedAt: unknown;
        UpdatedAt: unknown;
      };
      return {
        id: Number(row.ID),
        persistenceStatus: 'generated',
        generatedAt: String(row.GeneratedAt ?? ''),
        updatedAt: null,
      };
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      // Race: another transaction inserted — fall through to update
    }
  }

  const updated = await new sql.Request(transaction)
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('workDate', sql.Date, params.workDate)
    .input('planId', sql.Int, params.targetPlanId)
    .input('netSales', sql.Decimal(18, 2), params.netSalesAfterDiscount)
    .input('targetAmount', sql.Decimal(18, 2), params.targetAmount)
    .input('breakdown', sql.NVarChar(sql.MAX), params.calculationBreakdownJson)
    .input('version', sql.NVarChar(20), params.calculationVersion)
    .input('userId', sql.Int, params.generatedByUserId)
    .query(`
      UPDATE dbo.TblEmpDailyTarget
      SET TargetPlanID = @planId,
          NetSalesAfterDiscount = @netSales,
          TargetAmount = @targetAmount,
          CalculationBreakdownJson = @breakdown,
          CalculationVersion = @version,
          Status = N'recalculated',
          GeneratedByUserID = @userId,
          UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.ID, INSERTED.GeneratedAt, INSERTED.UpdatedAt
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);

  const row = updated.recordset[0] as {
    ID: number;
    GeneratedAt: unknown;
    UpdatedAt: unknown;
  };
  if (!row) {
    throw new Error('تعذّر تحديث سجل التارجت اليومي');
  }
  return {
    id: Number(row.ID),
    persistenceStatus: 'recalculated',
    generatedAt: String(row.GeneratedAt ?? ''),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  };
}
