import 'server-only';

import { getPool, sql } from '@/lib/db';
import type { TargetInputBasis } from './target.types';

export interface TargetPlanRow {
  id: number;
  empId: number;
  isEnabled: boolean;
  inputBasis: TargetInputBasis;
  conversionDays: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TargetTierRow {
  id: number;
  targetPlanId: number;
  inputStartAmount: number;
  dailyStartAmount: number;
  ratePercent: number;
  sortOrder: number;
}

export interface TargetPlanWithTiers extends TargetPlanRow {
  tiers: TargetTierRow[];
}

export interface EmployeeTargetSummaryRow {
  empId: number;
  hasTargetPlan: boolean;
  targetEnabled: boolean | null;
  targetTierCount: number | null;
  targetFirstDailyStart: number | null;
  targetFirstRatePercent: number | null;
  targetEffectiveFrom: string | null;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '');
  return s.slice(0, 10);
}

function mapPlan(row: Record<string, unknown>): TargetPlanRow {
  return {
    id: Number(row.ID),
    empId: Number(row.EmpID),
    isEnabled: Boolean(row.IsEnabled),
    inputBasis: row.InputBasis as TargetInputBasis,
    conversionDays: Number(row.ConversionDays),
    effectiveFrom: toDateStr(row.EffectiveFrom),
    effectiveTo: row.EffectiveTo == null ? null : toDateStr(row.EffectiveTo),
    notes: row.Notes == null ? null : String(row.Notes),
    createdByUserId: row.CreatedByUserID == null ? null : Number(row.CreatedByUserID),
    updatedByUserId: row.UpdatedByUserID == null ? null : Number(row.UpdatedByUserID),
    createdAt: row.CreatedAt == null ? null : String(row.CreatedAt),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  };
}

function mapTier(row: Record<string, unknown>): TargetTierRow {
  return {
    id: Number(row.ID),
    targetPlanId: Number(row.TargetPlanID),
    inputStartAmount: Number(row.InputStartAmount),
    dailyStartAmount: Number(row.DailyStartAmount),
    ratePercent: Number(row.RatePercent),
    sortOrder: Number(row.SortOrder),
  };
}

export async function getEmployeeBasic(
  empId: number,
): Promise<{ EmpID: number; EmpName: string; isActive: boolean } | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpID, EmpName, CAST(ISNULL(isActive, 1) AS BIT) AS isActive
      FROM dbo.TblEmp
      WHERE EmpID = @empId
    `);
  if (!result.recordset[0]) return null;
  const row = result.recordset[0] as Record<string, unknown>;
  return {
    EmpID: Number(row.EmpID),
    EmpName: String(row.EmpName),
    isActive: Boolean(row.isActive),
  };
}

export async function listPlansForEmployee(empId: number): Promise<TargetPlanRow[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT
        ID, EmpID, IsEnabled, InputBasis, ConversionDays,
        EffectiveFrom, EffectiveTo, Notes,
        CreatedByUserID, UpdatedByUserID, CreatedAt, UpdatedAt
      FROM dbo.TblEmpTargetPlan
      WHERE EmpID = @empId
      ORDER BY EffectiveFrom ASC, ID ASC
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapPlan);
}

export async function listTiersForPlans(planIds: number[]): Promise<TargetTierRow[]> {
  if (planIds.length === 0) return [];
  const db = await getPool();
  const request = db.request();
  const placeholders = planIds.map((_, i) => {
    const name = `p${i}`;
    request.input(name, sql.Int, planIds[i]);
    return `@${name}`;
  });
  const result = await request.query(`
    SELECT
      ID, TargetPlanID, InputStartAmount, DailyStartAmount, RatePercent, SortOrder
    FROM dbo.TblEmpTargetTier
    WHERE TargetPlanID IN (${placeholders.join(',')})
    ORDER BY TargetPlanID, SortOrder ASC, ID ASC
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapTier);
}

export async function getPlanWithTiers(planId: number): Promise<TargetPlanWithTiers | null> {
  const db = await getPool();
  const planResult = await db
    .request()
    .input('planId', sql.Int, planId)
    .query(`
      SELECT
        ID, EmpID, IsEnabled, InputBasis, ConversionDays,
        EffectiveFrom, EffectiveTo, Notes,
        CreatedByUserID, UpdatedByUserID, CreatedAt, UpdatedAt
      FROM dbo.TblEmpTargetPlan
      WHERE ID = @planId
    `);
  if (!planResult.recordset[0]) return null;
  const plan = mapPlan(planResult.recordset[0] as Record<string, unknown>);
  const tiers = await listTiersForPlans([planId]);
  return { ...plan, tiers };
}

export async function closePlanEffectiveTo(
  transaction: sql.Transaction,
  planId: number,
  effectiveTo: string,
  updatedByUserId: number | null,
): Promise<void> {
  await new sql.Request(transaction)
    .input('planId', sql.Int, planId)
    .input('effectiveTo', sql.Date, effectiveTo)
    .input('updatedBy', sql.Int, updatedByUserId)
    .query(`
      UPDATE dbo.TblEmpTargetPlan
      SET EffectiveTo = @effectiveTo,
          UpdatedAt = SYSDATETIME(),
          UpdatedByUserID = @updatedBy
      WHERE ID = @planId
    `);
}

export async function insertPlanWithTiers(
  transaction: sql.Transaction,
  params: {
    empId: number;
    isEnabled: boolean;
    inputBasis: TargetInputBasis;
    conversionDays: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    notes: string | null;
    createdByUserId: number | null;
    tiers: Array<{
      inputStartAmount: number;
      dailyStartAmount: number;
      ratePercent: number;
      sortOrder: number;
    }>;
  },
): Promise<number> {
  const planResult = await new sql.Request(transaction)
    .input('empId', sql.Int, params.empId)
    .input('isEnabled', sql.Bit, params.isEnabled ? 1 : 0)
    .input('inputBasis', sql.NVarChar(10), params.inputBasis)
    .input('conversionDays', sql.Int, params.conversionDays)
    .input('effectiveFrom', sql.Date, params.effectiveFrom)
    .input('effectiveTo', sql.Date, params.effectiveTo)
    .input('notes', sql.NVarChar(500), params.notes)
    .input('createdBy', sql.Int, params.createdByUserId)
    .query(`
      INSERT INTO dbo.TblEmpTargetPlan (
        EmpID, IsEnabled, InputBasis, ConversionDays,
        EffectiveFrom, EffectiveTo, Notes, CreatedByUserID
      )
      OUTPUT INSERTED.ID AS ID
      VALUES (
        @empId, @isEnabled, @inputBasis, @conversionDays,
        @effectiveFrom, @effectiveTo, @notes, @createdBy
      )
    `);

  const planId = Number((planResult.recordset[0] as { ID: number }).ID);

  for (const tier of params.tiers) {
    await new sql.Request(transaction)
      .input('planId', sql.Int, planId)
      .input('inputStart', sql.Decimal(18, 6), tier.inputStartAmount)
      .input('dailyStart', sql.Decimal(18, 6), tier.dailyStartAmount)
      .input('rate', sql.Decimal(9, 6), tier.ratePercent)
      .input('sortOrder', sql.Int, tier.sortOrder)
      .query(`
        INSERT INTO dbo.TblEmpTargetTier (
          TargetPlanID, InputStartAmount, DailyStartAmount, RatePercent, SortOrder
        )
        VALUES (@planId, @inputStart, @dailyStart, @rate, @sortOrder)
      `);
  }

  return planId;
}

/**
 * Same-day supersede: update plan fields and replace all tiers, keep ID + EffectiveFrom/To.
 */
export async function replacePlanTiersInTransaction(
  transaction: sql.Transaction,
  params: {
    planId: number;
    isEnabled: boolean;
    inputBasis: TargetInputBasis;
    conversionDays: number;
    /** When set, moves the plan window to this month-start (etc.). */
    effectiveFrom?: string;
    effectiveTo?: string | null;
    notes: string | null;
    updatedByUserId: number | null;
    tiers: Array<{
      inputStartAmount: number;
      dailyStartAmount: number;
      ratePercent: number;
      sortOrder: number;
    }>;
  },
): Promise<void> {
  const request = new sql.Request(transaction)
    .input('planId', sql.Int, params.planId)
    .input('isEnabled', sql.Bit, params.isEnabled ? 1 : 0)
    .input('inputBasis', sql.NVarChar(10), params.inputBasis)
    .input('conversionDays', sql.Int, params.conversionDays)
    .input('notes', sql.NVarChar(500), params.notes)
    .input('updatedBy', sql.Int, params.updatedByUserId);

  if (params.effectiveFrom !== undefined) {
    request.input('effectiveFrom', sql.Date, params.effectiveFrom);
    request.input('effectiveTo', sql.Date, params.effectiveTo ?? null);
    await request.query(`
      UPDATE dbo.TblEmpTargetPlan
      SET IsEnabled = @isEnabled,
          InputBasis = @inputBasis,
          ConversionDays = @conversionDays,
          EffectiveFrom = @effectiveFrom,
          EffectiveTo = @effectiveTo,
          Notes = @notes,
          UpdatedAt = SYSDATETIME(),
          UpdatedByUserID = @updatedBy
      WHERE ID = @planId
    `);
  } else {
    await request.query(`
      UPDATE dbo.TblEmpTargetPlan
      SET IsEnabled = @isEnabled,
          InputBasis = @inputBasis,
          ConversionDays = @conversionDays,
          Notes = @notes,
          UpdatedAt = SYSDATETIME(),
          UpdatedByUserID = @updatedBy
      WHERE ID = @planId
    `);
  }

  await new sql.Request(transaction)
    .input('planId', sql.Int, params.planId)
    .query(`DELETE FROM dbo.TblEmpTargetTier WHERE TargetPlanID = @planId`);

  for (const tier of params.tiers) {
    await new sql.Request(transaction)
      .input('planId', sql.Int, params.planId)
      .input('inputStart', sql.Decimal(18, 6), tier.inputStartAmount)
      .input('dailyStart', sql.Decimal(18, 6), tier.dailyStartAmount)
      .input('rate', sql.Decimal(9, 6), tier.ratePercent)
      .input('sortOrder', sql.Int, tier.sortOrder)
      .query(`
        INSERT INTO dbo.TblEmpTargetTier (
          TargetPlanID, InputStartAmount, DailyStartAmount, RatePercent, SortOrder
        )
        VALUES (@planId, @inputStart, @dailyStart, @rate, @sortOrder)
      `);
  }
}

export async function countDailyTargetsForPlan(planId: number): Promise<number> {
  const db = await getPool();
  const result = await db
    .request()
    .input('planId', sql.Int, planId)
    .query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblEmpDailyTarget
      WHERE TargetPlanID = @planId
    `);
  return Number((result.recordset[0] as { Cnt: number }).Cnt ?? 0);
}

/**
 * Delete plan + its tiers. Caller must ensure no TblEmpDailyTarget refs remain.
 * Optionally extend the prior plan's EffectiveTo to fill the gap.
 */
export async function deletePlanInTransaction(
  transaction: sql.Transaction,
  params: {
    planId: number;
    priorPlanId: number | null;
    priorNewEffectiveTo: string | null;
    updatedByUserId: number | null;
  },
): Promise<void> {
  await new sql.Request(transaction)
    .input('planId', sql.Int, params.planId)
    .query(`DELETE FROM dbo.TblEmpTargetTier WHERE TargetPlanID = @planId`);

  await new sql.Request(transaction)
    .input('planId', sql.Int, params.planId)
    .query(`DELETE FROM dbo.TblEmpTargetPlan WHERE ID = @planId`);

  if (params.priorPlanId != null) {
    await new sql.Request(transaction)
      .input('planId', sql.Int, params.priorPlanId)
      .input('effectiveTo', sql.Date, params.priorNewEffectiveTo)
      .input('updatedBy', sql.Int, params.updatedByUserId)
      .query(`
        UPDATE dbo.TblEmpTargetPlan
        SET EffectiveTo = @effectiveTo,
            UpdatedAt = SYSDATETIME(),
            UpdatedByUserID = @updatedBy
        WHERE ID = @planId
      `);
  }
}

/**
 * Batch summary for employee list — one query, no per-row history/tiers dump.
 * Uses Cairo calendar date string passed from the service (YYYY-MM-DD).
 */
export async function getEmployeesTargetSummaryBatch(
  asOfDate: string,
): Promise<Map<number, EmployeeTargetSummaryRow>> {
  const db = await getPool();
  const result = await db
    .request()
    .input('asOf', sql.Date, asOfDate)
    .query(`
      SELECT
        e.EmpID,
        CAST(CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblEmpTargetPlan p0 WHERE p0.EmpID = e.EmpID
        ) THEN 1 ELSE 0 END AS BIT) AS HasTargetPlan,
        ep.IsEnabled AS TargetEnabled,
        ep.EffectiveFrom AS TargetEffectiveFrom,
        ep.TierCount AS TargetTierCount,
        ep.FirstDailyStart AS TargetFirstDailyStart,
        ep.FirstRatePercent AS TargetFirstRatePercent
      FROM dbo.TblEmp e
      OUTER APPLY (
        SELECT TOP 1
          p.IsEnabled,
          p.EffectiveFrom,
          (SELECT COUNT(*) FROM dbo.TblEmpTargetTier t WHERE t.TargetPlanID = p.ID) AS TierCount,
          (
            SELECT TOP 1 t.DailyStartAmount
            FROM dbo.TblEmpTargetTier t
            WHERE t.TargetPlanID = p.ID
            ORDER BY t.SortOrder ASC, t.ID ASC
          ) AS FirstDailyStart,
          (
            SELECT TOP 1 t.RatePercent
            FROM dbo.TblEmpTargetTier t
            WHERE t.TargetPlanID = p.ID
            ORDER BY t.SortOrder ASC, t.ID ASC
          ) AS FirstRatePercent
        FROM dbo.TblEmpTargetPlan p
        WHERE p.EmpID = e.EmpID
          AND p.EffectiveFrom <= @asOf
          AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @asOf)
        ORDER BY p.EffectiveFrom DESC, p.ID DESC
      ) ep
    `);

  const map = new Map<number, EmployeeTargetSummaryRow>();
  for (const row of result.recordset as Record<string, unknown>[]) {
    const empId = Number(row.EmpID);
    map.set(empId, {
      empId,
      hasTargetPlan: Boolean(row.HasTargetPlan),
      targetEnabled: row.TargetEnabled == null ? null : Boolean(row.TargetEnabled),
      targetTierCount: row.TargetTierCount == null ? null : Number(row.TargetTierCount),
      targetFirstDailyStart:
        row.TargetFirstDailyStart == null ? null : Number(row.TargetFirstDailyStart),
      targetFirstRatePercent:
        row.TargetFirstRatePercent == null ? null : Number(row.TargetFirstRatePercent),
      targetEffectiveFrom:
        row.TargetEffectiveFrom == null ? null : toDateStr(row.TargetEffectiveFrom),
    });
  }
  return map;
}
