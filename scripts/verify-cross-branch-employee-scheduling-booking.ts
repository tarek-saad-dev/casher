#!/usr/bin/env npx tsx
/**
 * Phase 1Q verifier — cross-branch employee scheduling + booking.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}
function ok(msg: string) {
  console.log('OK:', msg);
}

async function main() {
  const root = path.join(__dirname, '..');
  const required = [
    'src/lib/hr/empBranchWorkSchedule.ts',
    'src/lib/hr/employeeBranchScheduleResolver.ts',
    'src/lib/hr/employeeBranchScheduleSave.ts',
    'src/lib/hr/barberGlobalCalendar.ts',
    'src/lib/hr/temporaryBranchTransfer.ts',
    'src/lib/branch/publicBranchVisibility.ts',
    'src/app/api/public/booking/barbers/[empId]/calendar/route.ts',
    'scripts/verify-camp-caesar-real-configuration.ts',
    'docs/branch-phase-1q-closure.md',
  ];
  for (const f of required) {
    if (!fs.existsSync(path.join(root, f))) fail(`missing ${f}`);
  }
  ok('required files');

  const soT = fs.readFileSync(path.join(root, 'src/lib/hr/empBranchWorkSchedule.ts'), 'utf8');
  if (!soT.includes('TblEmpBranchWorkSchedule')) fail('SoT table missing');
  if (!soT.includes('BranchID')) fail('operational schedule lacks BranchID');
  ok('branch-owned schedule SoT');

  const save = fs.readFileSync(
    path.join(root, 'src/lib/hr/employeeBranchScheduleSave.ts'),
    'utf8',
  );
  if (!save.includes('EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED')) {
    fail('same-workday conflict missing');
  }
  ok('conflict policy');

  const vis = fs.readFileSync(
    path.join(root, 'src/lib/branch/publicBranchVisibility.ts'),
    'utf8',
  );
  if (!vis.includes('canBranchAppearInPublicBooking')) fail('public visibility missing');
  ok('public visibility policy');

  const create = fs.readFileSync(
    path.join(root, 'src/app/api/public/booking/create/route.ts'),
    'utf8',
  );
  if (!create.includes('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH')) {
    fail('booking wrong-branch guard missing');
  }
  ok('booking create guard');

  const att = fs.readFileSync(
    path.join(root, 'src/lib/hr/attendance/branchAttendance.service.ts'),
    'utf8',
  );
  if (!att.includes('EMPLOYEE_NOT_SCHEDULED_IN_THIS_BRANCH')) {
    fail('attendance schedule guard missing');
  }
  ok('attendance guards');

  // Nested verifiers present
  if (!fs.existsSync(path.join(root, 'scripts/verify-camp-caesar-real-configuration.ts'))) {
    fail('nested 1O verifier missing');
  }
  ok('nested verifiers present');

  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || '',
    user: process.env.CLOUD_DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  });

  if ((process.env.CLOUD_DB_NAME || '').toLowerCase() !== 'last132') {
    fail(`expected last132 got ${process.env.CLOUD_DB_NAME}`);
  }

  const cc = await pool.request().query(`
    SELECT LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
    FROM dbo.TblBranch WHERE BranchID=3
  `);
  const row = cc.recordset[0];
  if (row.LifecycleStatus !== 'SETUP') fail('CC activated');
  if (row.IsActive) fail('CC IsActive=1');
  if (row.PublicBookingEnabled) fail('CC public booking enabled');
  ok('Camp Caesar remains SETUP/non-public');

  const table = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblEmpBranchWorkSchedule', N'U') IS NULL THEN 0 ELSE 1 END AS Has
  `);
  if (!Number(table.recordset[0].Has)) fail('TblEmpBranchWorkSchedule missing live');
  ok('live SoT table exists');

  const gleem = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblBranch b ON b.BranchID=s.BranchID
    WHERE b.BranchCode=N'GLEEM' AND s.IsActive=1
  `);
  if (Number(gleem.recordset[0].Cnt) < 1) fail('GLEEM branch schedules missing after backfill');
  ok(`GLEEM branch schedules present (${gleem.recordset[0].Cnt})`);

  const smoke = await pool.request().query(`
    SELECT TOP 1 SmokeRunID, Status, CleanupStatus, Purpose
    FROM dbo.TblBranchSmokeRun WHERE BranchID=3 AND Purpose LIKE N'%1Q%'
    ORDER BY SmokeRunID DESC
  `);
  if (!smoke.recordset[0] || String(smoke.recordset[0].Status) !== 'CLEANED') {
    fail('Phase 1Q smoke not CLEANED');
  }
  ok(`1Q smoke CLEANED (SmokeRunID=${smoke.recordset[0].SmokeRunID})`);

  await pool.close();
  console.log('VERIFY_CROSS_BRANCH_EMPLOYEE_SCHEDULING_BOOKING: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
