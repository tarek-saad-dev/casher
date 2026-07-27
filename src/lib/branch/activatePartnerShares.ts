/**
 * Phase 1S — activate Camp Caesar partner share drafts with a real EffectiveFrom.
 * Never mutates GLEEM (BranchID=1).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BranchDomainError } from './types';
import { PARTNER_SHARE_SUM_TOLERANCE } from './partnerShares';
import { upsertBranchSetupPolicy } from './branchSetupPolicy';

const DRAFT_NOTE = 'PHASE1O_DRAFT_PENDING_OPENING_DATE';

export async function activateBranchPartnerShares(args: {
  branchId: number;
  effectiveFrom: string;
  actorUserId: number;
}): Promise<{
  activated: number;
  totalPercent: number;
  effectiveFrom: string;
  rows: Array<{ partnerName: string; sharePercent: number; isActive: boolean }>;
}> {
  if (args.branchId === 1) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'لا يمكن تفعيل مسودة الشركاء على GLEEM من هذا المسار', 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تاريخ بدء التشغيل غير صالح', 400);
  }
  if (args.effectiveFrom.startsWith('2099')) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'لا يُسمح بتاريخ placeholder 2099', 400);
  }

  const db = await getPool();
  const drafts = await db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT BranchPartnerShareID, PartnerName, SharePercent, IsActive, Notes, EffectiveFrom
      FROM dbo.TblBranchPartnerShare
      WHERE BranchID = @branchId
        AND (
          IsActive = 0
          OR Notes LIKE N'%${DRAFT_NOTE}%'
          OR EffectiveFrom >= '2099-01-01'
        )
    `);

  if (!drafts.recordset.length) {
    // Already active non-draft?
    const active = await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .query(`
        SELECT PartnerName, SharePercent, IsActive
        FROM dbo.TblBranchPartnerShare
        WHERE BranchID = @branchId AND IsActive = 1
          AND (Notes IS NULL OR Notes NOT LIKE N'%${DRAFT_NOTE}%')
      `);
    const total = active.recordset.reduce(
      (s: number, r: { SharePercent: number }) => s + Number(r.SharePercent),
      0,
    );
    if (Math.abs(total - 100) <= PARTNER_SHARE_SUM_TOLERANCE && active.recordset.length > 0) {
      await upsertBranchSetupPolicy(args.branchId, {
        internalLiveEffectiveDate: args.effectiveFrom,
        notes: `Partner shares already active; InternalLiveEffectiveDate=${args.effectiveFrom}`,
      });
      return {
        activated: 0,
        totalPercent: total,
        effectiveFrom: args.effectiveFrom,
        rows: active.recordset.map((r: { PartnerName: string; SharePercent: number; IsActive: boolean }) => ({
          partnerName: String(r.PartnerName),
          sharePercent: Number(r.SharePercent),
          isActive: Boolean(r.IsActive),
        })),
      };
    }
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'لا توجد مسودة نسب شركاء للتفعيل', 400);
  }

  const total = drafts.recordset.reduce(
    (s: number, r: { SharePercent: number }) => s + Number(r.SharePercent),
    0,
  );
  if (Math.abs(total - 100) > PARTNER_SHARE_SUM_TOLERANCE) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      `مجموع نسب المسودة ${total}% وليس 100%`,
      400,
    );
  }

  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    // Soft-deactivate other active periods that would conflict at the new date
    await new sql.Request(tx)
      .input('branchId', sql.Int, args.branchId)
      .input('from', sql.Date, args.effectiveFrom)
      .query(`
        UPDATE dbo.TblBranchPartnerShare
        SET IsActive = 0,
            Notes = CONCAT(ISNULL(Notes, N''), N' | SUPERSEDED_BY_PHASE1S_ACTIVATION')
        WHERE BranchID = @branchId
          AND IsActive = 1
          AND (Notes IS NULL OR Notes NOT LIKE N'%${DRAFT_NOTE}%')
          AND EffectiveFrom >= @from
      `);

    await new sql.Request(tx)
      .input('branchId', sql.Int, args.branchId)
      .input('from', sql.Date, args.effectiveFrom)
      .query(`
        UPDATE dbo.TblBranchPartnerShare
        SET IsActive = 1,
            EffectiveFrom = @from,
            Notes = CASE
              WHEN Notes LIKE N'%${DRAFT_NOTE}%'
                THEN REPLACE(Notes, N'${DRAFT_NOTE}', N'PHASE1S_ACTIVATED')
              ELSE CONCAT(ISNULL(Notes, N''), N' | PHASE1S_ACTIVATED')
            END
        WHERE BranchID = @branchId
          AND (
            IsActive = 0
            OR Notes LIKE N'%${DRAFT_NOTE}%'
            OR EffectiveFrom >= '2099-01-01'
          )
      `);

    await tx.commit();
  } catch (e) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw e;
  }

  await upsertBranchSetupPolicy(args.branchId, {
    internalLiveEffectiveDate: args.effectiveFrom,
    partnerSharesDraftReady: true,
    notes: `Phase 1S partner shares activated EffectiveFrom=${args.effectiveFrom} by user ${args.actorUserId}`,
  });

  const rows = await db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT PartnerName, SharePercent, IsActive
      FROM dbo.TblBranchPartnerShare
      WHERE BranchID = @branchId AND IsActive = 1
      ORDER BY SharePercent DESC
    `);

  return {
    activated: rows.recordset.length,
    totalPercent: total,
    effectiveFrom: args.effectiveFrom,
    rows: rows.recordset.map((r: { PartnerName: string; SharePercent: number; IsActive: boolean }) => ({
      partnerName: String(r.PartnerName),
      sharePercent: Number(r.SharePercent),
      isActive: Boolean(r.IsActive),
    })),
  };
}
