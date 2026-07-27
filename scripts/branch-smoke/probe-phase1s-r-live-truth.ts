/**
 * Phase 1S-R — authoritative live probe (cloud/last132 BranchID=3).
 * No markdown inference.
 */
import Module from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const db = await getPool();
  const CC = 3;

  const branch = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT BranchID, BranchCode, BranchName, LifecycleStatus, IsActive,
           PublicBookingEnabled, ExternalNotificationsEnabled,
           Address, Phone,
           CONVERT(varchar(8), DefaultOpenTime, 108) AS OpenT,
           CONVERT(varchar(8), DefaultCloseTime, 108) AS CloseT
    FROM dbo.TblBranch WHERE BranchID=@b
  `)
  ).recordset[0];

  const qbsCols = (
    await db.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='QueueBookingSettings' ORDER BY ORDINAL_POSITION
  `)
  ).recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME);
  const qbs = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT * FROM dbo.QueueBookingSettings WHERE BranchID=@b
  `)
  ).recordset[0];

  const policyCols = await db.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='TblBranchSetupPolicy' ORDER BY ORDINAL_POSITION
  `);
  const policyColNames = policyCols.recordset.map(
    (r: { COLUMN_NAME: string }) => r.COLUMN_NAME,
  );
  const policy = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT * FROM dbo.TblBranchSetupPolicy WHERE BranchID=@b
  `)
  ).recordset[0];

  const partners = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT BranchPartnerShareID, PartnerName, PartnerCode, SharePercent,
           EffectiveFrom, EffectiveTo, IsActive, PartnerUserID
    FROM dbo.TblBranchPartnerShare WHERE BranchID=@b
    ORDER BY IsActive DESC, SharePercent DESC
  `)
  ).recordset;

  const assignments = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT ea.ID, ea.EmpID, e.EmpName, ea.IsActive, ea.CanReceiveBookings,
           ea.Notes, ea.EffectiveFrom, ea.EffectiveTo, ea.IsHomeBranch
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblEmp e ON e.EmpID=ea.EmpID
    WHERE ea.BranchID=@b
    ORDER BY ea.IsActive DESC, ea.ID DESC
  `)
  ).recordset;

  const schedules = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT s.EmpID, e.EmpName, s.DayOfWeek, s.IsWorking,
           CONVERT(varchar(5), s.StartTime, 108) AS S,
           CONVERT(varchar(5), s.EndTime, 108) AS E,
           s.IsActive, s.EffectiveFrom
    FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblEmp e ON e.EmpID=s.EmpID
    WHERE s.BranchID=@b AND s.IsActive=1
    ORDER BY s.EmpID, s.DayOfWeek
  `)
  ).recordset;

  const payroll = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT p.PlanID, p.EmpID, e.EmpName, p.PayType, p.HourlyRate, p.DailyRate,
           p.MonthlySalary, p.EffectiveFrom, p.IsActive
    FROM dbo.TblEmpBranchPayrollPlan p
    INNER JOIN dbo.TblEmp e ON e.EmpID=p.EmpID
    WHERE p.BranchID=@b
    ORDER BY p.IsActive DESC, p.EmpID
  `)
  ).recordset;

  const targets = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT t.ID, t.EmpID, e.EmpName, t.IsEnabled, t.Notes, t.EffectiveFrom
    FROM dbo.TblEmpTargetPlan t
    INNER JOIN dbo.TblEmp e ON e.EmpID=t.EmpID
    WHERE t.BranchID=@b
    ORDER BY t.EmpID, t.ID DESC
  `)
  ).recordset;

  const smokes = (
    await db.request().input('b', sql.Int, CC).query(`
    SELECT * FROM dbo.TblBranchSmokeRun
    WHERE BranchID=@b AND SmokeRunID IN (16, 18)
    ORDER BY SmokeRunID
  `)
  ).recordset;

  const smokeArtifacts = (
    await db.request().query(`
    SELECT SmokeRunID, EntityType, COUNT(*) AS Cnt
    FROM dbo.TblBranchSmokeArtifact
    WHERE SmokeRunID IN (16, 18)
    GROUP BY SmokeRunID, EntityType
    ORDER BY SmokeRunID, EntityType
  `)
  ).recordset;

  // Lifecycle audit table discovery
  const auditTables = (
    await db.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Branch%Lifecycle%' OR TABLE_NAME LIKE '%Lifecycle%Audit%'
       OR TABLE_NAME LIKE '%BranchAudit%'
    ORDER BY TABLE_NAME
  `)
  ).recordset;

  let lifecycleAudit: unknown[] = [];
  for (const t of ['TblBranchLifecycleAudit', 'TblBranchLifecycleHistory', 'TblBranchAuditLog']) {
    const exists = await db.request().input('t', sql.NVarChar(128), t).query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.' + @t, N'U') IS NULL THEN 0 ELSE 1 END AS Has
    `);
    if (Number(exists.recordset[0].Has) === 1) {
      try {
        lifecycleAudit = (
          await db.request().input('b', sql.Int, CC).query(`
            SELECT TOP 20 * FROM dbo.[${t}] WHERE BranchID=@b ORDER BY 1 DESC
          `)
        ).recordset;
        break;
      } catch {
        /* try next */
      }
    }
  }

  // Try notes/reason columns on common audit
  if (!lifecycleAudit.length) {
    const has = await db.request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.TblBranchLifecycleEvent', N'U') IS NULL THEN 0 ELSE 1 END AS Has
    `);
    if (Number(has.recordset[0].Has) === 1) {
      lifecycleAudit = (
        await db.request().input('b', sql.Int, CC).query(`
          SELECT TOP 20 * FROM dbo.TblBranchLifecycleEvent WHERE BranchID=@b ORDER BY 1 DESC
        `)
      ).recordset;
    }
  }

  // Service catalog
  const services = (
    await db.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0) AS ActiveRows,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=1) AS DeletedRows,
      (SELECT COUNT(*) FROM dbo.TblPro p
         WHERE ISNULL(p.isDeleted,0)=0 AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)
           AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro',N'product')) AS PricedNonProduct,
      (SELECT COUNT(*) FROM dbo.TblPro p
         LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
         WHERE ISNULL(p.isDeleted,0)=0
           AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)
           AND ISNULL(p.DurationMinutes,0)>0
           AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro',N'product')
           AND LOWER(ISNULL(c.CatType,N'')) <> N'pro'
           AND ISNULL(c.CatName,N'') NOT LIKE N'%منتج%') AS BookableServices,
      (SELECT COUNT(*) FROM dbo.TblPro p
         WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.DurationMinutes,0)>0
           AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)) AS TimedPriced,
      (SELECT COUNT(*) FROM dbo.TblPro p
         LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
         WHERE ISNULL(p.isDeleted,0)=0
           AND (LOWER(ISNULL(p.ProType,N'')) IN (N'pro',N'product')
                OR LOWER(ISNULL(c.CatType,N''))=N'pro')) AS ActiveProducts
  `)
  ).recordset[0];

  const topServices = (
    await db.request().query(`
    SELECT TOP 30 p.ProID, p.ProName, p.ProType, ISNULL(p.SPrice1,p.PPrice) AS Price,
           p.DurationMinutes, c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
    WHERE ISNULL(p.isDeleted,0)=0
      AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)
      AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro',N'product')
    ORDER BY p.ProName
  `)
  ).recordset;

  const dryHairOnly = (
    await db.request().query(`
    SELECT ProID, ProName, isDeleted, SPrice1, PPrice, DurationMinutes
    FROM dbo.TblPro
    WHERE ProName LIKE N'%Dry%' OR ProName LIKE N'%دراي%' OR ProName LIKE N'%شعر جاف%'
  `)
  ).recordset;

  // Parse smoke proofs
  const smokeFull = (
    await db.request().query(`
    SELECT SmokeRunID, Status, CleanupStatus, Purpose,
           CAST(ResultJson AS nvarchar(max)) AS ResultJson
    FROM dbo.TblBranchSmokeRun WHERE SmokeRunID IN (16, 18)
  `)
  ).recordset;

  const smokeParsed = smokeFull.map((r: { SmokeRunID: number; Status: string; CleanupStatus: string; Purpose: string; ResultJson: string }) => {
    let proofs: Record<string, unknown> = {};
    let phase: string | null = null;
    let retainedFrom: unknown = null;
    try {
      const j = JSON.parse(String(r.ResultJson || '{}'));
      proofs = (j.proofs && typeof j.proofs === 'object' ? j.proofs : j) as Record<string, unknown>;
      phase = j.phase ?? null;
      retainedFrom = j.retainedFromSmokeRunId ?? proofs.retainedFromSmokeRunId ?? null;
    } catch {
      /* */
    }
    return {
      smokeRunId: Number(r.SmokeRunID),
      status: r.Status,
      cleanupStatus: r.CleanupStatus,
      purpose: r.Purpose,
      phase,
      retainedFrom,
      proofKeys: Object.keys(proofs),
      hasPosCash: Boolean(proofs['pos.cashInvoice']),
      hasPosCard: Boolean(proofs['pos.cardInvoice']),
      hasPayrollHourly: Boolean(proofs['payroll.hourlyLedgerCredit']),
      hasOpeningCash: Boolean(proofs['opening.cash_zero']),
      hasRosterZiad: Boolean(proofs['roster.ziad_assigned']),
      hasTransferApply: Boolean(
        proofs.apply || proofs['transfer.id'] || proofs.phase === '1S-1R',
      ),
      looksRetainedOnly:
        retainedFrom != null ||
        Boolean(proofs['prior.smoke_run_11_retained']) ||
        String(r.Purpose || '').includes('retained'),
    };
  });

  // Branch hours weekdays — assume all days open if overnight hours set
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const coverage = days.map((name, dow) => {
    const workers = schedules.filter(
      (s: { DayOfWeek: number; IsWorking: boolean | number }) =>
        Number(s.DayOfWeek) === dow && Boolean(s.IsWorking),
    );
    return {
      dayOfWeek: dow,
      day: name,
      workingEmployees: workers.map((w: { EmpID: number; EmpName: string; S: string; E: string }) => ({
        empId: w.EmpID,
        empName: w.EmpName,
        hours: `${w.S}-${w.E}`,
      })),
      covered: workers.length > 0,
    };
  });

  const gleem = (
    await db.request().query(`
    SELECT LifecycleStatus, IsActive, PublicBookingEnabled FROM dbo.TblBranch WHERE BranchID=1
  `)
  ).recordset[0];

  const out = {
    probedAt: new Date().toISOString(),
    database: process.env.CLOUD_DB_NAME,
    branch,
    qbsCols,
    qbs,
    policyColNames,
    policy,
    partners,
    assignments,
    schedules,
    payroll,
    targets,
    smokesPreview: smokes,
    smokeArtifacts,
    smokeParsed,
    auditTables,
    lifecycleAuditSample: lifecycleAudit.slice(0, 10),
    services,
    topServices,
    dryHairOnly,
    weeklyCoverage: coverage,
    gleem,
  };

  const path = join(__dirname, '_phase1s-r-live-probe.json');
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    path,
    lifecycle: branch?.LifecycleStatus,
    isActive: branch?.IsActive,
    publicBooking: branch?.PublicBookingEnabled,
    activeAssignments: assignments.filter((a: { IsActive: boolean }) => a.IsActive).map((a: { EmpID: number; EmpName: string }) => `${a.EmpID}:${a.EmpName}`),
    smoke16: smokeParsed.find((s) => s.smokeRunId === 16),
    smoke18: smokeParsed.find((s) => s.smokeRunId === 18),
    bookableServices: services?.BookableServices,
    pricedNonProduct: services?.PricedNonProduct,
    uncoveredDays: coverage.filter((c) => !c.covered).map((c) => c.day),
  }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
