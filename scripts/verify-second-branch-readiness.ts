#!/usr/bin/env npx tsx
/**
 * Phase 1G verifier — second-branch operational readiness.
 *
 * Combines raw-SQL schema/ownership checks (same style as the 1B–1F
 * verifiers) with the production readiness/assignment-integrity helpers from
 * `@/lib/branch`, so this verifier exercises the same code paths the app
 * uses at runtime.
 *
 * Only fails on schema/assignment-integrity errors and GLEEM not being
 * ready. A missing/not-yet-ready second branch is reported, not a failure —
 * Phase 1G does not require a second branch to exist.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// `server-only` throws when imported outside a bundler's "react-server"
// condition. Stub it out so `@/lib/branch/*` modules load under plain tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    }
  }
  return { expectedDatabase, mode };
}

function buildConfig(mode: string): sql.config {
  if (mode === 'local') {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: {
        encrypt: process.env.LOCAL_DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 180000,
    };
  }
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 180000,
  };
}

const REQUIRED_BRANCH_INDEXES = [
  'UQ_TblBranch_BranchCode',
  'UQ_TblBranch_BranchName',
  'UX_TblBranch_ShortName_NotNull',
];

const FORBIDDEN_HR_TABLES = [
  // Phase 1K owns attendance BranchID; payroll/ledger/target/budget stay deferred.
  'TblEmpPayroll',
  'TblEmpTarget',
  'TblEmpLedgerEntry',
  'TblBudget',
];

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = buildConfig(mode);

  console.log('Phase 1G second-branch readiness verifier');
  console.log(`  selected mode: ${mode}`);
  console.log(`  database: ${config.database}`);

  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  const failures: string[] = [];
  const warnings: string[] = [];

  const pool = await sql.connect(config);
  try {
    // 1. Branch-uniqueness migration present
    const idxRes = await pool.request().query(`
      SELECT name FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.TblBranch')
        AND name IN (${REQUIRED_BRANCH_INDEXES.map((n) => `N'${n}'`).join(', ')})
    `);
    const idxNames = new Set(idxRes.recordset.map((r: { name: string }) => r.name));
    for (const required of REQUIRED_BRANCH_INDEXES) {
      if (!idxNames.has(required)) failures.push(`missing index/constraint: ${required}`);
    }
    console.log(`  branch uniqueness constraints present: ${[...idxNames].join(', ') || '(none)'}`);

    // 2. Every active branch has QueueBookingSettings
    const missingSettings = await pool.request().query(`
      SELECT b.BranchID, b.BranchCode
      FROM dbo.TblBranch b
      WHERE b.IsActive = 1
        AND NOT EXISTS (SELECT 1 FROM dbo.QueueBookingSettings s WHERE s.BranchID = b.BranchID)
    `);
    if (missingSettings.recordset.length) {
      failures.push(
        `active branches missing QueueBookingSettings: ${missingSettings.recordset
          .map((r: { BranchCode: string }) => r.BranchCode)
          .join(', ')}`,
      );
    }

    const activeBranchCount = await pool.request().query(`
      SELECT COUNT(*) AS cnt FROM dbo.TblBranch WHERE IsActive = 1
    `);
    const activeCount = Number(activeBranchCount.recordset[0].cnt);
    console.log(`  active branch count: ${activeCount}`);
    if (activeCount > 1 && missingSettings.recordset.length > 0) {
      failures.push(
        `multi-branch environment (${activeCount} active) with branches missing settings`,
      );
    }

    // 3. Required FKs/indexes/columns from Phase 1B–1F
    const schemaChecks = await pool.request().query(`
      SELECT
        (SELECT CASE WHEN COL_LENGTH(N'dbo.Bookings', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS BookingsBranchId,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.QueueTickets', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS QueueTicketsBranchId,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.TblNewDay', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS NewDayBranchId,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.TblShiftMove', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS ShiftMoveBranchId,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.TblinvServHead', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS InvoiceHeadBranchId,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS CashMoveBranchId,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.TblTreasuryCloseRecon', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS TreasuryReconBranchId,
        (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'FK_Bookings_BranchID') AS FkBookings,
        (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'FK_QueueTickets_BranchID') AS FkQueue,
        (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'FK_QueueBookingSettings_BranchID') AS FkSettings,
        (SELECT COUNT(*) FROM sys.columns c
           INNER JOIN sys.tables t ON t.object_id = c.object_id
           INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
           WHERE c.name = N'BranchID' AND s.name = N'dbo'
             AND t.name IN (${FORBIDDEN_HR_TABLES.map((n) => `N'${n}'`).join(', ')})
        ) AS ForbiddenHrBranchColumns
    `);
    const sc = schemaChecks.recordset[0];
    console.log('  schema checks:', JSON.stringify(sc));
    if (Number(sc.BookingsBranchId) !== 1) failures.push('missing Bookings.BranchID');
    if (Number(sc.QueueTicketsBranchId) !== 1) failures.push('missing QueueTickets.BranchID');
    if (Number(sc.NewDayBranchId) !== 1) failures.push('missing TblNewDay.BranchID');
    if (Number(sc.ShiftMoveBranchId) !== 1) failures.push('missing TblShiftMove.BranchID');
    if (Number(sc.InvoiceHeadBranchId) !== 1) failures.push('missing TblinvServHead.BranchID');
    if (Number(sc.CashMoveBranchId) !== 1) failures.push('missing TblCashMove.BranchID');
    if (Number(sc.TreasuryReconBranchId) !== 1) failures.push('missing TblTreasuryCloseRecon.BranchID');
    if (Number(sc.FkBookings) !== 1) failures.push('missing FK_Bookings_BranchID');
    if (Number(sc.FkQueue) !== 1) failures.push('missing FK_QueueTickets_BranchID');
    if (Number(sc.FkSettings) !== 1) failures.push('missing FK_QueueBookingSettings_BranchID');
    if (Number(sc.ForbiddenHrBranchColumns) !== 0) {
      failures.push('HR/payroll/ledger/target/budget tables must not gain BranchID');
    }

    // 4. GLEEM still exists, with settings + partner shares
    const gleem = await pool.request().query(`
      SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    const gleemId = gleem.recordset[0]?.BranchID as number | undefined;
    if (!gleemId) {
      failures.push('GLEEM branch missing');
    } else {
      const gleemSettings = await pool
        .request()
        .input('bid', sql.Int, gleemId)
        .query(`SELECT TOP 1 SettingID FROM dbo.QueueBookingSettings WHERE BranchID = @bid`);
      if (!gleemSettings.recordset.length) failures.push('GLEEM missing QueueBookingSettings');

      const gleemShares = await pool
        .request()
        .input('bid', sql.Int, gleemId)
        .query(`
          SELECT COUNT(*) AS cnt, SUM(SharePercent) AS total
          FROM dbo.TblBranchPartnerShare
          WHERE BranchID = @bid AND IsActive = 1
            AND EffectiveFrom <= CAST(SYSUTCDATETIME() AS DATE)
            AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(SYSUTCDATETIME() AS DATE))
        `);
      const shareCount = Number(gleemShares.recordset[0]?.cnt ?? 0);
      const shareTotal = Number(gleemShares.recordset[0]?.total ?? 0);
      if (shareCount === 0) failures.push('GLEEM missing active partner shares');
      else if (Math.abs(shareTotal - 100) > 0.01) {
        failures.push(`GLEEM partner shares do not sum to 100% (got ${shareTotal})`);
      }
    }
  } finally {
    await pool.close();
  }

  // 5. Assignment integrity + per-branch readiness — reuse production helpers.
  const { setDbTarget, closePool } = await import('@/lib/db');
  await setDbTarget(mode === 'local' ? 'local' : 'cloud');

  const { auditEmployeeAssignmentIntegrity } = await import('@/lib/branch/assignmentIntegrity');
  const { evaluateBranchOperationalReadiness } = await import('@/lib/branch/readiness');
  const { listActiveBranches } = await import('@/lib/branch/repository');

  const assignmentReport = await auditEmployeeAssignmentIntegrity();
  console.log(
    `  assignment integrity: ${assignmentReport.issueCount} issue(s) ` +
      `(errors=${assignmentReport.errorCount}, warnings=${assignmentReport.warningCount})`,
  );
  for (const issue of assignmentReport.issues) {
    const line = `    [${issue.severity}] ${issue.code}: ${issue.message}`;
    if (issue.severity === 'error') {
      failures.push(`assignment integrity: ${issue.code} — ${issue.message}`);
      console.error(line);
    } else {
      warnings.push(`assignment integrity: ${issue.code}`);
      console.warn(line);
    }
  }

  const activeBranches = await listActiveBranches();
  console.log(`  active branches: ${activeBranches.map((b) => b.branchCode).join(', ') || '(none)'}`);

  const readinessSummaries: Array<{
    branchCode: string;
    ready: boolean;
    blockers: string[];
    warnings: string[];
  }> = [];

  for (const branch of activeBranches) {
    const readiness = await evaluateBranchOperationalReadiness({ branchId: branch.branchId });
    readinessSummaries.push({
      branchCode: branch.branchCode,
      ready: readiness.ready,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
    });
    console.log(
      `  readiness[${branch.branchCode}]: ready=${readiness.ready} ` +
        `blockers=${readiness.blockers.join(',') || '(none)'} ` +
        `warnings=${readiness.warnings.join(',') || '(none)'}`,
    );
    if (branch.branchCode === 'GLEEM' && !readiness.ready) {
      failures.push(`GLEEM not operationally ready: ${readiness.blockers.join(', ')}`);
    } else if (branch.branchCode !== 'GLEEM' && !readiness.ready) {
      warnings.push(`${branch.branchCode} not yet operationally ready: ${readiness.blockers.join(', ')}`);
    }
  }

  await closePool();

  console.log('  readiness summary:', JSON.stringify(readinessSummaries));

  if (warnings.length) {
    console.warn('Warnings:');
    for (const w of warnings) console.warn(`  - ${w}`);
  }

  if (failures.length) {
    console.error('Phase 1G verification FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('Phase 1G verification PASSED');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
