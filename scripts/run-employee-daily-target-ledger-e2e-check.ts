#!/usr/bin/env npx tsx
/**
 * Optional E2E check: generate for a date then SELECT-verify ledger linkage.
 * Uses existing enabled plans only — does not create plans.
 *
 *   npx tsx scripts/run-employee-daily-target-ledger-e2e-check.ts --date=2026-07-14
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
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget) AS dailyTarget,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry) AS ledger,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE RefType=N'TblEmpDailyTarget' AND EntryReason=N'target') AS targetLedger,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS cashMove,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll) AS dailyPayroll
  `);
  return r.recordset[0];
}

async function main() {
  const workDate = arg('date') || '2026-07-14';
  const pool = await sql.connect({
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
  });

  const before = await counts(pool);
  console.log('BEFORE', before);
  await pool.close();

  const { generateEmployeeDailyTargets } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-generation.service'
  );
  const { reconcileEmployeeDailyTargetLedger } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-ledger-query.service'
  );

  const g1 = await generateEmployeeDailyTargets({ workDate, generatedByUserId: null });
  console.log('generate_1', g1.totals);
  const g2 = await generateEmployeeDailyTargets({ workDate, generatedByUserId: null });
  console.log('generate_2', g2.totals);

  const recon = await reconcileEmployeeDailyTargetLedger(
    { workDate, dryRun: true },
    null,
  );
  console.log('reconcile_dry_run', recon.totals);

  const pool2 = await sql.connect({
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
  });
  const after = await counts(pool2);
  console.log('AFTER', after);
  console.log('delta', {
    dailyTarget: after.dailyTarget - before.dailyTarget,
    ledger: after.ledger - before.ledger,
    targetLedger: after.targetLedger - before.targetLedger,
    cashMove: after.cashMove - before.cashMove,
    dailyPayroll: after.dailyPayroll - before.dailyPayroll,
  });

  const earned = g1.employees.filter((e) => Number(e.targetAmount) > 0);
  console.log(
    'earned_sample',
    earned.slice(0, 5).map((e) => ({
      empId: e.empId,
      dailyTargetId: e.dailyTargetId,
      targetAmount: e.targetAmount,
      ledgerSyncAction: e.ledgerSyncAction,
      ledgerEntryId: e.ledgerEntryId,
    })),
  );

  if (earned.length === 0) {
    console.log('VERIFICATION_BLOCKED: no TargetAmount > 0 for this date — cannot claim financial E2E PASS');
  }

  await pool2.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
