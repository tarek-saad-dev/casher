/**
 * Replace Camp Caesar partner shares — delete old, insert new from branch opening.
 * أ/ طارق 31.67% · أ/ ذياد 31.67% · أ/ سعد 28.33% · أ/ عمر 8.33%
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const CAMP_CAESAR_BRANCH_ID = 3;
const EFFECTIVE_FROM = '2026-07-27';
const NOTES = 'CC_PARTNERS_REPLACED_2026-08-31';

const NEW_PARTNERS = [
  {
    partnerCode: 'TAREK_CC',
    partnerName: 'أ/ طارق',
    sharePercent: 31.67,
    partnerUserId: 13,
  },
  {
    partnerCode: 'ZIYAD_CC',
    partnerName: 'أ/ ذياد',
    sharePercent: 31.67,
    partnerUserId: 17,
  },
  {
    partnerCode: 'SAAD_CC',
    partnerName: 'أ/ سعد',
    sharePercent: 28.33,
    partnerUserId: 10, // admin — no separate Saad login
  },
  {
    partnerCode: 'OMAR_CC',
    partnerName: 'أ/ عمر',
    sharePercent: 8.33,
    partnerUserId: 16,
  },
] as const;

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { createBranchPartnerSharePeriod, validateBranchPartnerShares } = await import(
    '@/lib/branch/partnerShares'
  );
  const { upsertBranchSetupPolicy } = await import('@/lib/branch/branchSetupPolicy');

  const db = await getPool();
  const actorRes = await db.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY CASE WHEN UserLevel IN (N'Admin', N'admin', N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID) || 10;

  const before = await db.request().input('bid', sql.Int, CAMP_CAESAR_BRANCH_ID).query(`
    SELECT PartnerCode, PartnerName, SharePercent, IsActive, EffectiveFrom
    FROM dbo.TblBranchPartnerShare WHERE BranchID = @bid ORDER BY PartnerCode
  `);
  console.log('BEFORE:', before.recordset);

  const del = await db.request().input('bid', sql.Int, CAMP_CAESAR_BRANCH_ID).query(`
    DELETE FROM dbo.TblBranchPartnerShare WHERE BranchID = @bid
  `);
  console.log(`Deleted ${del.rowsAffected[0]} old partner rows`);

  const inserted: unknown[] = [];
  for (const p of NEW_PARTNERS) {
    const row = await createBranchPartnerSharePeriod({
      branchId: CAMP_CAESAR_BRANCH_ID,
      partnerCode: p.partnerCode,
      partnerName: p.partnerName,
      sharePercent: p.sharePercent,
      effectiveFrom: EFFECTIVE_FROM,
      partnerUserId: p.partnerUserId,
      createdByUserId: actorUserId,
      notes: NOTES,
    });
    inserted.push({
      partnerCode: row.partnerCode,
      partnerName: row.partnerName,
      sharePercent: row.sharePercent,
      partnerUserId: row.partnerUserId,
      id: row.branchPartnerShareId,
    });
    console.log(`INSERT ${p.partnerCode} ${p.sharePercent}% user=${p.partnerUserId}`);
  }

  await upsertBranchSetupPolicy(CAMP_CAESAR_BRANCH_ID, {
    partnerSharesDraftReady: true,
    internalLiveEffectiveDate: EFFECTIVE_FROM,
    notes: `Partner shares replaced ${NOTES} by user ${actorUserId}`,
  });

  const validation = await validateBranchPartnerShares(CAMP_CAESAR_BRANCH_ID, '2026-08-31');
  console.log('\nVALIDATION Aug 2026:', {
    total: validation.total,
    shares: validation.shares.map((s) => ({
      name: s.partnerName,
      pct: s.sharePercent,
      userId: s.partnerUserId,
    })),
  });

  const after = await db.request().input('bid', sql.Int, CAMP_CAESAR_BRANCH_ID).query(`
    SELECT BranchPartnerShareID, PartnerCode, PartnerName, SharePercent, PartnerUserID, IsActive, EffectiveFrom
    FROM dbo.TblBranchPartnerShare WHERE BranchID = @bid ORDER BY SharePercent DESC
  `);
  console.log('\nAFTER:');
  console.table(after.recordset);

  process.exit(Math.abs(validation.total - 100) < 0.0001 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
