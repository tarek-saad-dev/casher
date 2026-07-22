#!/usr/bin/env npx tsx
/**
 * Phase 1C verifier — day/shift branch ownership + legacy fingerprint stability.
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

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = buildConfig(mode);
  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  const beforePath = path.join(__dirname, 'audit-branches', '_phase1c-legacy-before.json');
  const afterPath = path.join(__dirname, 'audit-branches', '_phase1c-legacy-after.json');
  const before = fs.existsSync(beforePath)
    ? JSON.parse(fs.readFileSync(beforePath, 'utf8'))
    : null;
  const after = fs.existsSync(afterPath)
    ? JSON.parse(fs.readFileSync(afterPath, 'utf8'))
    : null;

  const pool = await sql.connect(config);
  const failures: string[] = [];
  try {
    const gleem = await pool.request().query(`
      SELECT BranchID, BranchCode FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    const gleemId = gleem.recordset[0]?.BranchID;
    if (!gleemId) failures.push('GLEEM missing');

    const summary = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblNewDay) AS NewDayTotal,
        (SELECT COUNT(*) FROM dbo.TblNewDay WHERE BranchID IS NULL) AS NewDayNullBranch,
        (SELECT COUNT(*) FROM dbo.TblNewDay WHERE BranchID <> ${Number(gleemId) || -1}) AS NewDayNotGleem,
        (SELECT COUNT(*) FROM (
           SELECT BranchID, NewDay FROM dbo.TblNewDay GROUP BY BranchID, NewDay HAVING COUNT(*) > 1
         ) d) AS DuplicateBranchDay,
        (SELECT COUNT(*) FROM (
           SELECT BranchID FROM dbo.TblNewDay WHERE Status = 1 GROUP BY BranchID HAVING COUNT(*) > 1
         ) o) AS MultipleOpenPerBranch,
        (SELECT COUNT(*) FROM dbo.TblShiftMove) AS ShiftTotal,
        (SELECT COUNT(*) FROM dbo.TblShiftMove WHERE BranchID IS NULL) AS ShiftNullBranch,
        (SELECT COUNT(*) FROM dbo.TblShiftMove WHERE BusinessDayID IS NULL) AS ShiftNullBusinessDay,
        (SELECT COUNT(*) FROM dbo.TblShiftMove sm
           INNER JOIN dbo.TblNewDay d ON d.ID = sm.BusinessDayID
           WHERE sm.BranchID <> d.BranchID) AS ShiftDayBranchMismatch,
        (SELECT COUNT(*) FROM dbo.TblShiftMove sm
           INNER JOIN dbo.TblNewDay d ON d.ID = sm.BusinessDayID
           WHERE sm.NewDay <> d.NewDay) AS ShiftDayDateMismatch,
        (SELECT COUNT(*) FROM (
           SELECT UserID FROM dbo.TblShiftMove WHERE Status = 1 AND UserID IS NOT NULL
           GROUP BY UserID HAVING COUNT(*) > 1
         ) u) AS UsersMultipleOpenShifts,
        (SELECT COUNT(*) FROM sys.columns c
           INNER JOIN sys.tables t ON t.object_id = c.object_id
           INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
           WHERE c.name = N'BranchID' AND s.name = N'dbo'
             AND t.name NOT IN (
               N'TblBranch', N'TblUserBranchAccess', N'TblEmpBranchAssignment',
               N'TblNewDay', N'TblShiftMove'
             )) AS UnexpectedBranchIDColumns,
        (SELECT COUNT(*) FROM dbo.TblShiftMove WHERE BranchID <> ${Number(gleemId) || -1}) AS ShiftNotGleem
    `);

    const row = summary.recordset[0];
    console.log('Phase 1C verification');
    console.log(`  GLEEM BranchID: ${gleemId}`);
    console.log(`  TblNewDay total: ${row.NewDayTotal}`);
    console.log(`  TblNewDay BranchID null: ${row.NewDayNullBranch}`);
    console.log(`  TblNewDay not GLEEM: ${row.NewDayNotGleem}`);
    console.log(`  Duplicate (BranchID, NewDay): ${row.DuplicateBranchDay}`);
    console.log(`  Multiple open days/branch: ${row.MultipleOpenPerBranch}`);
    console.log(`  TblShiftMove total: ${row.ShiftTotal}`);
    console.log(`  Shift BranchID null: ${row.ShiftNullBranch}`);
    console.log(`  Shift BusinessDayID null: ${row.ShiftNullBusinessDay}`);
    console.log(`  Shift/day branch mismatches: ${row.ShiftDayBranchMismatch}`);
    console.log(`  Shift/day date mismatches: ${row.ShiftDayDateMismatch}`);
    console.log(`  Users with multiple open shifts: ${row.UsersMultipleOpenShifts}`);
    console.log(`  Unexpected operational BranchID columns: ${row.UnexpectedBranchIDColumns}`);
    console.log(`  Shifts not GLEEM: ${row.ShiftNotGleem}`);

    const pk = await pool.request().query(`
      SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS pk_cols
      FROM sys.key_constraints kc
      JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE kc.parent_object_id = OBJECT_ID(N'dbo.TblNewDay') AND kc.type = N'PK'
    `);
    console.log(`  TblNewDay PK columns: ${pk.recordset[0]?.pk_cols}`);
    if (pk.recordset[0]?.pk_cols !== 'ID') failures.push('TblNewDay PK must be ID');

    if (Number(row.NewDayNullBranch) !== 0) failures.push('NewDay null BranchID');
    if (Number(row.NewDayNotGleem) !== 0) failures.push('NewDay not assigned to GLEEM');
    if (Number(row.DuplicateBranchDay) !== 0) failures.push('Duplicate (BranchID, NewDay)');
    if (Number(row.MultipleOpenPerBranch) !== 0) failures.push('Multiple open days in one branch');
    if (Number(row.ShiftNullBranch) !== 0) failures.push('Shift null BranchID');
    if (Number(row.ShiftNullBusinessDay) !== 0) failures.push('Shift null BusinessDayID');
    if (Number(row.ShiftDayBranchMismatch) !== 0) failures.push('Shift/day branch mismatch');
    if (Number(row.ShiftDayDateMismatch) !== 0) failures.push('Shift/day date mismatch');
    if (Number(row.UsersMultipleOpenShifts) !== 0) failures.push('Users with multiple open shifts');
    if (Number(row.UnexpectedBranchIDColumns) !== 0) {
      failures.push('Unexpected tables gained BranchID');
    }
    if (Number(row.ShiftNotGleem) !== 0) failures.push('Shifts not assigned to GLEEM');

    if (before?.counts && after?.counts) {
      const keys = [
        'NewDayCount',
        'ShiftMoveCount',
        'InvoiceHeadCount',
        'CashMoveCount',
        'ServPaymentCount',
        'TreasuryReconCount',
        'InvoiceChecksum',
        'CashMoveChecksum',
        'ServPaymentChecksum',
        'OpenShiftChecksum',
        'OpenDayChecksum',
      ] as const;
      for (const key of keys) {
        if (String(before.counts[key]) !== String(after.counts[key])) {
          failures.push(`Fingerprint changed for ${key}: ${before.counts[key]} → ${after.counts[key]}`);
        }
      }
      // Open shift non-branch fields must match exactly
      if (
        JSON.stringify(before.openShiftDetail) !== JSON.stringify(after.openShiftDetail)
      ) {
        failures.push('Open shift detail fields changed (status/times/dates)');
      }
      if (JSON.stringify(before.openDayDetail) !== JSON.stringify(after.openDayDetail)) {
        failures.push('Open day detail fields changed');
      }
      console.log('  Legacy fingerprints: unchanged vs pre-migration capture');
    } else {
      failures.push('Missing before/after fingerprint captures');
    }

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
