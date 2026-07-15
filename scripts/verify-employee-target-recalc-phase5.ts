#!/usr/bin/env npx tsx
/**
 * Phase 5 verification: enqueue + process for a work date, assert counts.
 * Does not create invoices. Uses existing enabled plans / daily targets.
 *
 *   npx tsx scripts/verify-employee-target-recalc-phase5.ts --date=2026-07-14
 */
// @ts-nocheck
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad(request, parent, isMain);
};

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function counts(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmpTargetRecalcRequest) AS recalcRequests,
      (SELECT COUNT(*) FROM dbo.TblEmpTargetRecalcRequest WHERE Status=N'pending') AS pending,
      (SELECT COUNT(*) FROM dbo.TblEmpTargetRecalcRequest WHERE Status=N'failed') AS failed,
      (SELECT COUNT(*) FROM dbo.TblEmpTargetRecalcRequest WHERE Status=N'completed') AS completed,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget) AS dailyTarget,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE RefType=N'TblEmpDailyTarget' AND EntryReason=N'target') AS targetLedger,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE EntryReason IN (N'hourly_wage', N'monthly_salary') AND IsVoided=0) AS salaryLedger,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll) AS dailyPayroll,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS cashMove
  `);
  return r.recordset[0];
}

async function main() {
  const workDate = arg('date') || '2026-07-14';
  const cfg = {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  };

  const pool = await sql.connect(cfg);
  const before = await counts(pool);
  console.log('BEFORE', before);

  const emps = await pool.request().input('d', sql.Date, workDate).query(`
    SELECT EmpID FROM dbo.TblEmpDailyTarget WHERE WorkDate = @d
  `);
  const empIds = emps.recordset.map((r) => Number(r.EmpID));
  console.log('empIds', empIds);
  await pool.close();

  if (empIds.length === 0) {
    console.log('VERIFICATION_BLOCKED: no TblEmpDailyTarget rows for date');
    process.exit(0);
  }

  const { enqueueAndMaybeProcessTargetRecalc } = await import(
    '../src/lib/payroll/employee-target/employee-target-recalc-process.service'
  );
  const { reconcileEmployeeDailyTargetLedger } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-ledger-query.service'
  );

  // Bump versions twice then process
  await enqueueAndMaybeProcessTargetRecalc({
    workDate,
    empIds,
    processNow: false,
    reason: 'phase5_verify_1',
    actorUserId: null,
  });
  await enqueueAndMaybeProcessTargetRecalc({
    workDate,
    empIds,
    processNow: false,
    reason: 'phase5_verify_2',
    actorUserId: null,
  });
  const processed = await enqueueAndMaybeProcessTargetRecalc({
    workDate,
    empIds,
    processNow: true,
    reason: 'phase5_verify_process',
    actorUserId: null,
  });
  console.log('process', processed.process);

  const recon = await reconcileEmployeeDailyTargetLedger(
    { workDate, dryRun: true },
    null,
  );
  console.log('reconcile', recon.totals);

  const pool2 = await sql.connect(cfg);
  const after = await counts(pool2);
  console.log('AFTER', after);
  console.log('delta', {
    cashMove: after.cashMove - before.cashMove,
    dailyPayroll: after.dailyPayroll - before.dailyPayroll,
    salaryLedger: after.salaryLedger - before.salaryLedger,
    targetLedger: after.targetLedger - before.targetLedger,
    pending: after.pending,
    failed: after.failed,
  });

  const vers = await pool2.request().input('d', sql.Date, workDate).query(`
    SELECT EmpID, RequestedVersion, ProcessedVersion, Status
    FROM dbo.TblEmpTargetRecalcRequest WHERE WorkDate = @d ORDER BY EmpID
  `);
  console.table(vers.recordset);
  await pool2.close();

  const ok =
    after.cashMove === before.cashMove &&
    after.dailyPayroll === before.dailyPayroll &&
    after.salaryLedger === before.salaryLedger &&
    recon.totals.missing === 0 &&
    recon.totals.mismatched === 0 &&
    recon.totals.duplicates === 0 &&
    recon.totals.orphans === 0 &&
    after.failed === 0;

  console.log(ok ? 'PHASE5_VERIFY_PASS' : 'PHASE5_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
