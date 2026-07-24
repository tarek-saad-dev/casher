#!/usr/bin/env npx tsx
/**
 * Phase 1F verifier — booking/queue BranchID ownership + fingerprint stability.
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

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = buildConfig(mode);

  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  const beforePath = path.join(__dirname, 'audit-branches', '_phase1f-booking-queue-before.json');
  const afterPath = path.join(__dirname, 'audit-branches', '_phase1f-booking-queue-after.json');
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
    const gleemId = gleem.recordset[0]?.BranchID as number | undefined;
    if (!gleemId) failures.push('GLEEM missing');

    const summary = await pool.request().query(`
      DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
      SELECT
        (SELECT COUNT(*) FROM dbo.Bookings) AS BookingsTotal,
        (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID IS NULL) AS BookingsNullBranch,
        (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID <> @g) AS BookingsNotGleem,
        (SELECT COUNT(*) FROM (
           SELECT BookingCode FROM dbo.Bookings WHERE BookingCode IS NOT NULL
           GROUP BY BookingCode HAVING COUNT(*) > 1
         ) d) AS BookingCodeDuplicates,
        (SELECT COUNT(*) FROM dbo.BookingServices bs
           LEFT JOIN dbo.Bookings b ON b.BookingID = bs.BookingID
           WHERE b.BookingID IS NULL) AS BookingChildOrphans,
        (SELECT COUNT(*) FROM dbo.QueueTickets) AS QueueTotal,
        (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID IS NULL) AS QueueNullBranch,
        (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID <> @g) AS QueueNotGleem,
        (SELECT COUNT(*) FROM (
           SELECT BranchID, QueueDate, TicketCode FROM dbo.QueueTickets
           GROUP BY BranchID, QueueDate, TicketCode HAVING COUNT(*) > 1
         ) d) AS DupBranchDateCode,
        (SELECT COUNT(*) FROM dbo.QueueTicketHistory h
           LEFT JOIN dbo.QueueTickets q ON q.QueueTicketID = h.QueueTicketID
           WHERE q.QueueTicketID IS NULL) AS QueueHistoryOrphans,
        (SELECT COUNT(*) FROM dbo.QueueBookingSettings) AS SettingsRows,
        (SELECT COUNT(*) FROM dbo.QueueBookingSettings WHERE BranchID IS NULL) AS SettingsNullBranch,
        (SELECT COUNT(*) FROM (
           SELECT BranchID FROM dbo.QueueBookingSettings
           GROUP BY BranchID HAVING COUNT(*) > 1
         ) d) AS SettingsDupPerBranch,
        (SELECT COUNT(*) FROM dbo.TblBranch b
           WHERE b.IsActive = 1
             AND NOT EXISTS (
               SELECT 1 FROM dbo.QueueBookingSettings s WHERE s.BranchID = b.BranchID
             )) AS ActiveBranchesMissingSettings,
        (SELECT COUNT(*) FROM dbo.Bookings b
           INNER JOIN dbo.TblinvServHead h
             ON h.invID = b.ConvertedInvID
            AND h.invType = ISNULL(b.ConvertedInvType, N'خدمة')
           WHERE b.ConvertedInvID IS NOT NULL AND b.BranchID <> h.BranchID) AS BookingSaleBranchMismatch,
        (SELECT COUNT(*) FROM sys.indexes
           WHERE name = N'UQ_QueueTickets_Branch_Date_Code'
             AND object_id = OBJECT_ID(N'dbo.QueueTickets')) AS HasNewQueueUnique,
        (SELECT COUNT(*) FROM sys.indexes
           WHERE name = N'UQ_QueueTickets_Code_Date'
             AND object_id = OBJECT_ID(N'dbo.QueueTickets')) AS HasOldQueueUnique,
        (SELECT COUNT(*) FROM sys.indexes
           WHERE name = N'UX_Bookings_BookingCode'
             AND object_id = OBJECT_ID(N'dbo.Bookings')) AS HasGlobalBookingCodeUx,
        (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'FK_Bookings_BranchID') AS FkBookings,
        (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'FK_QueueTickets_BranchID') AS FkQueue,
        (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'FK_QueueBookingSettings_BranchID') AS FkSettings,
        (SELECT COUNT(*) FROM sys.columns c
           INNER JOIN sys.tables t ON t.object_id = c.object_id
           INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
           WHERE c.name = N'BranchID' AND s.name = N'dbo'
             AND t.name IN (
               N'TblEmpPayroll', N'TblEmpTarget',
               N'TblEmpLedgerEntry', N'TblBudget'
             )) AS ForbiddenHrBranchColumns
    `);

    const row = summary.recordset[0];
    console.log('Phase 1F verification');
    console.log(`  GLEEM BranchID: ${gleemId}`);
    console.log(`  Bookings total: ${row.BookingsTotal}`);
    console.log(`  Bookings null BranchID: ${row.BookingsNullBranch}`);
    console.log(`  Bookings not GLEEM: ${row.BookingsNotGleem}`);
    console.log(`  Booking code duplicates: ${row.BookingCodeDuplicates}`);
    console.log(`  Booking child orphans: ${row.BookingChildOrphans}`);
    console.log(`  Queue total: ${row.QueueTotal}`);
    console.log(`  Queue null BranchID: ${row.QueueNullBranch}`);
    console.log(`  Queue not GLEEM: ${row.QueueNotGleem}`);
    console.log(`  Dup (BranchID, QueueDate, TicketCode): ${row.DupBranchDateCode}`);
    console.log(`  Queue history orphans: ${row.QueueHistoryOrphans}`);
    console.log(`  Settings rows: ${row.SettingsRows}`);
    console.log(`  Settings null BranchID: ${row.SettingsNullBranch}`);
    console.log(`  Settings dup per branch: ${row.SettingsDupPerBranch}`);
    console.log(`  Active branches missing settings: ${row.ActiveBranchesMissingSettings}`);
    console.log(`  Booking/sale branch mismatches: ${row.BookingSaleBranchMismatch}`);
    console.log(`  New queue unique present: ${row.HasNewQueueUnique}`);
    console.log(`  Old queue unique present: ${row.HasOldQueueUnique}`);
    console.log(`  Global booking code UX present: ${row.HasGlobalBookingCodeUx}`);
    console.log(`  FKs bookings/queue/settings: ${row.FkBookings}/${row.FkQueue}/${row.FkSettings}`);
    console.log(`  Forbidden HR BranchID columns: ${row.ForbiddenHrBranchColumns}`);

    const mustZero = [
      'BookingsNullBranch',
      'BookingsNotGleem',
      'BookingCodeDuplicates',
      'BookingChildOrphans',
      'QueueNullBranch',
      'QueueNotGleem',
      'DupBranchDateCode',
      'QueueHistoryOrphans',
      'SettingsNullBranch',
      'SettingsDupPerBranch',
      'BookingSaleBranchMismatch',
      'HasOldQueueUnique',
      'ForbiddenHrBranchColumns',
    ] as const;
    for (const k of mustZero) {
      if (Number(row[k]) !== 0) failures.push(`${k}=${row[k]}`);
    }
    if (Number(row.HasNewQueueUnique) !== 1) failures.push('missing UQ_QueueTickets_Branch_Date_Code');
    if (Number(row.HasGlobalBookingCodeUx) !== 1) failures.push('missing UX_Bookings_BookingCode');
    if (Number(row.FkBookings) !== 1) failures.push('missing FK_Bookings_BranchID');
    if (Number(row.FkQueue) !== 1) failures.push('missing FK_QueueTickets_BranchID');
    if (Number(row.FkSettings) !== 1) failures.push('missing FK_QueueBookingSettings_BranchID');
    if (Number(row.SettingsRows) < 1) failures.push('no QueueBookingSettings rows');

    // Fingerprint stability (business values unchanged)
    if (before?.counts && after?.counts) {
      const keys = [
        'BookingsCount',
        'BookingServicesCount',
        'QueueTicketsCount',
        'QueueHistoryCount',
        'BookingsChecksum',
        'BookingServicesChecksum',
        'QueueTicketsChecksum',
        'QueueHistoryChecksum',
        'EstimateWaitSum',
        'EstimateWaitCount',
        'DupBookingCodes',
        'CrossMidnightBookings',
      ] as const;
      for (const k of keys) {
        const b = before.counts[k];
        const a = after.counts[k];
        if (String(b) !== String(a)) {
          failures.push(`fingerprint drift ${k}: before=${b} after=${a}`);
        }
      }
    } else {
      console.log('  WARNING: before/after capture files missing — skipped fingerprint compare');
    }

    // Static contract checks (source)
    const repoRoot = path.join(__dirname, '..');
    const publicBranches = path.join(repoRoot, 'src/app/api/public/branches/route.ts');
    if (!fs.existsSync(publicBranches)) failures.push('missing GET /api/public/branches');

    const helpers = fs.readFileSync(
      path.join(repoRoot, 'src/lib/publicBookingHelpers.ts'),
      'utf8',
    );
    if (!helpers.includes('__pos_public_settings_cache_by_branch_v1')) {
      failures.push('settings cache not branch-keyed');
    }

    const ticketCode = fs.readFileSync(path.join(repoRoot, 'src/lib/queueTicketCode.ts'), 'utf8');
    if (!ticketCode.includes('BranchID = @branchId')) {
      failures.push('queueTicketCode missing branch scope');
    }

    const flowBoard = fs.readFileSync(
      path.join(repoRoot, 'src/app/api/operations/flow-board/route.ts'),
      'utf8',
    );
    if (!flowBoard.includes('AND b.BranchID = @branchId') || !flowBoard.includes('activeBranch')) {
      failures.push('flow-board missing branch filter/metadata');
    }
  } finally {
    await pool.close();
  }

  if (failures.length) {
    console.error('FAIL:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 1F verification OK');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
