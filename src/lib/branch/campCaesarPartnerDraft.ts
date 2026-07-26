/**
 * Phase 1O — Camp Caesar partner-share draft (40/20/20/20) without inventing EffectiveFrom.
 * Draft rows: IsActive=0 so they never enter report resolution until activated with a real opening date.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { PartnerShareConfigError, PARTNER_SHARE_SUM_TOLERANCE } from './partnerShares';
import { upsertBranchSetupPolicy } from './branchSetupPolicy';

export const CAMP_CAESAR_PARTNER_DRAFT = [
  { partnerCode: 'AAYIDA', partnerName: 'أ/ عايدة', sharePercent: 40, preferredUserNames: [/عايدة/i, /aida/i] },
  { partnerCode: 'TAREK', partnerName: 'أ/ طارق', sharePercent: 20, preferredUserNames: [/^tarek$/i, /طارق/] },
  { partnerCode: 'ZIYAD_CC', partnerName: 'أ/ ذياد', sharePercent: 20, preferredUserNames: [/^mr\.ziad$/i, /ذياد/, /زياد/] },
  { partnerCode: 'OMAR_CC', partnerName: 'أ/ عمر', sharePercent: 20, preferredUserNames: [/^omar$/i, /عمر/] },
] as const;

export type PartnerIdentityResolution = {
  partnerCode: string;
  partnerName: string;
  sharePercent: number;
  partnerUserId: number | null;
  status: 'resolved' | 'unmatched' | 'ambiguous';
  matchedUserIds: number[];
  matchedUserNames: string[];
  detail: string;
};

export type PartnerDraftResult = {
  resolutions: PartnerIdentityResolution[];
  inserted: number;
  updated: number;
  totalPercent: number;
  effectiveFromStatus: 'PENDING_OPENING_DATE';
  draftRows: Array<{
    branchPartnerShareId: number;
    partnerCode: string;
    sharePercent: number;
    isActive: boolean;
  }>;
};

const DRAFT_NOTE = 'PHASE1O_DRAFT_PENDING_OPENING_DATE';
/** Placeholder date — never used while IsActive=0; not an invented opening date. */
const DRAFT_EFFECTIVE_FROM = '2099-01-01';

export async function resolveCampCaesarPartnerIdentities(): Promise<PartnerIdentityResolution[]> {
  const db = await getPool();
  const users = await db.request().query(`
    SELECT UserID, UserName FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0
  `);
  const list = users.recordset.map((u) => ({
    userId: Number(u.UserID),
    userName: String(u.UserName ?? ''),
  }));

  return CAMP_CAESAR_PARTNER_DRAFT.map((p) => {
    const matched = list.filter((u) => p.preferredUserNames.some((re) => re.test(u.userName)));
    if (matched.length > 1) {
      return {
        partnerCode: p.partnerCode,
        partnerName: p.partnerName,
        sharePercent: p.sharePercent,
        partnerUserId: null,
        status: 'ambiguous' as const,
        matchedUserIds: matched.map((m) => m.userId),
        matchedUserNames: matched.map((m) => m.userName),
        detail: 'Multiple persisted users match — mapping stopped',
      };
    }
    if (matched.length === 1) {
      return {
        partnerCode: p.partnerCode,
        partnerName: p.partnerName,
        sharePercent: p.sharePercent,
        partnerUserId: matched[0].userId,
        status: 'resolved' as const,
        matchedUserIds: [matched[0].userId],
        matchedUserNames: [matched[0].userName],
        detail: `Mapped to UserID=${matched[0].userId}`,
      };
    }
    return {
      partnerCode: p.partnerCode,
      partnerName: p.partnerName,
      sharePercent: p.sharePercent,
      partnerUserId: null,
      status: 'unmatched' as const,
      matchedUserIds: [],
      matchedUserNames: [],
      detail: 'No matching user — draft partner identity without PartnerUserID',
    };
  });
}

/**
 * Upsert inactive draft partner shares for Camp Caesar. Does not activate or set a real EffectiveFrom.
 */
export async function upsertCampCaesarPartnerShareDraft(
  branchId: number,
  actorUserId?: number | null,
): Promise<PartnerDraftResult> {
  const resolutions = await resolveCampCaesarPartnerIdentities();
  const ambiguous = resolutions.filter((r) => r.status === 'ambiguous');
  if (ambiguous.length) {
    throw new PartnerShareConfigError(
      'PARTNER_IDENTITY_AMBIGUOUS',
      `Ambiguous partner identities: ${ambiguous.map((a) => a.partnerName).join(', ')}`,
    );
  }

  const totalPercent = resolutions.reduce((s, r) => s + r.sharePercent, 0);
  if (Math.abs(totalPercent - 100) > PARTNER_SHARE_SUM_TOLERANCE) {
    throw new PartnerShareConfigError(
      'PARTNER_SHARE_TOTAL_INVALID',
      `Draft total ${totalPercent} != 100`,
    );
  }

  const db = await getPool();
  let inserted = 0;
  let updated = 0;
  const draftRows: PartnerDraftResult['draftRows'] = [];

  for (const r of resolutions) {
    const existing = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('code', sql.NVarChar(50), r.partnerCode)
      .query(`
        SELECT TOP 1 BranchPartnerShareID
        FROM dbo.TblBranchPartnerShare
        WHERE BranchID = @branchId AND PartnerCode = @code
          AND Notes LIKE N'%PHASE1O_DRAFT_PENDING_OPENING_DATE%'
        ORDER BY BranchPartnerShareID DESC
      `);

    if (existing.recordset[0]) {
      const id = Number(existing.recordset[0].BranchPartnerShareID);
      await db
        .request()
        .input('id', sql.BigInt, id)
        .input('name', sql.NVarChar(100), r.partnerName)
        .input('pct', sql.Decimal(9, 6), r.sharePercent)
        .input('uid', sql.Int, r.partnerUserId)
        .query(`
          UPDATE dbo.TblBranchPartnerShare
          SET PartnerName = @name,
              SharePercent = @pct,
              PartnerUserID = @uid,
              IsActive = 0,
              EffectiveFrom = '${DRAFT_EFFECTIVE_FROM}',
              EffectiveTo = NULL,
              Notes = N'${DRAFT_NOTE}',
              UpdatedAt = SYSUTCDATETIME()
          WHERE BranchPartnerShareID = @id
        `);
      updated += 1;
      draftRows.push({
        branchPartnerShareId: id,
        partnerCode: r.partnerCode,
        sharePercent: r.sharePercent,
        isActive: false,
      });
    } else {
      const ins = await db
        .request()
        .input('branchId', sql.Int, branchId)
        .input('uid', sql.Int, r.partnerUserId)
        .input('code', sql.NVarChar(50), r.partnerCode)
        .input('name', sql.NVarChar(100), r.partnerName)
        .input('pct', sql.Decimal(9, 6), r.sharePercent)
        .input('actor', sql.Int, actorUserId ?? null)
        .query(`
          INSERT INTO dbo.TblBranchPartnerShare (
            BranchID, PartnerUserID, PartnerCode, PartnerName, SharePercent,
            EffectiveFrom, EffectiveTo, IsActive, CreatedByUserID, Notes
          )
          OUTPUT INSERTED.BranchPartnerShareID
          VALUES (
            @branchId, @uid, @code, @name, @pct,
            '${DRAFT_EFFECTIVE_FROM}', NULL, 0, @actor, N'${DRAFT_NOTE}'
          )
        `);
      inserted += 1;
      draftRows.push({
        branchPartnerShareId: Number(ins.recordset[0].BranchPartnerShareID),
        partnerCode: r.partnerCode,
        sharePercent: r.sharePercent,
        isActive: false,
      });
    }
  }

  await upsertBranchSetupPolicy(branchId, { partnerSharesDraftReady: true });

  return {
    resolutions,
    inserted,
    updated,
    totalPercent,
    effectiveFromStatus: 'PENDING_OPENING_DATE',
    draftRows,
  };
}
