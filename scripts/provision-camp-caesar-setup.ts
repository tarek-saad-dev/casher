#!/usr/bin/env npx tsx
/**
 * Phase 1N-A — provision CAMP_CAESAR in SETUP only (no template copy).
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const original = moduleWithLoad._load;
moduleWithLoad._load = function patched(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return original.call(this, request, ...rest);
};

function parseArgs(argv: string[]) {
  let confirm = false;
  let expectedDatabase = 'last132';
  let mode = 'cloud';
  let actorUserId = 10;
  for (const a of argv) {
    if (a === '--confirm') confirm = true;
    else if (a.startsWith('--expected-database=')) expectedDatabase = a.split('=')[1];
    else if (a.startsWith('--mode=')) mode = a.split('=')[1];
    else if (a.startsWith('--actor-user-id=')) actorUserId = Number(a.split('=')[1]);
  }
  return { confirm, expectedDatabase, mode, actorUserId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    console.error('Refusing: pass --confirm');
    process.exit(1);
  }
  if (args.mode !== 'cloud' || args.expectedDatabase !== 'last132') {
    console.error('Refusing: cloud/last132 only');
    process.exit(1);
  }

  const config: sql.config = {
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
  if (config.database !== args.expectedDatabase) {
    console.error(`DB mismatch ${config.database} != ${args.expectedDatabase}`);
    process.exit(1);
  }

  const pool = await sql.connect(config);

  const CODE = 'CAMP_CAESAR';
  const NAME_AR = 'فرع كامب شيزار';
  const NAME_EN = 'Camp Caesar';
  const SHORT = 'كامب شيزار';

  // Part 1 — identity conflicts
  const conflicts = await pool
    .request()
    .input('code', sql.NVarChar(30), CODE)
    .input('nameAr', sql.NVarChar(100), NAME_AR)
    .input('nameEn', sql.NVarChar(100), NAME_EN)
    .input('short', sql.NVarChar(50), SHORT)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchCode = @code) AS CodeDup,
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchName = @nameAr) AS NameArDup,
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchName = @nameEn) AS NameEnDup,
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE ShortName = @short) AS ShortDup
    `);
  const c = conflicts.recordset[0];
  if (Number(c.CodeDup) || Number(c.NameArDup) || Number(c.NameEnDup) || Number(c.ShortDup)) {
    console.error('IDENTITY CONFLICT — aborting without create', c);
    process.exit(2);
  }
  console.log('Part1 identity OK — no conflicts');

  // GLEEM before fingerprint (selected tables)
  const before = await pool.request().query(`
    DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
    SELECT
      (SELECT COUNT_BIG(*) FROM dbo.QueueBookingSettings WHERE BranchID = @g) AS Qbs,
      (SELECT COUNT_BIG(*) FROM dbo.TblUserBranchAccess WHERE BranchID = @g) AS Access,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpBranchAssignment WHERE BranchID = @g) AS Assign,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpBranchPayrollPlan WHERE BranchID = @g) AS PayPlans,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpTargetPlan WHERE BranchID = @g) AS TargetPlans,
      (SELECT COUNT_BIG(*) FROM dbo.Bookings WHERE BranchID = @g) AS Bookings,
      (SELECT COUNT_BIG(*) FROM dbo.TblCashMove WHERE BranchID = @g) AS Cash,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @g) AS Payroll,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @g) AS Ledger,
      (SELECT CHECKSUM_AGG(CHECKSUM(SettingID, BookingEnabled, UpdatedAt))
         FROM dbo.QueueBookingSettings WHERE BranchID = @g) AS QbsChecksum
  `);
  console.log('GLEEM before', before.recordset[0]);

  const { provisionBranch } = await import('../src/lib/branch/branchProvisioningService');
  const { evaluateBranchReadiness } = await import('../src/lib/branch/branchReadinessService');
  const { listActiveBranches, getBranchByCode } = await import('../src/lib/branch/repository');
  const { listPublicActiveBranches } = await import('../src/lib/branch/bookingQueueOwnership');

  // Schema uses single BranchName — store Arabic display name; English documented separately.
  const result = await provisionBranch(
    {
      branchCode: CODE,
      branchName: NAME_AR,
      shortName: SHORT,
      timeZone: 'Africa/Cairo',
      address: null,
      phone: null,
      grantActorAccess: true,
      // Explicit: no template copy from GLEEM
      template: {
        queueBookingSettings: false,
        partnerShares: false,
      },
    },
    { userId: args.actorUserId },
  );

  const branch = result.branch;
  console.log('provisioned', {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
    lifecycleStatus: branch.lifecycleStatus,
    isActive: branch.isActive,
    publicBookingEnabled: branch.publicBookingEnabled,
    externalNotificationsEnabled: branch.externalNotificationsEnabled,
    queueSettingsCreated: result.queueSettingsCreated,
    partnerSharesSeeded: result.partnerSharesSeeded,
    actorAccessGranted: result.actorAccessGranted,
    englishDisplayNameDocumented: NAME_EN,
  });

  // Hard asserts
  if (
    branch.lifecycleStatus !== 'SETUP' ||
    branch.isActive ||
    branch.publicBookingEnabled ||
    branch.externalNotificationsEnabled
  ) {
    console.error('FATAL: branch not in safe SETUP state', branch);
    process.exit(3);
  }

  const settings = await pool
    .request()
    .input('bid', sql.Int, branch.branchId)
    .query(`
      SELECT SettingID, BookingEnabled, SalonName
      FROM dbo.QueueBookingSettings WHERE BranchID = @bid
    `);
  const bookingRaw = settings.recordset[0]?.BookingEnabled;
  if (bookingRaw !== false && bookingRaw !== 0 && bookingRaw != null) {
    console.error('FATAL: QueueBookingSettings.BookingEnabled not 0', settings.recordset[0]);
    process.exit(3);
  }
  if (!settings.recordset[0]) {
    console.error('FATAL: expected disabled QueueBookingSettings container');
    process.exit(3);
  }

  // Part 4 — transactional ownership zero
  const own = await pool
    .request()
    .input('bid', sql.Int, branch.branchId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID = @bid) AS Bookings,
        (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID = @bid) AS Queue,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID = @bid) AS Cash,
        (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID = @bid) AS Attendance,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @bid) AS Payroll,
        (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @bid) AS Ledger,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget WHERE BranchID = @bid) AS Targets,
        (SELECT COUNT(*) FROM dbo.TblEmpTargetRecalcRequest WHERE BranchID = @bid) AS Recalc,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchPayrollPlan WHERE BranchID = @bid) AS PayPlans,
        (SELECT COUNT(*) FROM dbo.TblEmpTargetPlan WHERE BranchID = @bid) AS TargetPlans,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment WHERE BranchID = @bid) AS Assignments,
        (SELECT COUNT(*) FROM dbo.TblInventoryMovement WHERE BranchID = @bid) AS InvMoves,
        (SELECT COUNT(*) FROM dbo.TblBranchInventory WHERE BranchID = @bid) AS InvBalances,
        (SELECT COUNT(*) FROM dbo.TblInventoryTransfer WHERE FromBranchID = @bid OR ToBranchID = @bid) AS InvTransfers
    `);
  console.log('ownership zeros', own.recordset[0]);
  for (const [k, v] of Object.entries(own.recordset[0])) {
    if (Number(v) !== 0) {
      console.error(`FATAL: unexpected rows in ${k}=${v}`);
      process.exit(4);
    }
  }

  // Rows created inventory
  const created = await pool
    .request()
    .input('bid', sql.Int, branch.branchId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchID = @bid) AS TblBranch,
        (SELECT COUNT(*) FROM dbo.QueueBookingSettings WHERE BranchID = @bid) AS QueueBookingSettings,
        (SELECT COUNT(*) FROM dbo.TblUserBranchAccess WHERE BranchID = @bid) AS TblUserBranchAccess,
        (SELECT COUNT(*) FROM dbo.TblBranchLifecycleAudit WHERE BranchID = @bid) AS TblBranchLifecycleAudit,
        (SELECT COUNT(*) FROM dbo.TblBranchPartnerShare WHERE BranchID = @bid) AS PartnerShares
    `);
  console.log('rows created', created.recordset[0]);

  const access = await pool
    .request()
    .input('bid', sql.Int, branch.branchId)
    .query(`
      SELECT ID, UserID, CanOperate, CanViewReports, CanSwitch, IsActive, GrantReason
      FROM dbo.TblUserBranchAccess WHERE BranchID = @bid
    `);
  console.log('access rows', access.recordset);

  // Part 6 readiness
  const readiness = await evaluateBranchReadiness(branch.branchId);
  console.log(
    JSON.stringify(
      {
        score: readiness.score,
        isReadyForSmoke: readiness.isReadyForSmoke,
        isReadyForInternalLive: readiness.isReadyForInternalLive,
        isReadyForPublicLive: readiness.isReadyForPublicLive,
        blockers: readiness.blockers.map((b) => ({
          key: b.key,
          section: b.section,
          title: b.title,
          requiredFor: b.requiredFor,
          details: b.details,
        })),
        warnings: readiness.warnings.map((w) => ({
          key: w.key,
          section: w.section,
          details: w.details,
        })),
      },
      null,
      2,
    ),
  );

  // Part 7 isolation
  const active = await listActiveBranches();
  const publicB = await listPublicActiveBranches();
  const inActive = active.some((b) => b.branchCode === CODE);
  const inPublic = publicB.some((b) => b.branchCode === CODE);
  console.log('isolation', {
    inListActiveBranches: inActive,
    inListPublicActiveBranches: inPublic,
    activeCodes: active.map((b) => b.branchCode),
    publicCodes: publicB.map((b) => b.branchCode),
  });
  if (inActive || inPublic) {
    console.error('FATAL: CAMP_CAESAR leaked into active/public lists');
    process.exit(5);
  }

  // Nightly uses listActiveBranches — confirmed excluded
  const after = await pool.request().query(`
    DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
    SELECT
      (SELECT COUNT_BIG(*) FROM dbo.QueueBookingSettings WHERE BranchID = @g) AS Qbs,
      (SELECT COUNT_BIG(*) FROM dbo.TblUserBranchAccess WHERE BranchID = @g) AS Access,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpBranchAssignment WHERE BranchID = @g) AS Assign,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpBranchPayrollPlan WHERE BranchID = @g) AS PayPlans,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpTargetPlan WHERE BranchID = @g) AS TargetPlans,
      (SELECT COUNT_BIG(*) FROM dbo.Bookings WHERE BranchID = @g) AS Bookings,
      (SELECT COUNT_BIG(*) FROM dbo.TblCashMove WHERE BranchID = @g) AS Cash,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @g) AS Payroll,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @g) AS Ledger,
      (SELECT CHECKSUM_AGG(CHECKSUM(SettingID, BookingEnabled, UpdatedAt))
         FROM dbo.QueueBookingSettings WHERE BranchID = @g) AS QbsChecksum
  `);
  console.log('GLEEM after', after.recordset[0]);
  const b0 = before.recordset[0];
  const a0 = after.recordset[0];
  const gleemKeys = [
    'Qbs',
    'Access',
    'Assign',
    'PayPlans',
    'TargetPlans',
    'Bookings',
    'Cash',
    'Payroll',
    'Ledger',
    'QbsChecksum',
  ];
  let gleemChanged = 0;
  for (const k of gleemKeys) {
    if (String(b0[k]) !== String(a0[k])) {
      console.error(`GLEEM changed ${k}: ${b0[k]} -> ${a0[k]}`);
      gleemChanged++;
    }
  }
  console.log('GLEEM records modified by provisioning =', gleemChanged);

  const fresh = await getBranchByCode(CODE);
  const report = {
    createdAt: new Date().toISOString(),
    englishDisplayName: NAME_EN,
    branch: fresh,
    queueBookingSettings: settings.recordset[0] ?? null,
    rowsCreated: created.recordset[0],
    ownershipZeros: own.recordset[0],
    access: access.recordset,
    readiness: {
      score: readiness.score,
      isReadyForSmoke: readiness.isReadyForSmoke,
      isReadyForInternalLive: readiness.isReadyForInternalLive,
      isReadyForPublicLive: readiness.isReadyForPublicLive,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
    },
    isolation: { inActive, inPublic },
    gleemModified: gleemChanged,
    partnerSharesSeeded: result.partnerSharesSeeded,
  };
  const outPath = path.join(__dirname, 'branch-smoke', '_phase1n-camp-caesar-provision.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('wrote', outPath);

  if (gleemChanged !== 0) process.exit(6);
  if (readiness.isReadyForSmoke || readiness.isReadyForInternalLive || readiness.isReadyForPublicLive) {
    console.error('Unexpected readiness true');
    process.exit(7);
  }

  await pool.close();
  console.log('Phase 1N-A CAMP_CAESAR SETUP provision COMPLETE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
