#!/usr/bin/env npx tsx
/**
 * Phase 1Q — ensure TblEmpBranchWorkSchedule + backfill GLEEM from legacy.
 */
import path from 'path';
import fs from 'fs';
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

async function main() {
  const { getPool } = await import('@/lib/db');
  const { backfillGleemBranchSchedulesFromLegacy, ensureEmpBranchWorkScheduleTable } =
    await import('@/lib/hr/empBranchWorkSchedule');

  const pool = await getPool();

  const beforeFp = await pool.request().query(`
    SELECT EmpID, DayOfWeek, IsWorkingDay,
           CONVERT(varchar(5), StartTime, 108) AS StartTime,
           CONVERT(varchar(5), EndTime, 108) AS EndTime
    FROM dbo.TblEmpWorkSchedule
    ORDER BY EmpID, DayOfWeek
  `);

  await ensureEmpBranchWorkScheduleTable();
  const result = await backfillGleemBranchSchedulesFromLegacy({
    effectiveFrom: '2020-01-01',
    actorUserId: 10,
  });

  const afterLegacy = await pool.request().query(`
    SELECT EmpID, DayOfWeek, IsWorkingDay,
           CONVERT(varchar(5), StartTime, 108) AS StartTime,
           CONVERT(varchar(5), EndTime, 108) AS EndTime
    FROM dbo.TblEmpWorkSchedule
    ORDER BY EmpID, DayOfWeek
  `);

  const gleem = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE b.BranchCode = N'GLEEM' AND s.IsActive = 1
  `);
  const cc = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE b.BranchCode = N'CAMP_CAESAR'
      AND (s.Notes IS NULL OR (s.Notes NOT LIKE N'%SMOKE%' AND s.Notes NOT LIKE N'%phase1q-smoke%'))
  `);
  const ph1 = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE b.BranchCode = N'PH1GTEST'
      AND (s.Notes IS NULL OR (s.Notes NOT LIKE N'%SMOKE%' AND s.Notes NOT LIKE N'%phase1q-smoke%'))
  `);

  const legacyUnchanged =
    JSON.stringify(beforeFp.recordset) === JSON.stringify(afterLegacy.recordset);

  const out = {
    at: new Date().toISOString(),
    backfill: result,
    gleemBranchRows: Number(gleem.recordset[0].Cnt),
    campCaesarRealSchedules: Number(cc.recordset[0].Cnt),
    ph1gtestRealSchedules: Number(ph1.recordset[0].Cnt),
    gleemLegacyFingerprintUnchanged: legacyUnchanged,
    gleemScheduleMismatches: legacyUnchanged ? 0 : 1,
  };

  fs.writeFileSync(
    path.join(__dirname, 'branch-smoke', '_phase1q-migration-result.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));

  if (!legacyUnchanged) throw new Error('GLEEM legacy schedule fingerprint changed');
  if (Number(cc.recordset[0].Cnt) !== 0) throw new Error('CC real schedules created unexpectedly');
  if (Number(ph1.recordset[0].Cnt) !== 0) throw new Error('PH1GTEST real schedules created');

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
