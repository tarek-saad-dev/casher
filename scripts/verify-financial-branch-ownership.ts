#!/usr/bin/env npx tsx
/**
 * Phase 1D verifier — financial BranchID ownership + fingerprint stability.
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
    requestTimeout: 180000,
  };
}

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = mode === 'local'
    ? {
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
      }
    : buildConfig(mode);

  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  const beforePath = path.join(__dirname, 'audit-branches', '_phase1d-legacy-before.json');
  const afterPath = path.join(__dirname, 'audit-branches', '_phase1d-legacy-after.json');
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
        (SELECT COUNT(*) FROM dbo.TblinvServHead) AS InvoiceCount,
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE BranchID IS NULL) AS InvoiceNullBranch,
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE BranchID <> @g) AS InvoiceNotGleem,
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE BusinessDayID IS NULL) AS InvoiceNullBusinessDay,
        (SELECT COUNT(*) FROM dbo.TblinvServHead h
           INNER JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
           WHERE h.BranchID <> sm.BranchID) AS InvoiceShiftBranchMismatch,
        (SELECT COUNT(*) FROM dbo.TblinvServHead h
           INNER JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
           WHERE h.BusinessDayID IS NOT NULL AND sm.BusinessDayID IS NOT NULL
             AND h.BusinessDayID <> sm.BusinessDayID) AS InvoiceShiftDayMismatch,
        (SELECT COUNT(*) FROM dbo.TblCashMove) AS CashCount,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID IS NULL) AS CashNullBranch,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID <> @g) AS CashNotGleem,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BusinessDayID IS NULL) AS CashNullBusinessDay,
        (SELECT COUNT(*) FROM dbo.TblCashMove cm
           INNER JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
           WHERE cm.BranchID <> sm.BranchID) AS CashShiftBranchMismatch,
        (SELECT COUNT(*) FROM dbo.TblCashMove cm
           INNER JOIN dbo.TblinvServHead h ON h.invID = cm.invID AND h.invType = cm.invType
           WHERE cm.invType = N'مبيعات' AND cm.BranchID <> h.BranchID) AS SaleCashInvoiceBranchMismatch,
        (SELECT COUNT(*) FROM dbo.TblCashMove cm
           INNER JOIN dbo.TblinvServHead h ON h.invID = cm.invID AND h.invType = cm.invType
           WHERE cm.invType = N'مبيعات'
             AND cm.BusinessDayID IS NOT NULL AND h.BusinessDayID IS NOT NULL
             AND cm.BusinessDayID <> h.BusinessDayID) AS SaleCashInvoiceDayMismatch,
        (SELECT COUNT(*) FROM dbo.TblTreasuryCloseRecon) AS ReconCount,
        (SELECT COUNT(*) FROM dbo.TblTreasuryCloseRecon WHERE BranchID IS NULL) AS ReconNullBranch,
        (SELECT COUNT(*) FROM dbo.TblTreasuryCloseRecon r
           INNER JOIN dbo.TblNewDay d ON d.ID = r.NewDay
           WHERE r.BranchID <> d.BranchID) AS ReconDayBranchMismatch,
        (SELECT COUNT(*) FROM dbo.TblinvServPayment p
           INNER JOIN dbo.TblinvServHead h ON h.invID = p.invID AND h.invType = p.invType
           INNER JOIN dbo.TblShiftMove sm ON sm.ID = p.ShiftMoveID
           WHERE h.BranchID <> sm.BranchID) AS PaymentInvoiceShiftBranchMismatch,
        (SELECT COUNT(*) FROM sys.columns c
           INNER JOIN sys.tables t ON t.object_id = c.object_id
           INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
           WHERE c.name = N'BranchID' AND s.name = N'dbo'
             AND t.name NOT IN (
               N'TblBranch', N'TblUserBranchAccess', N'TblEmpBranchAssignment',
               N'TblNewDay', N'TblShiftMove',
               N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon'
             )) AS UnexpectedBranchIDColumns,
        (SELECT COUNT(*) FROM sys.change_tracking_tables
           WHERE OBJECT_NAME(object_id) = N'TblinvServHead') AS CtHead,
        (SELECT COUNT(*) FROM sys.change_tracking_tables
           WHERE OBJECT_NAME(object_id) = N'TblCashMove') AS CtCash,
        (SELECT COUNT(*) FROM sys.triggers
           WHERE name = N'InsCashMoveSales' AND is_disabled = 0) AS TriggerEnabled,
        (SELECT COUNT(*) FROM sync.TableRegistry
           WHERE TableName IN (N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon')
             AND IsEnabled = 1) AS SyncEnabledCount
    `);

    const row = summary.recordset[0];
    console.log('Phase 1D verification');
    console.log(`  GLEEM BranchID: ${gleemId}`);
    console.log(`  Invoice count: ${row.InvoiceCount}`);
    console.log(`  Invoices null BranchID: ${row.InvoiceNullBranch}`);
    console.log(`  Invoices not GLEEM: ${row.InvoiceNotGleem}`);
    console.log(`  Invoices null BusinessDayID: ${row.InvoiceNullBusinessDay}`);
    console.log(`  Invoice/shift branch mismatches: ${row.InvoiceShiftBranchMismatch}`);
    console.log(`  Invoice/shift day mismatches: ${row.InvoiceShiftDayMismatch}`);
    console.log(`  Cash count: ${row.CashCount}`);
    console.log(`  Cash null BranchID: ${row.CashNullBranch}`);
    console.log(`  Cash not GLEEM: ${row.CashNotGleem}`);
    console.log(`  Cash null BusinessDayID (legacy unresolved OK): ${row.CashNullBusinessDay}`);
    console.log(`  Cash/shift branch mismatches: ${row.CashShiftBranchMismatch}`);
    console.log(`  Sale cash/invoice branch mismatches: ${row.SaleCashInvoiceBranchMismatch}`);
    console.log(`  Sale cash/invoice day mismatches: ${row.SaleCashInvoiceDayMismatch}`);
    console.log(`  Recon count: ${row.ReconCount}`);
    console.log(`  Recon null BranchID: ${row.ReconNullBranch}`);
    console.log(`  Recon/day branch mismatches: ${row.ReconDayBranchMismatch}`);
    console.log(`  Payment/invoice/shift branch mismatches: ${row.PaymentInvoiceShiftBranchMismatch}`);
    console.log(`  Unexpected BranchID columns: ${row.UnexpectedBranchIDColumns}`);
    console.log(`  CT Head enabled: ${row.CtHead}`);
    console.log(`  CT Cash enabled: ${row.CtCash}`);
    console.log(`  InsCashMoveSales enabled: ${row.TriggerEnabled}`);
    console.log(`  Sync registry enabled count (informational): ${row.SyncEnabledCount}`);

    if (row.InvoiceNullBranch > 0) failures.push('invoice null BranchID');
    if (row.InvoiceNotGleem > 0) failures.push('invoice not GLEEM');
    if (row.InvoiceNullBusinessDay > 0) failures.push('invoice null BusinessDayID');
    if (row.InvoiceShiftBranchMismatch > 0) failures.push('invoice/shift branch mismatch');
    if (row.InvoiceShiftDayMismatch > 0) failures.push('invoice/shift day mismatch');
    if (row.CashNullBranch > 0) failures.push('cash null BranchID');
    if (row.CashNotGleem > 0) failures.push('cash not GLEEM');
    if (row.CashShiftBranchMismatch > 0) failures.push('cash/shift branch mismatch');
    if (row.SaleCashInvoiceBranchMismatch > 0) failures.push('sale cash/invoice branch mismatch');
    if (row.SaleCashInvoiceDayMismatch > 0) failures.push('sale cash/invoice day mismatch');
    if (row.ReconNullBranch > 0) failures.push('recon null BranchID');
    if (row.ReconDayBranchMismatch > 0) failures.push('recon/day branch mismatch');
    if (row.PaymentInvoiceShiftBranchMismatch > 0) {
      failures.push('payment/invoice/shift branch mismatch');
    }
    if (row.UnexpectedBranchIDColumns > 0) failures.push('unexpected BranchID columns');
    if (row.CtHead < 1) failures.push('CT disabled on TblinvServHead');
    if (row.CtCash < 1) failures.push('CT disabled on TblCashMove');
    if (row.TriggerEnabled < 1) failures.push('InsCashMoveSales missing/disabled');

    // Expected unresolved cash BusinessDayID ≈ 18 on last132 (2024-01-01 income without day)
    if (expectedDatabase === 'last132' && Number(row.CashNullBusinessDay) > 20) {
      failures.push(
        `too many unresolved cash BusinessDayID rows: ${row.CashNullBusinessDay}`,
      );
    }
    console.log(
      `  Unresolved cash BusinessDayID (legacy documented): ${row.CashNullBusinessDay}`,
    );

    if (before?.counts && after?.counts) {
      const keys = [
        'InvoiceHeadCount',
        'InvoiceDetailCount',
        'ServPaymentCount',
        'CashMoveCount',
        'TreasuryReconCount',
        'LedgerCount',
        'TargetRecalcCount',
        'ClientLoyaltyCount',
        'LoyaltyLedgerCount',
        'InvoiceGrandTotalSum',
        'PaymentValueSum',
        'CashInSum',
        'CashOutSum',
        'InvoiceChecksum',
        'DetailChecksum',
        'PaymentChecksum',
        'CashChecksum',
      ] as const;
      for (const k of keys) {
        const b = before.counts[k];
        const a = after.counts[k];
        if (String(b) !== String(a)) {
          failures.push(`fingerprint changed: ${k} before=${b} after=${a}`);
        }
      }
      console.log('  Pre/post financial fingerprints: MATCH');
    } else {
      console.log('  Pre/post fingerprints: skipped (missing capture files)');
    }
  } finally {
    await pool.close();
  }

  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 1D verification PASSED');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
