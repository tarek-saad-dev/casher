#!/usr/bin/env npx tsx
/**
 * Phase 1L verifier — employee financial branch ownership.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  let withPhase1k = false;
  let withPhase1j = false;
  let withPhase1i = false;
  let withPhase1h = false;
  let withPhase1g = false;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg === '--with-phase1k') withPhase1k = true;
    else if (arg === '--with-phase1j') withPhase1j = true;
    else if (arg === '--with-phase1i') withPhase1i = true;
    else if (arg === '--with-phase1h') withPhase1h = true;
    else if (arg === '--with-phase1g') withPhase1g = true;
  }
  return {
    expectedDatabase,
    mode,
    withPhase1k,
    withPhase1j,
    withPhase1i,
    withPhase1h,
    withPhase1g,
  };
}

function buildConfig(): sql.config {
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
    },
    requestTimeout: 180000,
  };
}

function checkSource(failures: string[]) {
  console.log('  --- source ---');
  const required = [
    'db/migrations/add-employee-financial-branch-ownership.sql',
    'src/lib/payroll/dailyPayrollGenerateCore.ts',
    'src/lib/services/employeeLedgerDualWrite.ts',
    'src/lib/services/employeeLedgerPayoutService.ts',
    'src/lib/hr/nightly-close.service.ts',
    'docs/branch-phase-1l-closure.md',
  ];
  for (const f of required) {
    if (!exists(f)) failures.push(`missing ${f}`);
    else console.log(`    OK ${f}`);
  }

  const mig = read('db/migrations/add-employee-financial-branch-ownership.sql');
  if (!mig.includes('TblEmpBranchPayrollPlan')) {
    failures.push('migration missing TblEmpBranchPayrollPlan');
  }
  if (!mig.includes('vw_EmpLedgerBranchBalance')) {
    failures.push('migration missing branch balance view');
  }
  if (!mig.includes('vw_EmpLedgerGlobalBalance')) {
    failures.push('migration missing global balance view');
  }
  if (!mig.includes('UX_TblEmpDailyPayroll_Emp_Branch_WorkDate')) {
    failures.push('migration missing payroll Emp+Branch+WorkDate unique');
  }

  const core = read('src/lib/payroll/dailyPayrollGenerateCore.ts');
  if (!core.includes('vw_EmpAttendancePayrollBranchDay')) {
    failures.push('payroll must use branch-day attendance view');
  }
  if (!core.includes('branchId مطلوب')) {
    failures.push('payroll generate must require branchId');
  }

  const payout = read('src/lib/services/employeeLedgerPayoutService.ts');
  if (!payout.includes('getEmployeeBranchBalance')) {
    failures.push('payout must use branch balance, not global');
  }

  const nightly = read('src/lib/hr/nightly-close.service.ts');
  if (!nightly.includes('payrollBranches') && !nightly.includes('for (const branch of')) {
    failures.push('nightly must iterate branches for payroll');
  }
  if (!nightly.includes('generateEmployeeDailyTargets')) {
    failures.push('nightly must generate targets');
  }

  const gen = read('src/app/api/payroll/daily/generate/route.ts');
  if (!gen.includes('BranchID في الطلب غير مسموح')) {
    failures.push('payroll generate must reject body BranchID');
  }

  const registry = read('src/lib/branch/domainOwnershipRegistry.ts');
  if (/domain:\s*'payroll_ledger_targets'[\s\S]{0,400}goLiveBlocker:\s*true/.test(registry)) {
    failures.push('payroll_ledger_targets must not remain goLiveBlocker');
  }
  if (!/domain:\s*'payroll_ledger_targets'[\s\S]{0,200}BRANCH_OWNED_ROOT/.test(registry)) {
    failures.push('payroll_ledger_targets must be BRANCH_OWNED_ROOT');
  }

  const sales = read('src/lib/payroll/employee-target/employee-target-sales-service.ts');
  if (!sales.includes('h.BranchID = @branchId')) {
    failures.push('target sales must filter invoice BranchID');
  }
}

async function checkLive(expectedDatabase: string, failures: string[]) {
  console.log('  --- live ---');
  const pool = await sql.connect(buildConfig());
  try {
    const dbName = (await pool.request().query(`SELECT DB_NAME() AS n`)).recordset[0].n;
    if (dbName !== expectedDatabase) {
      failures.push(`expected ${expectedDatabase}, got ${dbName}`);
      return;
    }
    console.log(`    OK database=${dbName}`);

    const active = await pool.request().query(`
      SELECT BranchCode FROM dbo.TblBranch WHERE IsActive = 1
    `);
    const codes = active.recordset.map((r: { BranchCode: string }) => r.BranchCode);
    if (codes.length !== 1 || codes[0] !== 'GLEEM') {
      failures.push(`expected only GLEEM active, got [${codes.join(',')}]`);
    } else {
      console.log('    OK only GLEEM active');
    }

    const ph1 = await pool.request().query(`
      SELECT BranchID, IsActive FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST'
    `);
    const ph1Row = ph1.recordset[0] as { BranchID: number; IsActive: boolean } | undefined;
    if (ph1Row && ph1Row.IsActive) {
      failures.push('PH1GTEST must remain inactive');
    }

    for (const table of [
      'TblEmpDailyPayroll',
      'TblEmpLedgerEntry',
      'TblEmpDailyTarget',
      'TblEmpTargetRecalcRequest',
      'TblEmpTargetPlan',
    ]) {
      const nulls = (
        await pool.request().query(`
          SELECT COUNT(*) AS c FROM dbo.${table} WHERE BranchID IS NULL
        `)
      ).recordset[0].c;
      if (Number(nulls) > 0) failures.push(`${table} has ${nulls} NULL BranchID`);
      else console.log(`    OK ${table} BranchID NOT NULL`);
    }

    if (ph1Row) {
      for (const table of [
        'TblEmpDailyPayroll',
        'TblEmpLedgerEntry',
        'TblEmpDailyTarget',
        'TblEmpTargetRecalcRequest',
        'TblEmpBranchPayrollPlan',
      ]) {
        const c = (
          await pool
            .request()
            .input('b', sql.Int, ph1Row.BranchID)
            .query(`SELECT COUNT(*) AS c FROM dbo.${table} WHERE BranchID = @b`)
        ).recordset[0].c;
        if (Number(c) > 0) failures.push(`PH1GTEST must have 0 rows in ${table}, got ${c}`);
      }
      console.log('    OK PH1GTEST employee-financial rows = 0');
    }

    const mismatch = (
      await pool.request().query(`
        SELECT COUNT(*) AS c
        FROM dbo.TblEmpLedgerEntry le
        INNER JOIN dbo.TblCashMove cm ON cm.ID = le.CashMoveID
        WHERE le.CashMoveID IS NOT NULL AND le.BranchID <> cm.BranchID
      `)
    ).recordset[0].c;
    if (Number(mismatch) > 0) {
      failures.push(`CashMove/ledger BranchID mismatch count=${mismatch}`);
    } else {
      console.log('    OK CashMove/ledger BranchID match');
    }

    const views = await pool.request().query(`
      SELECT name FROM sys.views
      WHERE name IN (
        N'vw_EmpAttendancePayrollBranchDay',
        N'vw_EmpLedgerBranchBalance',
        N'vw_EmpLedgerGlobalBalance'
      )
    `);
    if (views.recordset.length < 3) {
      failures.push(`missing balance/payroll views (found ${views.recordset.length})`);
    } else {
      console.log('    OK balance/payroll views');
    }

    const idx = await pool.request().query(`
      SELECT name FROM sys.indexes
      WHERE name = N'UX_TblEmpDailyPayroll_Emp_Branch_WorkDate'
    `);
    if (idx.recordset.length === 0) {
      failures.push('missing UX_TblEmpDailyPayroll_Emp_Branch_WorkDate');
    }

    const oldIdx = await pool.request().query(`
      SELECT name FROM sys.indexes
      WHERE name = N'UX_TblEmpDailyPayroll_EmpID_WorkDate'
    `);
    if (oldIdx.recordset.length > 0) {
      failures.push('global Emp+WorkDate payroll unique must be removed');
    }

    const branchSum = Number(
      (
        await pool.request().query(`
          SELECT ISNULL(SUM(Balance),0) AS s FROM dbo.vw_EmpLedgerBranchBalance
        `)
      ).recordset[0].s,
    );
    const globalSum = Number(
      (
        await pool.request().query(`
          SELECT ISNULL(SUM(Balance),0) AS s FROM dbo.vw_EmpLedgerGlobalBalance
        `)
      ).recordset[0].s,
    );
    if (Math.abs(branchSum - globalSum) > 0.02) {
      failures.push(
        `branch balance sum (${branchSum}) != global sum (${globalSum})`,
      );
    } else {
      console.log(`    OK branch/global balance sum=${branchSum}`);
    }
  } finally {
    await pool.close();
  }
}

function runNested(script: string, args: string[], failures: string[]) {
  console.log(`  --- nested ${script} ---`);
  const r = spawnSync('npx', ['tsx', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) {
    failures.push(`nested ${script} failed: ${r.stderr || r.stdout}`);
    console.log(r.stdout);
    console.error(r.stderr);
  } else {
    console.log(`    OK ${script}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures: string[] = [];
  console.log('Phase 1L employee financial branch ownership verifier');
  console.log(`  mode=${args.mode} db=${args.expectedDatabase}`);

  checkSource(failures);
  await checkLive(args.expectedDatabase, failures);

  if (args.withPhase1k) {
    runNested(
      'scripts/verify-attendance-branch-ownership.ts',
      [
        `--mode=${args.mode}`,
        `--expected-database=${args.expectedDatabase}`,
        ...(args.withPhase1j ? ['--with-phase1j'] : []),
        ...(args.withPhase1i ? ['--with-phase1i'] : []),
        ...(args.withPhase1h ? ['--with-phase1h'] : []),
        ...(args.withPhase1g ? ['--with-phase1g'] : []),
      ],
      failures,
    );
  }

  if (failures.length) {
    console.error('\nFAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nPASS Phase 1L employee financial branch ownership');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
