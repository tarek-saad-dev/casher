#!/usr/bin/env npx tsx
/**
 * Phase 1B foundation verification.
 * Fails on mapping/schema integrity issues.
 * Open legacy shifts are reported as warnings, not failures.
 * Never prints secrets.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

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
        encrypt: process.env.LOCAL_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 120000,
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
    requestTimeout: 120000,
  };
}

type CountRow = Record<string, unknown>;

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = buildConfig(mode);
  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: got ${config.database}, expected ${expectedDatabase}`);
    process.exit(1);
  }

  const beforePath = path.join(
    __dirname,
    'audit-branches',
    '_phase1b-legacy-before.json',
  );
  const before = fs.existsSync(beforePath)
    ? JSON.parse(fs.readFileSync(beforePath, 'utf8'))
    : null;

  const pool = await sql.connect(config);
  const failures: string[] = [];
  const warnings: string[] = [];

  try {
    const summary = await pool.request().query(`
      DECLARE @Now DATETIME2(0) = SYSUTCDATETIME();
      DECLARE @GleemID INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

      SELECT
        DB_NAME() AS ConnectedDatabase,
        (SELECT COUNT(*) FROM dbo.TblBranch) AS BranchCount,
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchCode = N'GLEEM') AS GleemCount,
        (SELECT COUNT(*) FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0) AS CurrentUserCount,
        (SELECT COUNT(*) FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 1) AS DeletedUserCount,
        (SELECT COUNT(*)
           FROM dbo.TblUser u
           INNER JOIN dbo.TblUserBranchAccess uba ON uba.UserID = u.UserID
           INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
           WHERE ISNULL(u.isDeleted, 0) = 0
             AND uba.IsActive = 1
             AND uba.ValidFrom <= @Now
             AND (uba.ValidTo IS NULL OR uba.ValidTo > @Now)
             AND b.IsActive = 1
             AND b.BranchCode = N'GLEEM') AS UsersWithValidGleemMapping,
        (SELECT COUNT(*)
           FROM dbo.TblUser u
           WHERE ISNULL(u.isDeleted, 0) = 0
             AND NOT EXISTS (
               SELECT 1
               FROM dbo.TblUserBranchAccess uba
               INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
               WHERE uba.UserID = u.UserID
                 AND uba.IsDefault = 1
                 AND uba.IsActive = 1
                 AND uba.ValidFrom <= @Now
                 AND (uba.ValidTo IS NULL OR uba.ValidTo > @Now)
                 AND b.IsActive = 1
             )) AS UsersMissingValidDefault,
        (SELECT COUNT(*) FROM (
           SELECT uba.UserID
           FROM dbo.TblUserBranchAccess uba
           INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
           INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
           WHERE ISNULL(u.isDeleted, 0) = 0
             AND uba.IsDefault = 1
             AND uba.IsActive = 1
             AND uba.ValidFrom <= @Now
             AND (uba.ValidTo IS NULL OR uba.ValidTo > @Now)
             AND b.IsActive = 1
           GROUP BY uba.UserID
           HAVING COUNT(*) > 1
         ) d) AS UsersWithMultipleValidDefaults,
        (SELECT COUNT(*)
           FROM dbo.TblUser u
           INNER JOIN dbo.TblUserBranchAccess uba ON uba.UserID = u.UserID
           WHERE ISNULL(u.isDeleted, 0) = 1
             AND uba.IsActive = 1
             AND uba.GrantReason = N'Phase 1B founding backfill to GLEEM') AS DeletedUsersWithNewActiveMappings,
        (SELECT COUNT(*) FROM dbo.TblEmp WHERE ISNULL(isActive, 1) = 1) AS ActiveEmployeeCount,
        (SELECT COUNT(*)
           FROM dbo.TblEmp e
           INNER JOIN dbo.TblEmpBranchAssignment ea ON ea.EmpID = e.EmpID
           INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
           WHERE ISNULL(e.isActive, 1) = 1
             AND ea.IsActive = 1
             AND ea.IsHomeBranch = 1
             AND ea.EffectiveFrom <= CAST(@Now AS DATE)
             AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= CAST(@Now AS DATE))
             AND b.BranchCode = N'GLEEM'
             AND b.IsActive = 1) AS EmployeesWithActiveGleemHome,
        (SELECT COUNT(*)
           FROM dbo.TblEmp e
           WHERE ISNULL(e.isActive, 1) = 1
             AND NOT EXISTS (
               SELECT 1
               FROM dbo.TblEmpBranchAssignment ea
               INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
               WHERE ea.EmpID = e.EmpID
                 AND ea.IsHomeBranch = 1
                 AND ea.IsActive = 1
                 AND ea.EffectiveFrom <= CAST(@Now AS DATE)
                 AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= CAST(@Now AS DATE))
                 AND b.IsActive = 1
             )) AS EmployeesMissingHomeBranch,
        (SELECT COUNT(*) FROM (
           SELECT ea.EmpID
           FROM dbo.TblEmpBranchAssignment ea
           INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
           WHERE ISNULL(e.isActive, 1) = 1
             AND ea.IsHomeBranch = 1
             AND ea.IsActive = 1
             AND ea.EffectiveFrom <= CAST(@Now AS DATE)
             AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= CAST(@Now AS DATE))
           GROUP BY ea.EmpID
           HAVING COUNT(*) > 1
         ) m) AS EmployeesWithMultipleActiveHomes,
        (SELECT COUNT(*)
           FROM dbo.TblEmp e
           INNER JOIN dbo.TblEmpBranchAssignment ea ON ea.EmpID = e.EmpID
           WHERE ISNULL(e.isActive, 1) = 0
             AND ea.IsActive = 1
             AND ea.Notes = N'Phase 1B founding home assignment to GLEEM') AS InactiveEmployeesNewlyAssigned,
        (SELECT COUNT(*)
           FROM dbo.TblUserBranchAccess uba
           LEFT JOIN dbo.TblUser u ON u.UserID = uba.UserID
           LEFT JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
           WHERE u.UserID IS NULL OR b.BranchID IS NULL) AS InvalidUserAccessFKs,
        (SELECT COUNT(*)
           FROM dbo.TblEmpBranchAssignment ea
           LEFT JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
           LEFT JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
           WHERE e.EmpID IS NULL OR b.BranchID IS NULL) AS InvalidEmpAssignmentFKs,
        (SELECT COUNT(*)
           FROM dbo.TblUserBranchAccess uba
           WHERE uba.IsActive = 1
             AND uba.ValidTo IS NOT NULL
             AND uba.ValidTo <= @Now) AS ExpiredActiveAccessRows,
        (SELECT COUNT(*)
           FROM dbo.TblUserBranchAccess uba
           INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
           WHERE uba.IsActive = 1
             AND b.IsActive = 0) AS AccessToInactiveBranches,
        (SELECT COUNT(*)
           FROM sys.columns c
           INNER JOIN sys.tables t ON t.object_id = c.object_id
           INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
           WHERE c.name = N'BranchID'
             AND s.name = N'dbo'
             AND t.name NOT IN (N'TblBranch', N'TblUserBranchAccess', N'TblEmpBranchAssignment')) AS OperationalBranchIDColumns,
        (SELECT COUNT(*) FROM dbo.TblShiftMove WHERE ISNULL(Status, 0) = 1) AS OpenShiftCount,
        (SELECT COUNT(*) FROM dbo.TblNewDay WHERE Status = 1) AS OpenNewDayCount,
        @GleemID AS GleemBranchID
    `);

    const row = summary.recordset[0] as CountRow;
    const gleem = await pool.request().query(`
      SELECT BranchID, BranchCode, BranchName, ShortName, TimeZone,
             CONVERT(varchar(8), BusinessDayCutoffTime, 108) AS BusinessDayCutoffTime,
             IsActive
      FROM dbo.TblBranch
      WHERE BranchCode = N'GLEEM'
    `);

    const afterCounts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblinvServHead) AS InvoiceHeadCount,
        (SELECT COUNT(*) FROM dbo.TblCashMove) AS CashMoveCount,
        (SELECT COUNT(*) FROM dbo.TblEmpAttendance) AS AttendanceCount,
        (SELECT COUNT_BIG(*) FROM dbo.Bookings) AS BookingCount,
        (SELECT COUNT_BIG(*) FROM dbo.QueueTickets) AS QueueTicketCount,
        (SELECT COUNT(*) FROM dbo.TblNewDay) AS NewDayCount,
        (SELECT COUNT(*) FROM dbo.TblShiftMove) AS ShiftMoveCount,
        (SELECT CHECKSUM_AGG(CHECKSUM(ID, UserID, ShiftID, Status, StartDate, StartTime))
           FROM dbo.TblShiftMove WHERE ISNULL(Status,0)=1) AS OpenShiftChecksum,
        (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, Status))
           FROM dbo.TblNewDay WHERE Status = 1) AS OpenDayChecksum
    `);
    const after = afterCounts.recordset[0];

    console.log('Phase 1B verification report');
    console.log(`  Connected database: ${row.ConnectedDatabase}`);
    console.log(`  Branch count: ${row.BranchCount}`);
    console.log(`  GLEEM row: ${JSON.stringify(gleem.recordset[0] || null)}`);
    console.log(`  Current-user count: ${row.CurrentUserCount}`);
    console.log(`  Users with valid GLEEM mapping: ${row.UsersWithValidGleemMapping}`);
    console.log(`  Users missing a valid default: ${row.UsersMissingValidDefault}`);
    console.log(`  Users with multiple valid defaults: ${row.UsersWithMultipleValidDefaults}`);
    console.log(`  Deleted users with newly active mappings: ${row.DeletedUsersWithNewActiveMappings}`);
    console.log(`  Active employee count: ${row.ActiveEmployeeCount}`);
    console.log(`  Employees with active GLEEM assignment: ${row.EmployeesWithActiveGleemHome}`);
    console.log(`  Employees missing a home branch: ${row.EmployeesMissingHomeBranch}`);
    console.log(`  Employees with multiple active home branches: ${row.EmployeesWithMultipleActiveHomes}`);
    console.log(`  Inactive employees newly assigned: ${row.InactiveEmployeesNewlyAssigned}`);
    console.log(`  Invalid foreign keys (user access): ${row.InvalidUserAccessFKs}`);
    console.log(`  Invalid foreign keys (emp assignment): ${row.InvalidEmpAssignmentFKs}`);
    console.log(`  Expired access rows (still IsActive): ${row.ExpiredActiveAccessRows}`);
    console.log(`  Access to inactive branches: ${row.AccessToInactiveBranches}`);
    console.log(`  Operational tables containing BranchID: ${row.OperationalBranchIDColumns}`);
    console.log(
      `  Open shifts: ${row.OpenShiftCount} — Legacy warning — unchanged, outside Phase 1B ownership scope`,
    );
    console.log(`  Open TblNewDay count: ${row.OpenNewDayCount}`);

    if (Number(row.GleemCount) !== 1) failures.push('GLEEM must exist exactly once');
    if (Number(row.BranchCount) !== 1) failures.push('Expected exactly one branch (GLEEM) after Phase 1B');
    if (Number(row.UsersMissingValidDefault) !== 0) failures.push('Users missing valid default mapping');
    if (Number(row.UsersWithMultipleValidDefaults) !== 0) failures.push('Users with multiple valid defaults');
    if (Number(row.DeletedUsersWithNewActiveMappings) !== 0) {
      failures.push('Deleted users received newly active mappings');
    }
    if (Number(row.UsersWithValidGleemMapping) !== Number(row.CurrentUserCount)) {
      failures.push('Not every current user has a valid GLEEM mapping');
    }
    if (Number(row.EmployeesMissingHomeBranch) !== 0) failures.push('Active employees missing home branch');
    if (Number(row.EmployeesWithMultipleActiveHomes) !== 0) {
      failures.push('Employees with multiple active home branches');
    }
    if (Number(row.InactiveEmployeesNewlyAssigned) !== 0) {
      failures.push('Inactive employees newly assigned');
    }
    if (Number(row.EmployeesWithActiveGleemHome) !== Number(row.ActiveEmployeeCount)) {
      failures.push('Not every active employee has an active GLEEM home assignment');
    }
    if (Number(row.InvalidUserAccessFKs) !== 0 || Number(row.InvalidEmpAssignmentFKs) !== 0) {
      failures.push('Invalid foreign keys detected');
    }
    if (Number(row.OperationalBranchIDColumns) !== 0) {
      failures.push('Operational/financial tables gained BranchID');
    }

    if (Number(row.OpenShiftCount) > 0) {
      warnings.push(
        'Legacy warning — open shifts unchanged, outside Phase 1B ownership scope',
      );
    }

    if (before?.counts) {
      const keys = [
        'InvoiceHeadCount',
        'CashMoveCount',
        'AttendanceCount',
        'BookingCount',
        'QueueTicketCount',
        'NewDayCount',
        'ShiftMoveCount',
        'OpenShiftChecksum',
        'OpenDayChecksum',
      ] as const;
      for (const key of keys) {
        const left = String(before.counts[key]);
        const right = String(after[key]);
        if (left !== right) {
          failures.push(`Legacy state changed for ${key}: before=${left} after=${right}`);
        }
      }
      console.log('  Legacy day/shift/ops fingerprint: unchanged vs pre-migration capture');
    } else {
      warnings.push('No pre-migration legacy capture found; fingerprint compare skipped');
    }

    for (const w of warnings) console.warn(`  WARNING: ${w}`);

    if (failures.length) {
      console.error('Verification FAILED:');
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }

    console.log('Verification PASSED');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
