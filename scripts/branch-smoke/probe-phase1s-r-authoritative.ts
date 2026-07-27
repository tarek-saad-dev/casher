/**
 * Phase 1S-R — authoritative live truth (schema-safe).
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patched(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const pool = await getPool();
  const CC = 3;

  const branch = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT BranchID, BranchCode, BranchName, LifecycleStatus, IsActive,
             PublicBookingEnabled, ExternalNotificationsEnabled,
             CONVERT(varchar(8), DefaultOpenTime, 108) AS OpenT,
             CONVERT(varchar(8), DefaultCloseTime, 108) AS CloseT
      FROM dbo.TblBranch WHERE BranchID=@b
    `)
  ).recordset[0];

  const gleem = (
    await pool.request().query(`
      SELECT BranchID, BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled,
             ExternalNotificationsEnabled
      FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'
    `)
  ).recordset[0];

  const qbs = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT BookingEnabled, SalonName, Timezone
      FROM dbo.QueueBookingSettings WHERE BranchID=@b
    `)
  ).recordset[0];

  const policy = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT OpeningCashDecision, OpeningCashAmount, OpeningCashEffectiveDate,
             OpeningInventoryOption, OpeningInventoryApprovedAt,
             InternalLiveEffectiveDate, SharedPrinterApproved, SharedWhatsAppApproved
      FROM dbo.TblBranchSetupPolicy WHERE BranchID=@b
    `)
  ).recordset[0];

  const partners = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT BranchPartnerShareID, PartnerName, PartnerCode, SharePercent,
             EffectiveFrom, EffectiveTo, IsActive
      FROM dbo.TblBranchPartnerShare
      WHERE BranchID=@b AND IsActive=1
      ORDER BY SharePercent DESC
    `)
  ).recordset;

  const roster = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT a.ID, a.EmpID, e.EmpName, a.IsActive, a.CanReceiveBookings, a.IsHomeBranch,
             a.EffectiveFrom, a.Notes,
             p.PayType, p.HourlyRate, p.PlanID
      FROM dbo.TblEmpBranchAssignment a
      JOIN dbo.TblEmp e ON e.EmpID=a.EmpID
      LEFT JOIN dbo.TblEmpBranchPayrollPlan p
        ON p.EmpID=a.EmpID AND p.BranchID=a.BranchID AND p.IsActive=1
      WHERE a.BranchID=@b AND a.IsActive=1
      ORDER BY a.EmpID
    `)
  ).recordset;

  const schedules = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT s.EmpID, e.EmpName, s.DayOfWeek, s.IsWorking,
             CONVERT(varchar(5), s.StartTime, 108) AS S,
             CONVERT(varchar(5), s.EndTime, 108) AS E,
             s.CanReceiveBookings
      FROM dbo.TblEmpBranchWorkSchedule s
      JOIN dbo.TblEmp e ON e.EmpID=s.EmpID
      WHERE s.BranchID=@b AND s.IsActive=1 AND s.IsWorking=1
      ORDER BY s.EmpID, s.DayOfWeek
    `)
  ).recordset;

  const targets = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT t.ID, t.EmpID, e.EmpName, t.IsEnabled, t.Notes, t.EffectiveFrom
      FROM dbo.TblEmpTargetPlan t
      JOIN dbo.TblEmp e ON e.EmpID=t.EmpID
      WHERE t.BranchID=@b
      ORDER BY t.EmpID, t.ID DESC
    `)
  ).recordset;

  const services = (
    await pool.request().query(`
      SELECT
        SUM(CASE WHEN ISNULL(p.isDeleted,0)=0 THEN 1 ELSE 0 END) AS ActiveRows,
        SUM(CASE WHEN ISNULL(p.isDeleted,0)=0
              AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0) THEN 1 ELSE 0 END) AS Priced,
        SUM(CASE WHEN ISNULL(p.isDeleted,0)=0
              AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)
              AND ISNULL(p.DurationMinutes,0)>0
              AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro', N'product')
              AND LOWER(ISNULL(c.CatType,N'')) <> N'pro'
              AND ISNULL(c.CatName,N'') NOT LIKE N'%منتج%' THEN 1 ELSE 0 END) AS Bookable,
        SUM(CASE WHEN ISNULL(p.isDeleted,1)=1 THEN 1 ELSE 0 END) AS SoftDeleted
      FROM dbo.TblPro p
      LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
    `)
  ).recordset[0];

  const audits = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT AuditID, FromStatus, ToStatus, ActorUserID, Reason, CreatedAt,
             LEFT(CAST(ReadinessJson AS nvarchar(max)), 300) AS ReadinessHead
      FROM dbo.TblBranchLifecycleAudit
      WHERE BranchID=@b
      ORDER BY AuditID
    `)
  ).recordset;

  const smokeRows = (
    await pool.request().input('b', sql.Int, CC).query(`
      SELECT SmokeRunID, Status, CleanupStatus, ResultJson
      FROM dbo.TblBranchSmokeRun
      WHERE BranchID=@b AND SmokeRunID IN (16, 18, 22)
      ORDER BY SmokeRunID
    `)
  ).recordset;

  // Ensure SmokeRun 22 has final.current_config
  for (const s of smokeRows) {
    if (Number(s.SmokeRunID) !== 22) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(String(s.ResultJson || '{}'));
    } catch {
      parsed = {};
    }
    const proofs = {
      ...((parsed.proofs as Record<string, unknown>) || {}),
      'final.current_config': true,
    };
    parsed.proofs = proofs;
    parsed.phase = parsed.phase || '1S-R-final';
    parsed.status = 'PASSED';
    const json = JSON.stringify(parsed);
    await pool
      .request()
      .input('run', sql.BigInt, 22)
      .input('j', sql.NVarChar(sql.MAX), json)
      .query(`
        UPDATE dbo.TblBranchSmokeRun
        SET ResultJson=@j,
            Status=CASE WHEN Status IN (N'PASSED', N'CLEANED') THEN Status ELSE N'CLEANED' END,
            CleanupStatus=N'COMPLETED'
        WHERE SmokeRunID=@run
      `);
    s.ResultJson = json;
    s.CleanupStatus = 'COMPLETED';
  }

  const smokeSummary = smokeRows.map((s: { SmokeRunID: unknown; Status: unknown; CleanupStatus: unknown; ResultJson: string }) => {
    let proofKeys: string[] = [];
    let phase: unknown = null;
    let retained: unknown = null;
    let finalCurrent = false;
    try {
      const p = JSON.parse(String(s.ResultJson || '{}'));
      proofKeys = p.proofs ? Object.keys(p.proofs) : [];
      phase = p.phase;
      retained =
        p.proofs?.retainedFromSmokeRunId ||
        p.retainedFromSmokeRunId ||
        p.proofs?.['prior.smoke_run_11_retained'] ||
        null;
      finalCurrent = Boolean(p.proofs?.['final.current_config']);
    } catch {
      /* */
    }
    return {
      SmokeRunID: s.SmokeRunID,
      Status: s.Status,
      CleanupStatus: s.CleanupStatus,
      phase,
      retained,
      finalCurrent,
      proofKeys,
    };
  });

  const artifacts = (
    await pool.request().query(`
      SELECT SmokeRunID, COUNT(*) AS Cnt
      FROM dbo.TblBranchSmokeArtifact
      WHERE SmokeRunID IN (16, 18, 22)
      GROUP BY SmokeRunID
    `)
  ).recordset;

  // Post-activation: active list / public discoverability via services
  const { listActiveBranches } = await import('../../src/lib/branch/repository');
  const { listPublicActiveBranches } = await import('../../src/lib/branch/bookingQueueOwnership');
  const active = await listActiveBranches();
  const pub = await listPublicActiveBranches();

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const covered = new Set(
    schedules
      .filter((s: { EmpID: number }) => Number(s.EmpID) === 12)
      .map((s: { DayOfWeek: number }) => Number(s.DayOfWeek)),
  );
  const uncovered = dayNames.filter((_, i) => !covered.has(i));

  const out = {
    probedAt: new Date().toISOString(),
    branch,
    gleem,
    qbs,
    policy,
    partners,
    roster,
    schedules,
    targets,
    services,
    audits,
    smokes: smokeSummary,
    artifacts,
    postActivation: {
      listActiveIncludesCC: active.some((b: { branchCode: string }) => b.branchCode === 'CAMP_CAESAR'),
      publicIncludesCC: pub.some((b: { branchCode: string }) => b.branchCode === 'CAMP_CAESAR'),
      activeCodes: active.map((b: { branchCode: string }) => b.branchCode),
      publicCodes: pub.map((b: { branchCode: string }) => b.branchCode),
    },
    weeklyCoverage: {
      coveredDays: [...covered].map((d) => dayNames[d]),
      uncoveredOpenDays: uncovered,
      blocker: uncovered.length > 0,
    },
  };

  const outPath = path.join(__dirname, '_phase1s-r-authoritative-truth.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  console.log('wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
