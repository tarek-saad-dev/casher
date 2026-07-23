import 'server-only';
import { getPool, sql } from '@/lib/db';

export const PARTNER_SHARE_SUM_TOLERANCE = 0.0001;
/** Matches partners report minimum period and GLEEM seed. */
export const GLEEM_PARTNER_SHARE_EFFECTIVE_FROM = '2026-06-01';

export type BranchPartnerShareRecord = {
  branchPartnerShareId: number;
  branchId: number;
  partnerUserId: number | null;
  partnerCode: string;
  partnerName: string;
  sharePercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
};

export class PartnerShareConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PartnerShareConfigError';
    this.code = code;
  }
}

function mapShare(row: Record<string, unknown>): BranchPartnerShareRecord {
  const from = row.EffectiveFrom;
  const to = row.EffectiveTo;
  return {
    branchPartnerShareId: Number(row.BranchPartnerShareID),
    branchId: Number(row.BranchID),
    partnerUserId: row.PartnerUserID == null ? null : Number(row.PartnerUserID),
    partnerCode: String(row.PartnerCode),
    partnerName: String(row.PartnerName),
    sharePercent: Number(row.SharePercent),
    effectiveFrom:
      from instanceof Date ? from.toISOString().slice(0, 10) : String(from).slice(0, 10),
    effectiveTo:
      to == null
        ? null
        : to instanceof Date
          ? to.toISOString().slice(0, 10)
          : String(to).slice(0, 10),
    isActive: Boolean(row.IsActive),
    notes: row.Notes == null ? null : String(row.Notes),
  };
}

function periodsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/**
 * Effective partner shares for a branch on a report date.
 * Missing configuration is a hard error (no hardcoded production fallback).
 */
export async function getEffectiveBranchPartnerShares(
  branchId: number,
  reportDate: string,
): Promise<BranchPartnerShareRecord[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('reportDate', sql.Date, reportDate)
    .query(`
      SELECT
        BranchPartnerShareID, BranchID, PartnerUserID, PartnerCode, PartnerName,
        SharePercent, EffectiveFrom, EffectiveTo, IsActive, Notes
      FROM dbo.TblBranchPartnerShare
      WHERE BranchID = @branchId
        AND IsActive = 1
        AND EffectiveFrom <= @reportDate
        AND (EffectiveTo IS NULL OR EffectiveTo >= @reportDate)
      ORDER BY PartnerCode
    `);

  const rows = result.recordset.map((r) => mapShare(r as Record<string, unknown>));
  if (rows.length === 0) {
    throw new PartnerShareConfigError(
      'PARTNER_SHARE_MISSING',
      `لا توجد نسب شركاء مفعّلة لهذا الفرع في تاريخ ${reportDate}`,
    );
  }

  const total = rows.reduce((s, r) => s + r.sharePercent, 0);
  if (Math.abs(total - 100) > PARTNER_SHARE_SUM_TOLERANCE) {
    throw new PartnerShareConfigError(
      'PARTNER_SHARE_TOTAL_INVALID',
      `مجموع نسب الشركاء يجب أن يساوي 100% (الحالي ${total.toFixed(6)}%)`,
    );
  }
  return rows;
}

export async function validateBranchPartnerShares(
  branchId: number,
  effectiveDate: string,
): Promise<{ ok: true; total: number; shares: BranchPartnerShareRecord[] }> {
  const shares = await getEffectiveBranchPartnerShares(branchId, effectiveDate);
  const total = shares.reduce((s, r) => s + r.sharePercent, 0);
  return { ok: true, total, shares };
}

export async function getPartnerShareConfigurationTimeline(
  branchId: number,
): Promise<BranchPartnerShareRecord[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        BranchPartnerShareID, BranchID, PartnerUserID, PartnerCode, PartnerName,
        SharePercent, EffectiveFrom, EffectiveTo, IsActive, Notes
      FROM dbo.TblBranchPartnerShare
      WHERE BranchID = @branchId
      ORDER BY EffectiveFrom, PartnerCode
    `);
  return result.recordset.map((r) => mapShare(r as Record<string, unknown>));
}

export type CreatePartnerShareInput = {
  branchId: number;
  partnerCode: string;
  partnerName: string;
  sharePercent: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  partnerUserId?: number | null;
  createdByUserId?: number | null;
  notes?: string | null;
};

export async function createBranchPartnerSharePeriod(
  input: CreatePartnerShareInput,
): Promise<BranchPartnerShareRecord> {
  if (!(input.sharePercent > 0 && input.sharePercent <= 100)) {
    throw new PartnerShareConfigError('PARTNER_SHARE_PERCENT_INVALID', 'نسبة غير صالحة');
  }
  if (
    input.effectiveTo &&
    input.effectiveTo < input.effectiveFrom
  ) {
    throw new PartnerShareConfigError('PARTNER_SHARE_DATES_INVALID', 'تاريخ الانتهاء قبل البداية');
  }

  const timeline = await getPartnerShareConfigurationTimeline(input.branchId);
  const samePartner = timeline.filter(
    (r) => r.partnerCode === input.partnerCode && r.isActive,
  );
  for (const existing of samePartner) {
    if (
      periodsOverlap(
        input.effectiveFrom,
        input.effectiveTo ?? null,
        existing.effectiveFrom,
        existing.effectiveTo,
      )
    ) {
      throw new PartnerShareConfigError(
        'PARTNER_SHARE_OVERLAP',
        `تداخل فترة لنفس الشريك ${input.partnerCode}`,
      );
    }
  }

  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('partnerUserId', sql.Int, input.partnerUserId ?? null)
    .input('partnerCode', sql.NVarChar(50), input.partnerCode)
    .input('partnerName', sql.NVarChar(100), input.partnerName)
    .input('sharePercent', sql.Decimal(9, 6), input.sharePercent)
    .input('effectiveFrom', sql.Date, input.effectiveFrom)
    .input('effectiveTo', sql.Date, input.effectiveTo ?? null)
    .input('createdByUserId', sql.Int, input.createdByUserId ?? null)
    .input('notes', sql.NVarChar(250), input.notes ?? null)
    .query(`
      INSERT INTO dbo.TblBranchPartnerShare (
        BranchID, PartnerUserID, PartnerCode, PartnerName, SharePercent,
        EffectiveFrom, EffectiveTo, IsActive, CreatedByUserID, Notes
      )
      OUTPUT INSERTED.*
      VALUES (
        @branchId, @partnerUserId, @partnerCode, @partnerName, @sharePercent,
        @effectiveFrom, @effectiveTo, 1, @createdByUserId, @notes
      )
    `);
  return mapShare(result.recordset[0] as Record<string, unknown>);
}

export async function endBranchPartnerSharePeriod(
  branchPartnerShareId: number,
  effectiveTo: string,
  updatedByUserId?: number | null,
): Promise<void> {
  const db = await getPool();
  const result = await db
    .request()
    .input('id', sql.BigInt, branchPartnerShareId)
    .input('effectiveTo', sql.Date, effectiveTo)
    .input('updatedBy', sql.Int, updatedByUserId ?? null)
    .query(`
      UPDATE dbo.TblBranchPartnerShare
      SET EffectiveTo = @effectiveTo,
          UpdatedAt = SYSUTCDATETIME()
      WHERE BranchPartnerShareID = @id
        AND (EffectiveTo IS NULL OR EffectiveTo >= @effectiveTo)
        AND EffectiveFrom <= @effectiveTo
    `);
  if (!result.rowsAffected[0]) {
    throw new PartnerShareConfigError('PARTNER_SHARE_NOT_FOUND', 'سجل النسبة غير موجود');
  }
}

export async function updateBranchPartnerSharePeriod(
  branchPartnerShareId: number,
  patch: {
    sharePercent?: number;
    partnerName?: string;
    effectiveTo?: string | null;
    notes?: string | null;
  },
): Promise<BranchPartnerShareRecord> {
  if (patch.sharePercent != null && !(patch.sharePercent > 0 && patch.sharePercent <= 100)) {
    throw new PartnerShareConfigError('PARTNER_SHARE_PERCENT_INVALID', 'نسبة غير صالحة');
  }
  const db = await getPool();
  const result = await db
    .request()
    .input('id', sql.BigInt, branchPartnerShareId)
    .input('sharePercent', sql.Decimal(9, 6), patch.sharePercent ?? null)
    .input('partnerName', sql.NVarChar(100), patch.partnerName ?? null)
    .input('effectiveTo', sql.Date, patch.effectiveTo === undefined ? null : patch.effectiveTo)
    .input('setEffectiveTo', sql.Bit, patch.effectiveTo !== undefined ? 1 : 0)
    .input('notes', sql.NVarChar(250), patch.notes ?? null)
    .input('setNotes', sql.Bit, patch.notes !== undefined ? 1 : 0)
    .query(`
      UPDATE dbo.TblBranchPartnerShare
      SET
        SharePercent = COALESCE(@sharePercent, SharePercent),
        PartnerName = COALESCE(@partnerName, PartnerName),
        EffectiveTo = CASE WHEN @setEffectiveTo = 1 THEN @effectiveTo ELSE EffectiveTo END,
        Notes = CASE WHEN @setNotes = 1 THEN @notes ELSE Notes END,
        UpdatedAt = SYSUTCDATETIME()
      WHERE BranchPartnerShareID = @id;

      SELECT
        BranchPartnerShareID, BranchID, PartnerUserID, PartnerCode, PartnerName,
        SharePercent, EffectiveFrom, EffectiveTo, IsActive, Notes
      FROM dbo.TblBranchPartnerShare
      WHERE BranchPartnerShareID = @id
    `);
  if (!result.recordset[0]) {
    throw new PartnerShareConfigError('PARTNER_SHARE_NOT_FOUND', 'سجل النسبة غير موجود');
  }
  return mapShare(result.recordset[0] as Record<string, unknown>);
}

/** Map SQL shares to the Partner[] shape used by monthlyFinancialEquations. */
export function toPartnerPercentageList(
  shares: BranchPartnerShareRecord[],
): Array<{ name: string; percentage: number; partnerCode: string }> {
  return shares.map((s) => ({
    name: s.partnerName,
    percentage: s.sharePercent,
    partnerCode: s.partnerCode,
  }));
}
