#!/usr/bin/env npx tsx
/**
 * Phase 1K verifier — branch-owned attendance + payroll compatibility.
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
  let withPhase1j = false;
  let withPhase1i = false;
  let withPhase1h = false;
  let withPhase1g = false;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg === '--with-phase1j') withPhase1j = true;
    else if (arg === '--with-phase1i') withPhase1i = true;
    else if (arg === '--with-phase1h') withPhase1h = true;
    else if (arg === '--with-phase1g') withPhase1g = true;
  }
  return { expectedDatabase, mode, withPhase1j, withPhase1i, withPhase1h, withPhase1g };
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
      enableArithAbort: true,
    },
    requestTimeout: 180000,
  };
}

function checkSource(failures: string[]) {
  console.log('  --- source ---');
  const required = [
    'db/migrations/add-attendance-branch-ownership.sql',
    'src/lib/hr/attendance/branchAttendance.service.ts',
    'src/lib/payroll/attendancePayrollAggregate.ts',
    'src/lib/hr/finalize-incomplete-attendance.ts',
    'src/lib/hr/nightly-close.service.ts',
    'docs/branch-phase-1k-closure.md',
  ];
  for (const f of required) {
    if (!exists(f)) failures.push(`missing ${f}`);
    else console.log(`    OK ${f}`);
  }

  const mig = read('db/migrations/add-attendance-branch-ownership.sql');
  if (!mig.includes("BranchCode = N'GLEEM'")) {
    failures.push('migration must resolve GLEEM by BranchCode');
  }
  if (!mig.includes('UQ_TblEmpAttendance_Branch_Emp_WorkDate')) {
    failures.push('migration missing branch unique');
  }
  if (!mig.includes('vw_EmpAttendancePayrollDay')) {
    failures.push('migration missing payroll aggregate view');
  }
  if (/TblEmpDailyPayroll[\s\S]{0,80}BranchID/i.test(mig)) {
    failures.push('migration must not add BranchID to payroll');
  }

  const svc = read('src/lib/hr/attendance/branchAttendance.service.ts');
  if (!svc.includes('attendance-session:')) {
    failures.push('missing employee-global attendance applock');
  }
  if (!svc.includes('assertEmployeeEligibleForBranchAttendance')) {
    failures.push('missing assignment eligibility');
  }

  const admin = read('src/app/api/admin/attendance/route.ts');
  if (!admin.includes('BranchID في الطلب غير مسموح')) {
    failures.push('admin attendance must reject body BranchID');
  }
  if (!admin.includes('requireBranchOperationAccess')) {
    failures.push('admin attendance must use session branch');
  }
  if (!admin.includes('a.BranchID = @branchId')) {
    failures.push('admin attendance GET must filter BranchID');
  }

  const empPost = read('src/app/api/employees/attendance/route.ts');
  if (!empPost.includes('BranchID في الطلب غير مسموح')) {
    failures.push('employees attendance must reject body BranchID');
  }

  const empId = read('src/app/api/employees/attendance/[id]/route.ts');
  if (!empId.includes('BranchID = @branchId')) {
    failures.push('attendance [id] must scope by BranchID');
  }

  const nightly = read('src/lib/hr/nightly-close.service.ts');
  if (!nightly.includes('listActiveBranches')) {
    failures.push('nightly must iterate active branches');
  }
  if (!nightly.includes('finalizeIncompleteAttendanceWithDefaults')) {
    failures.push('nightly missing finalize');
  }

  const finalize = read('src/lib/hr/finalize-incomplete-attendance.ts');
  if (!finalize.includes('branchId')) {
    failures.push('finalize must be branch-scoped');
  }
  if (!finalize.includes('AND BranchID = @branchId')) {
    failures.push('finalize UPDATE/SELECT must filter BranchID');
  }

  const payroll = read('src/lib/payroll/dailyPayrollGenerateCore.ts');
  if (
    !payroll.includes('vw_EmpAttendancePayrollDay') &&
    !payroll.includes('vw_EmpAttendancePayrollBranchDay')
  ) {
    failures.push('payroll generate must use aggregate view');
  }
  if (
    !payroll.includes('loadEmpDayAttendanceAggregates') &&
    !payroll.includes('loadEmpBranchDayAttendanceAggregates')
  ) {
    failures.push('payroll validation must use aggregate helper');
  }

  const wa = read('src/lib/hr/employee-daily-whatsapp-report.service.ts');
  if (!wa.includes('resolveEmployeeAttendanceBranchLabel')) {
    failures.push('employee WA must resolve attendance branch labels');
  }
  if (wa.includes('getConfig().defaultBranchName')) {
    failures.push('employee WA must not use WHATSAPP_DEFAULT_BRANCH_NAME when attendance exists');
  }

  const registry = read('src/lib/branch/domainOwnershipRegistry.ts');
  if (/domain:\s*'attendance'[\s\S]{0,200}goLiveBlocker:\s*true/.test(registry)) {
    failures.push('attendance must not remain goLiveBlocker');
  }

  // No BranchID on payroll/ledger/target tables in Phase 1K code
  for (const rel of [
    'src/lib/payroll/dailyPayrollGenerateCore.ts',
    'src/lib/payroll/attendancePayrollAggregate.ts',
  ]) {
    const src = read(rel);
    if (/ALTER TABLE[\s\S]{0,40}TblEmpDailyPayroll[\s\S]{0,40}BranchID/i.test(src)) {
      failures.push(`${rel} must not add payroll BranchID`);
    }
  }
}

async function checkLive(mode: string, expectedDatabase: string, failures: string[]) {
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
    } else console.log('    OK only GLEEM active');

    const ph1Active = await pool.request().query(`
      SELECT IsActive FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST'
    `);
    if (ph1Active.recordset[0] && Number(ph1Active.recordset[0].IsActive) === 1) {
      failures.push('PH1GTEST must remain inactive');
    } else console.log('    OK PH1GTEST inactive');

    const branchCol = await pool.request().query(`
      SELECT is_nullable FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance') AND name = N'BranchID'
    `);
    if (!branchCol.recordset[0]) failures.push('missing BranchID column');
    else if (branchCol.recordset[0].is_nullable) {
      failures.push('BranchID must be NOT NULL');
    } else console.log('    OK BranchID NOT NULL');

    const nulls = await pool.request().query(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpAttendance WHERE BranchID IS NULL
    `);
    if (Number(nulls.recordset[0].c) !== 0) {
      failures.push(`null BranchID rows=${nulls.recordset[0].c}`);
    } else console.log('    OK zero null BranchID');

    const gleem = await pool.request().query(`
      SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    const gleemId = gleem.recordset[0].BranchID;

    const counts = await pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN BranchID = ${gleemId} THEN 1 ELSE 0 END) AS gleem,
        SUM(CASE WHEN BranchID <> ${gleemId} THEN 1 ELSE 0 END) AS other
      FROM dbo.TblEmpAttendance
    `);
    const c = counts.recordset[0];
    if (Number(c.total) !== Number(c.gleem)) {
      failures.push(`historical attendance must all be GLEEM: total=${c.total} gleem=${c.gleem}`);
    } else console.log(`    OK all ${c.total} attendance rows owned by GLEEM`);
    if (Number(c.other) !== 0) {
      failures.push(`non-GLEEM attendance rows=${c.other}`);
    }

    const ph1Att = await pool.request().query(`
      SELECT COUNT(*) AS c
      FROM dbo.TblEmpAttendance a
      INNER JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE b.BranchCode = N'PH1GTEST'
    `);
    if (Number(ph1Att.recordset[0].c) !== 0) {
      failures.push('PH1GTEST must not own attendance');
    } else console.log('    OK PH1GTEST attendance=0');

    const uq = await pool.request().query(`
      SELECT COUNT(*) AS c FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
        AND name = N'UQ_TblEmpAttendance_Branch_Emp_WorkDate'
    `);
    if (Number(uq.recordset[0].c) !== 1) {
      failures.push('missing UQ_TblEmpAttendance_Branch_Emp_WorkDate');
    } else console.log('    OK unique Branch+Emp+WorkDate');

    const fk = await pool.request().query(`
      SELECT COUNT(*) AS c FROM sys.foreign_keys
      WHERE name = N'FK_TblEmpAttendance_BranchID'
    `);
    if (Number(fk.recordset[0].c) !== 1) {
      failures.push('missing FK_TblEmpAttendance_BranchID');
    } else console.log('    OK FK BranchID');

    const view = await pool.request().query(`
      SELECT OBJECT_ID(N'dbo.vw_EmpAttendancePayrollDay', N'V') AS id
    `);
    if (!view.recordset[0].id) {
      failures.push('missing vw_EmpAttendancePayrollDay');
    } else console.log('    OK payroll aggregate view');

    const payrollBranch = await pool.request().query(`
      SELECT COUNT(*) AS c FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll') AND name = N'BranchID'
    `);
    // Phase 1L adds payroll BranchID; Phase 1K alone did not. Accept either state:
    // nested 1L runs require BranchID present.
    if (Number(payrollBranch.recordset[0].c) === 1) {
      console.log('    OK payroll BranchID present (Phase 1L)');
    } else {
      console.log('    OK no payroll BranchID (pre-1L)');
    }

    const beforePath = path.join(
      root,
      'scripts',
      'audit-branches',
      '_phase1k-attendance-before.json',
    );
    if (fs.existsSync(beforePath)) {
      const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
      const beforeRows = Number(before?.stats?.rows);
      if (Number.isFinite(beforeRows) && Number(c.total) < beforeRows) {
        failures.push(
          `attendance row loss: before=${beforeRows} after=${c.total}`,
        );
      } else if (Number.isFinite(beforeRows)) {
        console.log(
          `    OK attendance rows preserved or grown (${beforeRows} → ${c.total})`,
        );
      }
    }
  } finally {
    await pool.close();
  }
}

function spawnVerifier(scriptRel: string, args: string[], failures: string[]) {
  console.log(`  --- spawn ${scriptRel} ---`);
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', scriptRel, ...args],
    { cwd: root, encoding: 'utf8', shell: true },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) failures.push(`${scriptRel} exited ${r.status}`);
  else console.log(`    OK ${scriptRel}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures: string[] = [];
  console.log('=== Phase 1K verify-attendance-branch-ownership ===');
  checkSource(failures);
  await checkLive(args.mode, args.expectedDatabase, failures);

  const child = [`--mode=${args.mode}`, `--expected-database=${args.expectedDatabase}`];
  if (args.withPhase1j) {
    spawnVerifier('scripts/verify-branch-inventory.ts', [
      ...child,
      ...(args.withPhase1i ? ['--with-phase1i'] : []),
      ...(args.withPhase1h ? ['--with-phase1h'] : []),
      ...(args.withPhase1g ? ['--with-phase1g'] : []),
    ], failures);
  } else if (args.withPhase1i) {
    spawnVerifier('scripts/verify-multibranch-boundaries.ts', [
      ...child,
      ...(args.withPhase1g ? ['--with-phase1g'] : []),
      ...(args.withPhase1h ? ['--with-phase1h'] : []),
    ], failures);
  } else {
    if (args.withPhase1g) {
      spawnVerifier('scripts/verify-second-branch-readiness.ts', child, failures);
    }
    if (args.withPhase1h) {
      spawnVerifier('scripts/verify-branch-switcher.ts', [...child, '--with-phase1g'], failures);
    }
  }

  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('\nPhase 1K verification FAILED');
    process.exit(1);
  }
  console.log('\nPhase 1K verification PASSED');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
