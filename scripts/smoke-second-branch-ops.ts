#!/usr/bin/env npx tsx
/**
 * Phase 1G disposable smoke: bootstrap PH1GTEST, assign, open day,
 * create booking + queue ticket, verify GLEEM fingerprints stable, deactivate.
 *
 * Requires: --confirm --expected-database=last132 --mode=cloud
 * Does NOT create payroll/attendance/ledger. Does NOT leave branch active.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const moduleWithLoad = Module as any;
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

async function gleemFingerprints(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`
    DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID = @g) AS BookingsGleem,
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID = @g) AS QueueGleem,
      (SELECT COUNT(*) FROM dbo.TblNewDay WHERE BranchID = @g) AS DaysGleem,
      (SELECT CHECKSUM_AGG(CHECKSUM(BookingID, Status, BookingCode, StartTime, EndTime))
         FROM dbo.Bookings WHERE BranchID = @g) AS BookingsChecksum
  `);
  return r.recordset[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.confirm !== true && args.confirm !== 'true') {
    console.error('Refusing: pass --confirm');
    process.exit(1);
  }
  const expectedDatabase = String(args['expected-database'] || 'last132');
  const mode = String(args.mode || 'cloud').toLowerCase();
  if (mode !== 'cloud') {
    console.error('Refusing: smoke targets cloud only');
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
    requestTimeout: 120000,
  };
  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  const userId = Number(args['grant-user-id'] || 10);
  const empId = Number(args['assign-emp-id'] || 5);
  const branchCode = 'PH1GTEST';

  const {
    bootstrapBranch,
    grantUserBranchAccess,
  } = await import('../src/lib/branch/bootstrap');
  const { ensureEmployeeBranchAssignment } = await import(
    '../src/lib/branch/assignmentIntegrity'
  );
  const { evaluateBranchOperationalReadiness } = await import('../src/lib/branch/readiness');
  const { openBusinessDay, getOpenBusinessDay } = await import('../src/lib/branch/businessDay');
  const { getBranchByCode } = await import('../src/lib/branch/repository');

  const pool = await sql.connect(config);
  const before = await gleemFingerprints(pool);
  console.log('GLEEM before', before);

  try {
    // Resume if a previous partial smoke left PH1GTEST behind.
    let existing = await getBranchByCode(branchCode);
    if (existing && !existing.isActive) {
      await pool
        .request()
        .input('branchId', sql.Int, existing.branchId)
        .query(`UPDATE dbo.TblBranch SET IsActive = 1, UpdatedAt = SYSUTCDATETIME() WHERE BranchID = @branchId`);
      existing = await getBranchByCode(branchCode);
    }

    const boot = await bootstrapBranch({
      branch: {
        branchCode,
        branchName: 'Phase 1G Test Branch (disposable)',
        shortName: 'PH1G',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00',
        isActive: true,
        createdByUserId: userId,
      },
      seedQueueSettings: { copyFromBranchCode: 'GLEEM' },
      seedPartnerSharesFrom: existing ? null : 'GLEEM',
      partnerShareEffectiveFrom: new Date().toISOString().slice(0, 10),
    });
    console.log('bootstrapped', {
      branchId: boot.branch.branchId,
      settingsCreated: boot.queueSettingsCreated,
      shares: boot.partnerSharesSeeded,
    });

    await grantUserBranchAccess({
      userId,
      branchId: boot.branch.branchId,
      canOperate: true,
      canViewReports: true,
      canSwitch: false,
    });
    await ensureEmployeeBranchAssignment({
      empId,
      branchId: boot.branch.branchId,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      canReceiveBookings: true,
      isHomeBranch: false,
    });

    const readiness = await evaluateBranchOperationalReadiness({
      branchId: boot.branch.branchId,
    });
    console.log('readiness', {
      ready: readiness.ready,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
    });
    if (!readiness.ready) {
      throw new Error(`Readiness blockers: ${readiness.blockers.join(',')}`);
    }

    const branchCtx = {
      userId,
      branchId: boot.branch.branchId,
      branchCode: boot.branch.branchCode,
      branchName: boot.branch.branchName,
      shortName: boot.branch.shortName,
      timeZone: boot.branch.timeZone,
      businessDayCutoffTime: boot.branch.businessDayCutoffTime,
      canOperate: true,
      canViewReports: true,
      canSwitch: false,
    };

    let day = await getOpenBusinessDay(boot.branch.branchId);
    if (!day) {
      day = await openBusinessDay(branchCtx);
    }
    console.log('business day', { id: day.id, newDay: day.newDay });

    const bookingCode = `1G${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const bookingIns = await pool
      .request()
      .input('branchId', sql.Int, boot.branch.branchId)
      .input('empId', sql.Int, empId)
      .input('bDate', sql.Date, day.newDay)
      .input('code', sql.NVarChar(20), bookingCode)
      .input('userId', sql.Int, userId)
      .query(`
        INSERT INTO dbo.Bookings (
          ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
          Status, Source, Notes, BookingCode, CreatedByUserID, BranchID
        )
        OUTPUT INSERTED.BookingID
        VALUES (
          NULL, @empId, @bDate, '11:00', '11:30',
          'pending', 'phase1g-smoke', N'PH1GTEST', @code, @userId, @branchId
        )
      `);
    const bookingId = Number(bookingIns.recordset[0].BookingID);

    const ticketIns = await pool
      .request()
      .input('branchId', sql.Int, boot.branch.branchId)
      .input('empId', sql.Int, empId)
      .input('qDate', sql.Date, day.newDay)
      .input('bookingId', sql.Int, bookingId)
      .query(`
        DECLARE @next INT = (
          SELECT ISNULL(MAX(TicketNumber), 0) + 1
          FROM dbo.QueueTickets WITH (UPDLOCK, HOLDLOCK)
          WHERE BranchID = @branchId AND QueueDate = @qDate
        );
        INSERT INTO dbo.QueueTickets (
          TicketCode, TicketNumber, TicketPrefix, EmpID, BookingID, QueueDate,
          Status, Source, Priority, BranchID, CreatedByUserID
        )
        OUTPUT INSERTED.QueueTicketID, INSERTED.TicketCode
        VALUES (
          CONCAT(N'W-', RIGHT(CONCAT('000', @next), 3)),
          @next, N'W', @empId, @bookingId, @qDate,
          N'waiting', N'phase1g-smoke', 0, @branchId, NULL
        )
      `);
    console.log('created', {
      bookingId,
      bookingCode,
      queueTicketId: ticketIns.recordset[0].QueueTicketID,
      ticketCode: ticketIns.recordset[0].TicketCode,
    });

    const isolation = await pool
      .request()
      .input('branchId', sql.Int, boot.branch.branchId)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID = @branchId) AS TestBookings,
          (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID = @branchId) AS TestQueue,
          (SELECT COUNT(*) FROM dbo.Bookings b
             INNER JOIN dbo.TblBranch br ON br.BranchID = b.BranchID AND br.BranchCode = N'GLEEM'
             WHERE b.BookingCode LIKE N'1G%') AS GleemHasSmokeCodes
      `);
    console.log('isolation', isolation.recordset[0]);
    if (Number(isolation.recordset[0].GleemHasSmokeCodes) !== 0) {
      throw new Error('Smoke booking codes leaked onto GLEEM');
    }

    // Deactivate test branch so public listing / ops do not treat it as live.
    await pool
      .request()
      .input('branchId', sql.Int, boot.branch.branchId)
      .query(`
        UPDATE dbo.TblBranch
        SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE BranchID = @branchId
      `);
    console.log('deactivated', branchCode);

    const after = await gleemFingerprints(pool);
    console.log('GLEEM after', after);
    if (
      Number(after.BookingsGleem) !== Number(before.BookingsGleem) ||
      Number(after.QueueGleem) !== Number(before.QueueGleem) ||
      String(after.BookingsChecksum) !== String(before.BookingsChecksum)
    ) {
      throw new Error('GLEEM fingerprint changed during PH1GTEST smoke');
    }

    console.log('Phase 1G smoke PASSED (PH1GTEST deactivated; artifacts retained for audit)');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
